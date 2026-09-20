import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { MatchInteractionRouter } from '../../../src/modules/tenman/bot/interaction-router.js';
import { createMatchCustomId } from '../../../src/modules/tenman/bot/match-custom-id.js';

const secret = 'router-test-secret';
const matchId = '123e4567-e89b-12d3-a456-426614174000';

function interaction(customId: string) {
  return {
    customId,
    guildId: '123456789012345678',
    user: { id: '223456789012345678' },
    id: 'interaction-1',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    isStringSelectMenu: vi.fn().mockReturnValue(false),
  };
}

function router(
  match: { id: string; guildId: string; version: number; phaseGeneration: number } | null,
) {
  const prisma = {
    match: { findUnique: vi.fn().mockResolvedValue(match) },
  } as unknown as PrismaClient;
  return {
    router: new MatchInteractionRouter({
      prisma,
      componentSigningSecret: secret,
      actorFor: vi.fn(),
    }),
    prisma,
  };
}

describe('interaction router stale-control guard', () => {
  it('does not invoke a service when a valid control carries a stale version', async () => {
    const { router: subject, prisma } = router({
      id: matchId,
      guildId: '123456789012345678',
      version: 2,
      phaseGeneration: 1,
    });
    const event = interaction(
      createMatchCustomId({ action: 'READY', matchId, version: 1, phaseGeneration: 1 }, secret),
    );

    await expect(subject.handle(event as never)).rejects.toThrow('Match dashboard is stale');
    expect(event.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(event.editReply).not.toHaveBeenCalled();
    expect(prisma.match.findUnique).toHaveBeenCalledWith({ where: { id: matchId } });
  });

  it('rejects a cross-guild replay before dispatching the action', async () => {
    const { router: subject } = router({
      id: matchId,
      guildId: 'different-guild',
      version: 1,
      phaseGeneration: 1,
    });
    const event = interaction(
      createMatchCustomId({ action: 'READY', matchId, version: 1, phaseGeneration: 1 }, secret),
    );

    await expect(subject.handle(event as never)).rejects.toThrow('Match dashboard is stale');
    expect(event.editReply).not.toHaveBeenCalled();
  });
});
