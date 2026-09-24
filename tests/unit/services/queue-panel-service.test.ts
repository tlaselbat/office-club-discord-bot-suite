import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { QueuePanelService } from '../../../src/modules/tenman/services/queue-panel-service.js';

const secret = 'panel-test-secret';
const guildId = '123456789012345678';

function prismaMock(queue: unknown) {
  return {
    tenManQueue: {
      findUnique: vi.fn().mockResolvedValue(queue),
      update: vi.fn().mockResolvedValue({}),
    },
    tenManSettings: {
      findUnique: vi.fn().mockResolvedValue({ queueSize: 10 }),
    },
    match: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
}

function channel(messages: { fetch: ReturnType<typeof vi.fn>; send?: ReturnType<typeof vi.fn> }) {
  return {
    id: 'channel-1',
    isTextBased: () => true,
    messages: { fetch: messages.fetch },
    send: messages.send ?? vi.fn().mockResolvedValue({ id: 'new-message' }),
  };
}

const openQueue = {
  guildId,
  status: 'OPEN',
  version: 3,
  panelChannelId: 'channel-1',
  panelMessageId: 'old-message',
  entries: [],
};

describe('queue panel reconciliation', () => {
  it('edits the existing persistent message instead of posting a new one', async () => {
    const prisma = prismaMock(openQueue);
    const edit = vi.fn().mockResolvedValue({});
    const text = channel({ fetch: vi.fn().mockResolvedValue({ edit }) });
    const service = new QueuePanelService(prisma, {} as never, secret);
    await service.reconcile(guildId, text as never);
    expect(edit).toHaveBeenCalledOnce();
    expect(text.send).not.toHaveBeenCalled();
    expect(prisma.tenManQueue.update).not.toHaveBeenCalled();
  });

  it('recreates the panel when the Discord message was deleted', async () => {
    const prisma = prismaMock(openQueue);
    const send = vi.fn().mockResolvedValue({ id: 'new-message' });
    const text = channel({ fetch: vi.fn().mockRejectedValue(new Error('Unknown Message')), send });
    const service = new QueuePanelService(prisma, {} as never, secret);
    await service.reconcile(guildId, text as never);
    expect(send).toHaveBeenCalledOnce();
    expect(prisma.tenManQueue.update).toHaveBeenCalledWith({
      where: { guildId },
      data: { panelChannelId: 'channel-1', panelMessageId: 'new-message' },
    });
  });

  it('propagates a failed edit without touching queue records, leaving repair to retry', async () => {
    const prisma = prismaMock(openQueue);
    const text = channel({
      fetch: vi.fn().mockResolvedValue({
        edit: vi.fn().mockRejectedValue(new Error('Discord outage')),
      }),
    });
    const service = new QueuePanelService(prisma, {} as never, secret);
    await expect(service.reconcile(guildId, text as never)).rejects.toThrow('Discord outage');
    expect(prisma.tenManQueue.update).not.toHaveBeenCalled();
    expect(text.send).not.toHaveBeenCalled();
  });

  it('does nothing when the guild has no queue or settings row', async () => {
    const prisma = prismaMock(null);
    const service = new QueuePanelService(prisma, {} as never, secret);
    await service.reconcile(guildId);
    expect(prisma.tenManQueue.update).not.toHaveBeenCalled();
  });
});
