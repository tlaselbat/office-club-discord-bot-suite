import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { WebSessionService } from '../../../src/services/web-session-service.js';

describe('WebSessionService', () => {
  it('stores a hash and resolves a live session', async () => {
    const now = new Date('2026-09-12T12:00:00Z');
    const create = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      webSession: { create, findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    } as unknown as PrismaClient;
    const service = new WebSessionService(prisma);
    const token = await service.create('12345678901234567', now);
    expect(token).not.toHaveLength(64);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: createHash('sha256').update(token).digest('hex'),
        discordUserId: '12345678901234567',
      }),
    });
  });

  it('rejects an expired session', async () => {
    const prisma = {
      webSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'id',
          discordUserId: '12345678901234567',
          expiresAt: new Date('2026-09-12T11:00:00Z'),
          lastSeenAt: new Date(),
        }),
      },
    } as unknown as PrismaClient;
    await expect(
      new WebSessionService(prisma).resolve('token', new Date('2026-09-12T12:00:00Z')),
    ).resolves.toBeNull();
  });
});
