import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../src/config/environment.js';

const mocks = vi.hoisted(() => ({
  prisma: {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
    guildSettings: { createMany: vi.fn() },
  },
  discord: { login: vi.fn(), destroy: vi.fn(), isReady: vi.fn(), guilds: { cache: new Map() } },
  recover: vi.fn(),
  modulesStart: vi.fn(),
  modulesStop: vi.fn(),
  workerStart: vi.fn(),
  workerStop: vi.fn(),
}));
vi.mock('../../src/database/prisma.js', () => ({ createPrismaClient: () => mocks.prisma }));
vi.mock('../../src/bot/client.js', () => ({ createDiscordClient: () => mocks.discord }));
vi.mock('../../src/modules/tenman/module.js', () => ({ createTenManModule: () => ({}) }));
vi.mock('../../src/modules/rewards/module.js', () => ({ createRewardsModule: () => ({}) }));
vi.mock('../../src/modules/tenman/services/startup-recovery.js', () => ({
  StartupRecovery: class {
    run = mocks.recover;
  },
}));
vi.mock('../../src/core/modules/registry.js', () => ({
  ModuleRegistry: class {
    start = mocks.modulesStart;
    stop = mocks.modulesStop;
    jobHandlers() {
      return new Map();
    }
  },
}));
vi.mock('../../src/jobs/runner.js', () => ({
  WorkerRunner: class {
    start = mocks.workerStart;
    stop = mocks.workerStop;
  },
}));

import { createApplication, type Application } from '../../src/app.js';

const environment = {
  DATABASE_URL: 'postgresql://audit:unused@localhost/audit',
  PUBLIC_BASE_URL: 'https://example.test',
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  DATHOST_EMAIL: 'audit@example.test',
  DATHOST_PASSWORD: 'unused',
  PANEL_OWNER_DISCORD_USER_IDS: [],
  HOST: '127.0.0.1',
  PORT: 0,
} as unknown as Environment;
let app: Application;
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.discord.isReady.mockReturnValue(true);
  mocks.prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  app = await createApplication(environment, pino({ enabled: false }));
});
afterEach(async () => {
  await app.stop();
});

const readyStatus = async () => (await app.http.inject('/health/ready')).statusCode;

describe('application readiness', () => {
  it('waits for recovery, module startup and worker scheduling', async () => {
    mocks.discord.login.mockImplementation(async () => {
      expect(await readyStatus()).toBe(503);
    });
    mocks.recover.mockImplementation(async () => {
      expect(await readyStatus()).toBe(503);
    });
    mocks.modulesStart.mockImplementation(async () => {
      expect(await readyStatus()).toBe(503);
    });
    await app.start();
    expect(mocks.workerStart).toHaveBeenCalledOnce();
    expect(await readyStatus()).toBe(200);
  });

  it('stays unavailable if recovery fails', async () => {
    mocks.recover.mockRejectedValue(new Error('recovery failed'));
    await expect(app.start()).rejects.toThrow('recovery failed');
    expect(await readyStatus()).toBe(503);
    expect(mocks.workerStart).not.toHaveBeenCalled();
  });

  it('reports Discord and database failures after startup', async () => {
    await app.start();
    mocks.discord.isReady.mockReturnValue(false);
    expect(await readyStatus()).toBe(503);
    mocks.discord.isReady.mockReturnValue(true);
    mocks.prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));
    expect(await readyStatus()).toBe(503);
  });

  it('becomes unavailable at the start of shutdown', async () => {
    await app.start();
    mocks.workerStop.mockImplementationOnce(async () => {
      expect(await readyStatus()).toBe(503);
    });
    await app.stop();
  });
});
