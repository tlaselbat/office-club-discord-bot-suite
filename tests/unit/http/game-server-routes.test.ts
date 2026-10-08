import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGameServersRoutes } from '../../../src/http/routes/admin/game-servers.js';
import type { SharedHelpers } from '../../../src/http/routes/admin/shared.js';
import { resolveCardLayout } from '../../../src/modules/game-servers/card-profile.js';
import type { CardProfile } from '../../../src/modules/game-servers/card-profile.js';
import { PublicError } from '../../../src/errors/public-error.js';

const guildId = '12345678901234567';
const serverId = '513af1bb-31fa-4b17-bd2e-2ec450984cea';
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture() {
  const saved = {
    id: serverId,
    guildId,
    displayName: 'Saved arena',
    description: 'Saved description',
    enabled: true,
    public: true,
    connectDomain: 'saved.example.com',
    joinUrl: null,
    imageUrl: null,
    sortOrder: 3,
    provider: 'DATHOST',
    providerServerId: 'provider-1',
    version: 4,
    snapshot: null,
    cards: [],
    updateThreads: [],
    cardProfile: {
      accentColor: '#123456',
      thumbnailImageUrl: 'https://example.com/icon.png',
      onlineEmojiId: '22345678901234567',
    },
  };
  const updateServer = vi.fn().mockResolvedValue(undefined);
  const shared = {
    deps: {
      prisma: {
        gameServer: {
          findFirst: vi.fn().mockResolvedValue(saved),
          findMany: vi.fn().mockResolvedValue([saved]),
        },
        gameServerSettings: {
          findUnique: vi.fn().mockResolvedValue({ enabled: true, version: 2 }),
        },
      },
      gameServerAdmin: { updateServer, listAvailableServers: vi.fn().mockResolvedValue([]) },
      gameServerDiagnostics: { runLive: vi.fn() },
    },
    headers: (reply: unknown) => reply,
    authenticate: vi.fn().mockResolvedValue({ discordUserId: 'owner', csrf: 'csrf' }),
    authenticatePost: vi.fn().mockResolvedValue({ discordUserId: 'owner', csrf: 'csrf' }),
    guild: vi.fn().mockReturnValue({
      name: 'Office Club',
      channels: { fetch: vi.fn().mockResolvedValue(new Map()) },
      emojis: {
        fetch: vi
          .fn()
          .mockResolvedValue(new Map([['32345678901234567', { id: '32345678901234567' }]])),
      },
    }),
    requestId: () => 'request-1',
  };
  const app = Fastify();
  registerGameServersRoutes(app, shared as unknown as SharedHelpers);
  apps.push(app);
  const payload = {
    csrf: 'csrf',
    version: '4',
    displayName: 'Unsaved arena',
    description: 'New description',
    enabled: '1',
    public: '1',
    sortOrder: '5',
    accentColor: '#abcdef',
    thumbnailImageUrl: 'https://example.com/new.png',
    onlineEmojiId: '32345678901234567',
  };
  return {
    app,
    shared,
    updateServer,
    payload,
    url: `/admin/guilds/${guildId}/game-servers/${serverId}/edit`,
  };
}

describe('Game Server configuration routes', () => {
  it('uses cached updates safely in the preview and reports persistence separately', async () => {
    const { app, url, shared, payload, updateServer } = fixture();
    const saved = await shared.deps.prisma.gameServer.findFirst();
    shared.deps.prisma.gameServer.findFirst.mockResolvedValue({
      ...saved,
      updateThreads: [
        {
          type: 'ANNOUNCEMENTS',
          threadId: '42345678901234567',
          latestMessageText: '<script>alert(1)</script>',
          latestMessageAt: null,
          notificationExpiresAt: null,
        },
      ],
    });
    const page = await app.inject({ method: 'GET', url });
    expect(page.body).toContain('data-update-threads');
    expect(page.body).toContain('Add Community Updates');
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(shared.deps.prisma.gameServer.findFirst).toHaveBeenLastCalledWith({
      where: { id: serverId, guildId },
      include: { snapshot: true, cards: true, updateThreads: true },
    });
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(303);
    expect(updateServer).toHaveBeenCalledOnce();
    expect(response.headers.location).toBe(url + '?saved=1#card-designer');
    const reloaded = await app.inject({ method: 'GET', url: url + '?saved=1' });
    expect(reloaded.body).toContain(
      'Configuration saved. Discord reconciliation is processed separately',
    );
  });
  it('saves the exact layout envelope emitted by the editor and preserves element IDs', async () => {
    const { app, url, payload, updateServer, shared } = fixture();
    const saved = (await shared.deps.prisma.gameServer.findFirst()) as {
      cardProfile: unknown;
      description: string;
    };
    const elements = resolveCardLayout(saved.cardProfile, saved.description).map((element) =>
      element.type === 'updates'
        ? {
            ...element,
            title: 'Release Notes',
            changelog: {
              ...element.changelog,
              openButtonLabel: 'View notes',
              latestMessageLength: 500,
            },
          }
        : element,
    );
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        layoutVersion: '2',
        layoutJson: JSON.stringify({ version: 2, elements }),
      },
    });
    expect(response.statusCode).toBe(303);
    const command = updateServer.mock.calls[0]?.[0] as { cardProfile: CardProfile };
    expect(command.cardProfile.layout?.elements).toEqual(elements);
  });
  it('hydrates saved registration and Card Profile', async () => {
    const { app, url } = fixture();
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('value="#123456"');
    expect(response.body).toContain('value="https://example.com/icon.png"');
    expect(response.body).toContain('value="22345678901234567"');
    expect(response.body).toContain('Saved description');
    for (let line = 1; line <= 6; line++) {
      expect(response.body).toContain(`aria-label="Card Line ${String(line)} text styling"`);
    }
    expect(response.body).toContain('data-markdown-marker="**"');
    expect(response.body).toContain('data-markdown-marker="__"');
  });

  it('saves independent styles and visibility in stable line order and reloads them', async () => {
    const { app, url, payload, updateServer, shared } = fixture();
    const order = [
      'serverAddress',
      'description',
      'currentMap',
      'playerCount',
      'subtitle',
      'title',
    ];
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        linesVersion: '1',
        lineOrder: order.join(','),
        titleTemplate: '{playercount}',
        titleStyle: 'medium',
        showTitle: '1',
        subtitleTemplate: '**{servername}**',
        subtitleStyle: 'normal',
        playerCountTemplate: '{location}',
        playerCountStyle: 'large',
        showPlayerCount: '1',
        descriptionTemplate: '<script>alert(1)</script> {currentmap}',
        descriptionStyle: 'small',
        showDescription: '1',
        currentMapTemplate: '{serveraddress}',
        currentMapStyle: 'subtext',
        showCurrentMap: '1',
        serverAddressTemplate: '{status} {severaddress}',
        serverAddressStyle: 'normal',
        showServerAddress: '1',
        showMapArtwork: '1',
      },
    });
    expect(response.statusCode).toBe(303);
    const command = updateServer.mock.calls[0]?.[0] as { cardProfile: CardProfile };
    expect(command.cardProfile.textLines?.map((line: { id: string }) => line.id)).toEqual(order);
    expect(command.cardProfile.textLines?.[4]).toMatchObject({
      id: 'subtitle',
      visible: false,
      style: 'normal',
    });
    expect(command.cardProfile.textLines?.[5]).toMatchObject({
      id: 'title',
      template: '{playercount}',
      style: 'medium',
    });
    expect(command.cardProfile.mapArtwork).toBe(true);
    const saved = await shared.deps.prisma.gameServer.findFirst();
    shared.deps.prisma.gameServer.findFirst.mockResolvedValue({
      ...saved,
      cardProfile: command.cardProfile,
    });
    const reload = await app.inject({ method: 'GET', url });
    expect(reload.body).toContain(`value="${order.join(',')}"`);
    expect(reload.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(reload.body).not.toContain('<script>alert(1)</script>');
    expect(reload.body).toContain('<option value="medium" selected>');
    expect(reload.body).not.toContain('name="showSubtitle" value="1" checked');
  });

  it('rejects duplicate line IDs and retains submitted line edits', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        linesVersion: '1',
        lineOrder: 'title,title,playerCount,description,currentMap,serverAddress',
        titleTemplate: '**{players}**',
        titleStyle: 'small',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('**{players}**');
    expect(response.body).toContain('<option value="small" selected>');
    expect(response.body).toContain('data-submitted-edits');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('saves typed profile fields through the authoritative service', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(303);
    expect(updateServer).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId,
        gameServerId: serverId,
        expectedVersion: 4,
        cardProfile: expect.objectContaining({
          accentColor: '#abcdef',
          onlineEmojiId: '32345678901234567',
          statusLabels: expect.objectContaining({ online: 'Online' }),
        }),
      }),
    );
  });

  it('retains unsaved values and field errors on malformed profile input', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, onlineEmojiId: 'invalid', enabled: undefined },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('value="Unsaved arena"');
    expect(response.body).toContain('value="invalid"');
    expect(response.body).toContain('aria-invalid="true"');
    expect(response.body).toContain('Saved arena');
    expect(response.body).not.toContain('name="enabled" value="1" checked');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('rejects unknown template placeholders before persisting configuration', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, descriptionTemplate: 'Live: {unknownfield}' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Unknown placeholder {unknownfield}.');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('rejects status emoji IDs that are not available in the Discord server', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, onlineEmojiId: '42345678901234567' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('must be available in this Discord server');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('keeps the submitted version and edits after a concurrency conflict', async () => {
    const { app, url, payload, updateServer } = fixture();
    updateServer.mockRejectedValue(
      new PublicError('STALE_CONFIGURATION', 'Configuration changed; reload and try again.'),
    );
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, version: '3' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('name="version" value="3"');
    expect(response.body).toContain('value="Unsaved arena"');
    expect(response.body).toContain('Configuration changed');
  });

  it('rejects malformed HTTPS URLs with field feedback and retains edits', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, imageUrl: 'https://', joinUrl: 'http://example.com' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('id="imageUrl-error"');
    expect(response.body).toContain('id="joinUrl-error"');
    expect(response.body).toContain('value="Unsaved arena"');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('does not mutate when authentication fails', async () => {
    const { app, url, payload, shared, updateServer } = fixture();
    shared.authenticatePost.mockResolvedValue(null);
    await app.inject({ method: 'POST', url, payload });
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('distinguishes provider outages from empty inventory', async () => {
    const { app, shared } = fixture();
    shared.deps.gameServerAdmin.listAvailableServers.mockRejectedValue(new Error('provider down'));
    const response = await app.inject({
      method: 'GET',
      url: `/admin/guilds/${guildId}/game-servers`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('DatHost inventory is unavailable');
    expect(response.body).toContain('Saved arena');
  });

  it('shows the legacy enabled default when no module settings row exists', async () => {
    const { app, shared } = fixture();
    shared.deps.prisma.gameServerSettings.findUnique.mockResolvedValue(null);
    const response = await app.inject({
      method: 'GET',
      url: `/admin/guilds/${guildId}/game-servers`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Disable module');
    expect(response.body).not.toContain('>Enable module</button>');
  });

  it('renders actionable diagnostics failure feedback', async () => {
    const { app, shared } = fixture();
    shared.deps.gameServerDiagnostics.runLive.mockRejectedValue(new Error('provider down'));
    const response = await app.inject({
      method: 'POST',
      url: `/admin/guilds/${guildId}/game-servers/diagnostics`,
      payload: { csrf: 'csrf' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Diagnostics are unavailable');
  });
});
