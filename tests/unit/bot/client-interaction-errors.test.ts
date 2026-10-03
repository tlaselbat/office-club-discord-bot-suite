import { Events, MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createDiscordClient } from '../../../src/bot/client.js';
import { createQueueCustomId } from '../../../src/modules/tenman/bot/queue-custom-id.js';
import { createSteamAccountCustomId } from '../../../src/modules/tenman/bot/steam-account-custom-id.js';

const guildId = '123456789012345678';
const userId = '223456789012345678';
const secret = 'client-interaction-error-secret';
const clients: ReturnType<typeof createDiscordClient>[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) void client.destroy();
});

function dependencies(
  prisma: PrismaClient,
  assign = vi.fn(),
): Parameters<typeof createDiscordClient>[0] {
  return {
    token: 'test-token',
    clientId: '123456789012345678',
    prisma,
    matchService: {} as never,
    steamAccountService: { assign } as never,
    steamProfileService: {} as never,
    dathost: {} as never,
    componentSigningSecret: secret,
    credentialCipher: {} as never,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never,
  };
}

function interaction(customId: string, modal: boolean) {
  const event = {
    customId,
    guildId,
    id: 'interaction-1',
    user: { id: userId, globalName: 'Player', username: 'player' },
    deferred: false,
    replied: false,
    deferReply: vi.fn(async () => {
      event.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    isChatInputCommand: vi.fn().mockReturnValue(false),
    isMessageComponent: vi.fn().mockReturnValue(!modal),
    isModalSubmit: vi.fn().mockReturnValue(modal),
    fields: { getTextInputValue: vi.fn().mockReturnValue('76561198000000000') },
  };
  return event;
}

describe('InteractionCreate deferred ephemeral errors', () => {
  it('edits an ephemeral deferred modal error instead of attempting another response', async () => {
    const assign = vi.fn().mockRejectedValue(new Error('Steam API timed out'));
    const client = createDiscordClient(dependencies({} as PrismaClient, assign));
    clients.push(client);
    const event = interaction(
      createSteamAccountCustomId({ action: 'MODAL', guildId, actorDiscordUserId: userId }, secret),
      true,
    );

    client.emit(Events.InteractionCreate, event as never);

    await vi.waitFor(() => expect(event.editReply).toHaveBeenCalledOnce());
    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.reply).not.toHaveBeenCalled();
    expect(event.followUp).not.toHaveBeenCalled();
  });

  it('reports a failed public queue refresh through its deferred ephemeral reply', async () => {
    const prisma = {
      tenManQueue: { findUnique: vi.fn().mockRejectedValue(new Error('database unavailable')) },
    } as unknown as PrismaClient;
    const client = createDiscordClient(dependencies(prisma));
    clients.push(client);
    const event = interaction(
      createQueueCustomId({ action: 'REFRESH', guildId, version: 0 }, secret),
      false,
    );

    client.emit(Events.InteractionCreate, event as never);

    await vi.waitFor(() => expect(event.editReply).toHaveBeenCalledOnce());
    expect(event.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(event.deferUpdate).not.toHaveBeenCalled();
    expect(event.reply).not.toHaveBeenCalled();
    expect(event.followUp).not.toHaveBeenCalled();
  });
});
