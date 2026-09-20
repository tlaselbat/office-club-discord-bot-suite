import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsService } from '../../../src/modules/tenman/services/diagnostics-service.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';

function createMockPrisma(overrides: object = {}): PrismaClient {
  return {
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        enabled: true,
        lobbyTextChannelId: 'text',
        lobbyVoiceChannelId: 'lobby',
        team1VoiceChannelId: 'team1',
        team2VoiceChannelId: 'team2',
        privilegedRoleIds: ['role-1'],
        moderatorRoleIds: ['role-2'],
        administratorRoleIds: ['role-3'],
        dathostTemplateServerId: 'template-1',
        managedResourceState: 'NONE',
        managedSetupStep: null,
        managedCategoryId: null,
        managedChannelIds: [],
        managedResourcesCreatedAt: null,
        ...overrides,
      }),
    },
    match: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    tenManQueue: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;
}

function createMockClient(permissionsOk = true) {
  const channels = new Map([
    ['text', { id: 'text', type: ChannelType.GuildText, name: 'text' }],
    ['lobby', { id: 'lobby', type: ChannelType.GuildVoice, name: 'lobby' }],
    ['team1', { id: 'team1', type: ChannelType.GuildVoice, name: 'team1' }],
    ['team2', { id: 'team2', type: ChannelType.GuildVoice, name: 'team2' }],
  ]);
  return {
    user: { id: 'bot-1' },
    guilds: {
      fetch: async () => ({
        id: 'guild-1',
        channels: {
          fetch: async (id: string) => channels.get(id) ?? null,
        },
        roles: {
          fetch: async () => ({ id: 'role-1', name: 'role' }),
        },
        members: {
          me: {
            permissions: { has: () => permissionsOk },
            permissionsIn: () => ({
              has: () => permissionsOk,
            }),
          },
          fetch: async () => ({
            permissionsIn: () => ({
              has: () => permissionsOk,
            }),
          }),
        },
      }),
    },
  };
}

function createMockDathost(reachable: boolean): { getServer: ReturnType<typeof vi.fn> } {
  return {
    getServer: vi.fn().mockResolvedValue(reachable ? { id: 'template-1' } : null),
  };
}

describe('DiagnosticsService', () => {
  it('reports a healthy configuration', async () => {
    const prisma = createMockPrisma();
    const client = createMockClient(true);
    const dathost = createMockDathost(true);
    const service = new DiagnosticsService(
      prisma,
      client as unknown as ConstructorParameters<typeof DiagnosticsService>[1],
      dathost as unknown as ConstructorParameters<typeof DiagnosticsService>[2],
    );

    const report = await service.runGuildDiagnostics('guild-1');

    expect(report.configured).toBe(true);
    expect(report.enabled).toBe(true);
    expect(report.channels.every((channel) => channel.ok)).toBe(true);
    expect(report.roles.every((role) => role.ok)).toBe(true);
    expect(report.permissions.every((permission) => permission.ok)).toBe(true);
    expect(report.template?.ok).toBe(true);
  });

  it('reports unconfigured guild', async () => {
    const prisma = createMockPrisma();
    prisma.tenManSettings.findUnique = vi.fn().mockResolvedValue(null);
    const service = new DiagnosticsService(
      prisma,
      createMockClient() as unknown as ConstructorParameters<typeof DiagnosticsService>[1],
      createMockDathost(true) as unknown as ConstructorParameters<typeof DiagnosticsService>[2],
    );

    const report = await service.runGuildDiagnostics('guild-1');

    expect(report.configured).toBe(false);
  });

  it('reports missing channel', async () => {
    const prisma = createMockPrisma();
    const client = {
      user: { id: 'bot-1' },
      guilds: {
        fetch: async () => ({
          id: 'guild-1',
          channels: { fetch: async () => null },
          roles: { fetch: async () => ({ id: 'role-1' }) },
          members: {
            me: {
              permissions: { has: () => true },
              permissionsIn: () => ({ has: () => true }),
            },
            fetch: async () => ({ permissionsIn: () => ({ has: () => true }) }),
          },
        }),
      },
    };
    const service = new DiagnosticsService(
      prisma,
      client as unknown as ConstructorParameters<typeof DiagnosticsService>[1],
      createMockDathost(true) as unknown as ConstructorParameters<typeof DiagnosticsService>[2],
    );

    const report = await service.runGuildDiagnostics('guild-1');

    expect(report.channels.some((channel) => !channel.ok)).toBe(true);
  });

  it('reports missing permissions', async () => {
    const prisma = createMockPrisma();
    const service = new DiagnosticsService(
      prisma,
      createMockClient(false) as unknown as ConstructorParameters<typeof DiagnosticsService>[1],
      createMockDathost(true) as unknown as ConstructorParameters<typeof DiagnosticsService>[2],
    );

    const report = await service.runGuildDiagnostics('guild-1');

    expect(report.permissions.some((permission) => !permission.ok)).toBe(true);
  });

  it('reports queue and forming match state from persistence', async () => {
    const prisma = createMockPrisma({ v2Enabled: true });
    prisma.tenManQueue.findUnique = vi.fn().mockResolvedValue({
      status: 'LOCKED',
      version: 9,
      panelChannelId: 'text',
      panelMessageId: 'message-1',
      entries: [{ id: 'entry-1' }],
    });
    prisma.match.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'match-1',
        state: 'READY_CHECK',
        phaseDeadlineAt: new Date('2026-09-17T00:00:00.000Z'),
        phaseGeneration: 3,
        players: [{ readyState: 'READY' }, { readyState: 'NOT_READY' }],
      });
    const service = new DiagnosticsService(
      prisma,
      createMockClient() as unknown as ConstructorParameters<typeof DiagnosticsService>[1],
      createMockDathost(true) as unknown as ConstructorParameters<typeof DiagnosticsService>[2],
    );

    const report = await service.runGuildDiagnostics('guild-1');

    expect(report.tenMan).toMatchObject({
      queue: { status: 'LOCKED', entries: 1, version: 9 },
      formingMatch: { state: 'READY_CHECK', ready: 1, participants: 2 },
    });
  });
});
