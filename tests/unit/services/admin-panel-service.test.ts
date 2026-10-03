import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { AdminPanelService } from '../../../src/modules/tenman/services/admin-panel-service.js';

const guildId = '123456789012345678';

function fixture() {
  const edit = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue({ id: 'new-panel' });
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    messages: { fetch: vi.fn().mockResolvedValue({ edit }) },
    send,
  };
  const prisma = {
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({
        guildId,
        version: 5,
        enabled: true,
        adminChannelId: 'admin-channel',
        adminPanelMessageId: 'admin-panel',
        queueSize: 10,
        defaultGameProfileKey: 'competitive_5v5',
        defaultServerLocation: 'dallas',
        teamSelectionMode: 'CAPTAINS',
        mapSelectionMode: 'CAPTAIN_VETO',
        activeMapPool: [],
      }),
      update: vi.fn(),
    },
    tenManQueue: {
      findUnique: vi.fn().mockResolvedValue({ version: 3, status: 'OPEN', entries: [] }),
    },
    matchModerator: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    gameProfile: {
      findUnique: vi.fn().mockResolvedValue({ mapAllowlist: ['de_mirage', 'de_inferno'] }),
    },
    guildWorkshopMap: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
  const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };
  return { prisma, client, channel, edit, send };
}

describe('admin panel service', () => {
  it('edits the singleton message into the integrated maps view', async () => {
    const { prisma, client, edit, send } = fixture();
    await new AdminPanelService(prisma, client as never, 'secret').reconcile(guildId, {
      kind: 'MAPS',
      page: 0,
    });

    expect(edit).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    const payload = edit.mock.calls[0]?.[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(payload.embeds[0]?.toJSON().title).toBe('Map Source and Pool');
  });
});
