import { describe, expect, it, vi } from 'vitest';
import { DurableWorker, type JobStore, type LeasedJob } from '../../src/jobs/worker.js';

function store(job: LeasedJob | null): JobStore & {
  retry: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  reschedule: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    lease: vi.fn().mockResolvedValue(job),
    retry: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
}
const options = {
  workerId: 'worker',
  leaseMs: 30_000,
  maxAttempts: 3,
  baseRetryMs: 1000,
  maxRetryMs: 10_000,
};

describe('durable worker', () => {
  it('completes successful work', async () => {
    const jobs = store({
      id: 'job',
      type: 'TEST',
      attempts: 0,
      payload: {},
      leaseToken: 'lease-a',
    });
    const worker = new DurableWorker(
      jobs,
      new Map([['TEST', vi.fn().mockResolvedValue(undefined)]]),
      options,
    );
    await worker.runOnce(new Date(0));
    expect(jobs.complete).toHaveBeenCalledWith('job', 'lease-a');
  });

  it('reschedules recurring work without completing it', async () => {
    const jobs = store({
      id: 'job',
      type: 'TEST',
      attempts: 0,
      payload: {},
      leaseToken: 'lease-a',
    });
    const runAt = new Date(10_000);
    const worker = new DurableWorker(
      jobs,
      new Map([['TEST', vi.fn().mockResolvedValue({ rescheduleAt: runAt })]]),
      options,
    );
    await worker.runOnce(new Date(0));
    expect(jobs.reschedule).toHaveBeenCalledWith('job', runAt, 'lease-a');
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it('retries failures with bounded exponential delay', async () => {
    const jobs = store({
      id: 'job',
      type: 'TEST',
      attempts: 1,
      payload: {},
      leaseToken: 'lease-a',
    });
    const worker = new DurableWorker(
      jobs,
      new Map([['TEST', vi.fn().mockRejectedValue(new Error('temporary'))]]),
      options,
    );
    await worker.runOnce(new Date(0));
    expect(jobs.retry).toHaveBeenCalledWith('job', new Date(2000), 'temporary', 'lease-a');
  });

  it('finalizes using the lease token after a re-arm request', async () => {
    const jobs = store({
      id: 'job',
      type: 'TEST',
      attempts: 0,
      payload: {},
      leaseToken: 'lease-a',
    });
    const worker = new DurableWorker(
      jobs,
      new Map([['TEST', vi.fn().mockResolvedValue(undefined)]]),
      options,
    );
    await worker.runOnce(new Date(0));
    // A scheduleJob re-arm leaves the row PENDING; the old completion must be
    // constrained by lease-a and therefore cannot overwrite the new request.
    expect(jobs.complete).toHaveBeenCalledWith('job', 'lease-a');
  });

  it('passes a new lease token through retry finalization', async () => {
    const jobs = store({
      id: 'job',
      type: 'TEST',
      attempts: 0,
      payload: {},
      leaseToken: 'lease-b',
    });
    const worker = new DurableWorker(
      jobs,
      new Map([['TEST', vi.fn().mockRejectedValue(new Error('temporary'))]]),
      options,
    );
    await worker.runOnce(new Date(0));
    expect(jobs.retry).toHaveBeenCalledWith('job', new Date(1000), 'temporary', 'lease-b');
  });
});
