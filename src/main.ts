import { createApplication } from './app.js';
import { loadEnvironment } from './config/environment.js';
import { createLogger } from './logging/logger.js';

async function main(): Promise<void> {
  const environment = loadEnvironment();
  const logger = createLogger(environment.LOG_LEVEL);
  const application = await createApplication(environment, logger);
  let stopping = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, action: 'shutdown', result: 'started' }, 'Graceful shutdown started');
    const forcedExit = setTimeout(() => {
      logger.error(
        { signal, action: 'shutdown', result: 'timeout' },
        'Graceful shutdown timed out',
      );
      process.exitCode = 1;
    }, 15_000);
    forcedExit.unref();
    try {
      await application.stop();
      clearTimeout(forcedExit);
      logger.info({ signal, action: 'shutdown', result: 'complete' }, 'Graceful shutdown complete');
    } catch (error: unknown) {
      logger.error(
        { err: error, signal, action: 'shutdown', result: 'failed' },
        'Graceful shutdown failed',
      );
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await application.start();
  logger.info({ action: 'startup', result: 'ready' }, 'Office Club bot suite ready');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
