export interface LeasedJob {
  id: string;
  type: string;
  attempts: number;
  payload: unknown;
  leaseToken: string;
}

export interface JobStore {
  lease(workerId: string, leaseUntil: Date): Promise<LeasedJob | null>;
  complete(jobId: string, leaseToken: string): Promise<void>;
  reschedule(jobId: string, runAt: Date, leaseToken: string): Promise<void>;
  retry(jobId: string, runAt: Date, error: string, leaseToken: string): Promise<void>;
  fail(jobId: string, error: string, leaseToken: string): Promise<void>;
}

export type JobResult = { rescheduleAt: Date } | undefined;
export type JobHandler = ((job: LeasedJob) => Promise<JobResult> | Promise<void>) & {
  onPermanentFailure?: (job: LeasedJob, error: string) => Promise<void>;
};

export interface WorkerOptions {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
}

export class DurableWorker {
  public constructor(
    private readonly store: JobStore,
    private readonly handlers: ReadonlyMap<string, JobHandler>,
    private readonly options: WorkerOptions,
  ) {}

  public async runOnce(now = new Date()): Promise<boolean> {
    const job = await this.store.lease(
      this.options.workerId,
      new Date(now.getTime() + this.options.leaseMs),
    );
    if (job === null) return false;
    const handler = this.handlers.get(job.type);
    if (handler === undefined) {
      await this.store.fail(job.id, `No handler registered for ${job.type}`, job.leaseToken);
      return true;
    }
    try {
      const result = await handler(job);
      if (result === undefined) await this.store.complete(job.id, job.leaseToken);
      else await this.store.reschedule(job.id, result.rescheduleAt, job.leaseToken);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown job error';
      const nextAttempt = job.attempts + 1;
      if (nextAttempt >= this.options.maxAttempts) {
        if (handler.onPermanentFailure !== undefined) {
          try {
            await handler.onPermanentFailure(job, message);
          } catch (recoveryError: unknown) {
            const recoveryMessage =
              recoveryError instanceof Error ? recoveryError.message : 'Unknown recovery error';
            await this.store.retry(
              job.id,
              new Date(now.getTime() + this.options.maxRetryMs),
              `Permanent failure recovery failed: ${recoveryMessage}`,
              job.leaseToken,
            );
            return true;
          }
        }
        await this.store.fail(job.id, message, job.leaseToken);
      } else {
        const exponential = this.options.baseRetryMs * 2 ** Math.max(0, nextAttempt - 1);
        const delay = Math.min(exponential, this.options.maxRetryMs);
        await this.store.retry(job.id, new Date(now.getTime() + delay), message, job.leaseToken);
      }
    }
    return true;
  }
}
