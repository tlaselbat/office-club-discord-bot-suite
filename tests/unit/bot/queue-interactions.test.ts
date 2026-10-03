import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { TenManComponentInteractionRouter } from '../../../src/modules/tenman/bot/interaction-router.js';
import { createQueueCustomId } from '../../../src/modules/tenman/bot/queue-custom-id.js';
import { createSteamAccountCustomId } from '../../../src/modules/tenman/bot/steam-account-custom-id.js';
import { createPartyCustomId } from '../../../src/modules/tenman/bot/party-custom-id.js';
import { createPlayerHubCustomId } from '../../../src/modules/tenman/bot/player-hub-custom-id.js';

const secret = 'queue-router-test-secret';
const guildId = '123456789012345678';
const userId = '223456789012345678';

function interaction(customId: string, componentsV2 = false) {
  return {
    customId,
    guildId,
    user: { id: userId, globalName: 'Player', username: 'player' },
    message: { flags: { has: vi.fn().mockReturnValue(componentsV2) } },
    id: 'interaction-1',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    isModalSubmit: vi.fn().mockReturnValue(false),
    isMessageComponent: vi.fn().mockReturnValue(true),
    isStringSelectMenu: vi.fn().mockReturnValue(false),
  };
}

function prismaMock(overrides: {
  queue?: unknown;
  joinResult?: unknown;
  status?: { steam: boolean; queued: boolean };
}) {
  const queue =
    'queue' in overrides
      ? overrides.queue
      : {
          guildId,
          version: 5,
          status: 'OPEN',
          panelChannelId: null,
          panelMessageId: null,
          entries: [],
        };
  const joinResult =
    'joinResult' in overrides
      ? overrides.joinResult
      : { status: 'joined', playersInQueue: 3, queueSize: 10, promotedMatchId: undefined };
  const prisma = {
    $transaction: vi.fn().mockImplementation(async (callback: unknown) => {
      // QueueService.join returns the transaction result directly; return the
      // canned result instead of simulating the full transaction.
      void callback;
      return joinResult;
    }),
    tenManQueue: { findUnique: vi.fn().mockResolvedValue(queue) },
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({ queueSize: 10, partyEnabled: false }),
    },
    tenManQueueEntry: {
      findUnique: vi.fn().mockResolvedValue(overrides.status?.queued ? { partyId: null } : null),
    },
    steamIdentity: {
      findFirst: vi
        .fn()
        .mockResolvedValue(overrides.status?.steam === false ? null : { steamId64: '1' }),
    },
    match: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    tenManPartyMember: { findUnique: vi.fn().mockResolvedValue(null) },
    tenManPartyInvite: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return prisma;
}

function router(prisma: PrismaClient) {
  return new TenManComponentInteractionRouter({
    prisma,
    componentSigningSecret: secret,
    actorFor: vi.fn(),
    adminActorFor: vi.fn(),
    participantInfo: { get: vi.fn() } as never,
    discord: { channels: { fetch: vi.fn() } } as never,
    guildResourceService: {} as never,
    matchService: {} as never,
    steamAccountService: {} as never,
    steamProfileService: {} as never,
  });
}

describe('queue component interactions', () => {
  it('responds to a stale mutating control with a recovery interface', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 9,
        status: 'OPEN',
        panelChannelId: null,
        panelMessageId: null,
        entries: [],
      },
    });
    const event = interaction(
      createQueueCustomId({ action: 'TOGGLE', guildId, version: 5 }, secret),
    );
    await router(prisma).handle(event as never);
    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.reply).not.toHaveBeenCalled();
    expect(event.deferUpdate).not.toHaveBeenCalled();
    expect(event.editReply).toHaveBeenCalledWith({
      content: 'The queue changed; the panel has been refreshed.',
    });
  });

  it('keeps How It Works usable even when the panel version is stale', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 9,
        status: 'OPEN',
        panelChannelId: null,
        panelMessageId: null,
        entries: [],
      },
    });
    const event = interaction(
      createQueueCustomId({ action: 'HOW_IT_WORKS', guildId, version: 1 }, secret),
    );
    await router(prisma).handle(event as never);
    expect(event.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining('ready check'),
      }),
    );
  });

  it('Refresh reconciles the panel without requiring a fresh version', async () => {
    const prisma = prismaMock({});
    const event = interaction(
      createQueueCustomId({ action: 'REFRESH', guildId, version: 0 }, secret),
    );
    await router(prisma).handle(event as never);
    expect(event.deferUpdate).not.toHaveBeenCalled();
    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.editReply).toHaveBeenCalledWith({ content: 'Match Queue panel refreshed.' });
  });

  it('replaces a member’s previous ephemeral queue refresh reply', async () => {
    const subject = router(prismaMock({}));
    const first = interaction(
      createQueueCustomId({ action: 'REFRESH', guildId, version: 0 }, secret),
    );
    const second = interaction(
      createQueueCustomId({ action: 'REFRESH', guildId, version: 0 }, secret),
    );

    await subject.handle(first as never);
    await subject.handle(second as never);

    expect(first.deleteReply).toHaveBeenCalledOnce();
    expect(second.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('returns a rich ephemeral summary on join success', async () => {
    const prisma = prismaMock({
      joinResult: {
        status: 'joined',
        playersInQueue: 3,
        queueSize: 10,
        promotedMatchId: undefined,
      },
    });
    const event = interaction(createQueueCustomId({ action: 'JOIN', guildId, version: 5 }, secret));
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: { toJSON(): { components: { label?: string }[] } }[];
    };
    expect(reply.content).toContain("You're in the queue");
    expect(reply.content).toContain('3 / 10');
    expect(reply.content).toContain('Needed: 7');
    expect(reply.components).toEqual([]);
  });

  it('confirms an individual leave without duplicating Match Queue controls', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 5,
        status: 'OPEN',
        entries: [{ discordUserId: userId, partyId: null, joinedAt: new Date(0) }],
      },
      joinResult: { removedCount: 1, wasParty: false },
    });
    const event = interaction(
      createQueueCustomId({ action: 'TOGGLE', guildId, version: 5 }, secret),
    );
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: unknown[];
    };
    expect(reply.content).toBe('You left the queue.');
    expect(reply.components).toEqual([]);
  });

  it('executes a confirmed party leave and reports the removal', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 5,
        status: 'OPEN',
        entries: [
          { discordUserId: userId, partyId: 'p1', joinedAt: new Date(0) },
          { discordUserId: 'other', partyId: 'p1', joinedAt: new Date(1) },
        ],
      },
      joinResult: { removedCount: 2, wasParty: true },
    });
    const event = interaction(
      createQueueCustomId({ action: 'LEAVE_CONFIRM', guildId, version: 5 }, secret),
    );
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: unknown[];
    };
    expect(reply.content).toBe('Your party was removed from the queue.');
    expect(reply.components).toEqual([]);
  });

  it('explains a queue ban with its expiry instead of failing', async () => {
    const expiresAt = new Date('2026-09-24T00:00:00Z');
    const prisma = prismaMock({
      joinResult: { status: 'queue_banned', expiresAt, reason: 'No-show' },
    });
    const event = interaction(createQueueCustomId({ action: 'JOIN', guildId, version: 5 }, secret));
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as { content: string };
    expect(reply.content).toContain("can't join this queue right now");
    expect(reply.content).toContain('Available again');
    expect(reply.content).toContain('No-show');
  });

  it('returns a fixable prompt when join lacks a Steam assignment', async () => {
    const prisma = prismaMock({
      joinResult: { status: 'missing_steam', memberCount: 1, missingDisplayNames: ['Player'] },
    });
    const event = interaction(createQueueCustomId({ action: 'JOIN', guildId, version: 5 }, secret));
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: unknown[];
    };
    expect(reply.content).toContain('Steam account needed');
    expect(reply.components.length).toBeGreaterThan(0);
  });

  it('reports queue position when the player is already queued', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 5,
        status: 'OPEN',
        entries: [
          { discordUserId: '1', joinedAt: new Date(0) },
          { discordUserId: userId, joinedAt: new Date(1) },
        ],
      },
      joinResult: { status: 'already_queued', playersInQueue: 2, queueSize: 10 },
    });
    const event = interaction(createQueueCustomId({ action: 'JOIN', guildId, version: 5 }, secret));
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: unknown[];
    };
    expect(reply.content).toContain('already in the queue');
    expect(reply.content).toContain('Position: 2');
    expect(reply.components).toEqual([]);
  });

  it('requires confirmation before a party leave removes every member', async () => {
    const prisma = prismaMock({
      queue: {
        guildId,
        version: 5,
        status: 'OPEN',
        entries: [
          { discordUserId: userId, partyId: 'p1', joinedAt: new Date(0) },
          { discordUserId: 'other', partyId: 'p1', joinedAt: new Date(1) },
          { discordUserId: 'third', partyId: 'p1', joinedAt: new Date(2) },
        ],
      },
    });
    const event = interaction(
      createQueueCustomId({ action: 'LEAVE', guildId, version: 5 }, secret),
    );
    await router(prisma).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: { toJSON(): { components: { custom_id?: string; label?: string }[] } }[];
    };
    expect(reply.content).toContain('Remove your party from the queue?');
    expect(reply.content).toContain('all 3 members');
    const labels = reply.components.flatMap((row) =>
      row.toJSON().components.map((component) => component.label),
    );
    expect(labels).toEqual(['Remove Party']);
  });
});

describe('queue panel personal surfaces', () => {
  const publicHistoryCustomId = createPlayerHubCustomId(
    { action: 'HISTORY', guildId, actorDiscordUserId: '00000000000000000000' },
    secret,
  );

  it('opens Match History ephemerally from the public Components V2 queue panel', async () => {
    const event = interaction(publicHistoryCustomId, true);

    await router(prismaMock({})).handle(event as never);

    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.deferUpdate).not.toHaveBeenCalled();
    expect(event.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('opens Team Status ephemerally from the public Components V2 queue panel', async () => {
    const event = interaction(
      createPartyCustomId(
        { action: 'PANEL', guildId, actorDiscordUserId: '00000000000000000000' },
        secret,
      ),
      true,
    );

    await router(prismaMock({})).handle(event as never);

    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.deferUpdate).not.toHaveBeenCalled();
    expect(event.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }),
    );
  });

  it('rejects public-panel placeholder IDs for party mutations', async () => {
    const event = interaction(
      createPartyCustomId(
        { action: 'CREATE', guildId, actorDiscordUserId: '00000000000000000000' },
        secret,
      ),
      true,
    );

    await expect(router(prismaMock({})).handle(event as never)).rejects.toThrow(
      'Party control does not belong to this interaction',
    );
    expect(event.deferReply).not.toHaveBeenCalled();
    expect(event.deferUpdate).not.toHaveBeenCalled();
  });

  it('rejects a public Team Status control from another guild', async () => {
    const event = interaction(
      createPartyCustomId(
        {
          action: 'PANEL',
          guildId: '323456789012345678',
          actorDiscordUserId: '00000000000000000000',
        },
        secret,
      ),
      true,
    );

    await expect(router(prismaMock({})).handle(event as never)).rejects.toThrow(
      'Party control does not belong to this guild',
    );
  });

  it('rejects a personal history control from another guild', async () => {
    const event = interaction(
      createPlayerHubCustomId(
        {
          action: 'HISTORY',
          guildId: '323456789012345678',
          actorDiscordUserId: '00000000000000000000',
        },
        secret,
      ),
      true,
    );

    await expect(router(prismaMock({})).handle(event as never)).rejects.toThrow(
      'Player control does not belong to this guild',
    );
  });
});

describe('steam account panel entry point', () => {
  function steamRouter(prisma: PrismaClient, findActive: unknown) {
    return new TenManComponentInteractionRouter({
      prisma,
      componentSigningSecret: secret,
      actorFor: vi.fn(),
      adminActorFor: vi.fn(),
      participantInfo: { get: vi.fn() } as never,
      discord: { channels: { fetch: vi.fn() } } as never,
      guildResourceService: {} as never,
      matchService: {} as never,
      steamAccountService: { findActive: vi.fn().mockResolvedValue(findActive) } as never,
      steamProfileService: {} as never,
    });
  }

  it('shows the assignment prompt when no Steam account is assigned', async () => {
    const prisma = prismaMock({});
    const event = interaction(
      createSteamAccountCustomId(
        { action: 'VIEW', guildId, actorDiscordUserId: '00000000000000000000' },
        secret,
      ),
    );
    await steamRouter(prisma, null).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: { components: { label?: string }[] }[];
    };
    expect(reply.content).toContain('do not have an assigned Steam account');
    expect(reply.components[0]?.components[0]?.label).toBe('Assign Steam Account');
  });

  it('shows the assigned SteamID64 with change/remove actions and no ownership claim', async () => {
    const prisma = prismaMock({});
    const event = interaction(
      createSteamAccountCustomId(
        { action: 'VIEW', guildId, actorDiscordUserId: '00000000000000000000' },
        secret,
      ),
    );
    await steamRouter(prisma, {
      steamId64: '76561198000000000',
      assignedAt: new Date('2026-09-01T00:00:00Z'),
    }).handle(event as never);
    const reply = event.editReply.mock.calls.at(0)?.[0] as {
      content: string;
      components: { components: { label?: string }[] }[];
    };
    expect(reply.content).toContain('76561198000000000');
    expect(reply.content).toContain('does not verify Steam ownership');
    const labels = reply.components[0]?.components.map((component) => component.label);
    expect(labels).toEqual(['Change Steam Account', 'Remove Assignment']);
  });

  it('acknowledges Steam assignment modals ephemerally before the external assignment runs', async () => {
    const prisma = prismaMock({});
    const assign = vi.fn().mockResolvedValue({
      status: 'assigned',
      steamId64: '76561198000000000',
      displayName: 'Player',
    });
    const subject = new TenManComponentInteractionRouter({
      prisma,
      componentSigningSecret: secret,
      actorFor: vi.fn(),
      adminActorFor: vi.fn(),
      participantInfo: { get: vi.fn() } as never,
      discord: { channels: { fetch: vi.fn() } } as never,
      guildResourceService: {} as never,
      matchService: {} as never,
      steamAccountService: { assign } as never,
      steamProfileService: {} as never,
    });
    const event = {
      ...interaction(
        createSteamAccountCustomId(
          { action: 'MODAL', guildId, actorDiscordUserId: userId },
          secret,
        ),
      ),
      fields: { getTextInputValue: vi.fn().mockReturnValue('76561198000000000') },
      isModalSubmit: vi.fn().mockReturnValue(true),
      isMessageComponent: vi.fn().mockReturnValue(false),
    };

    await subject.handle(event as never);

    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      assign.mock.invocationCallOrder[0] ?? 0,
    );
    expect(event.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('assigned') }),
    );
  });
});
