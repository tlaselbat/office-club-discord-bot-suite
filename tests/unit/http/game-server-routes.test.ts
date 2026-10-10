import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGameServersRoutes } from '../../../src/http/routes/admin/game-servers.js';
import type { SharedHelpers } from '../../../src/http/routes/admin/shared.js';
import {
  CARD_PLACEHOLDERS,
  defaultUpdatesElement,
  resolveCardLayout,
} from '../../../src/modules/game-servers/card-profile.js';
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
  it('accepts empty hidden legacy button fields and preserves independent button toggles', async () => {
    const { app, url, payload, updateServer } = fixture();
    const layoutJson = JSON.stringify({ version: 3, buttons: [], elements: resolveCardLayout({}) });
    for (const [connect, mapRules, expected] of [
      ['', '1', { connect: false, mapRules: true }],
      ['1', '', { connect: true, mapRules: false }],
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        payload: {
          ...payload,
          layoutVersion: '3',
          layoutJson,
          showConnectButton: connect,
          showMapRulesButton: mapRules,
        },
      });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toContain('?saved=1#card-designer');
      expect(updateServer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cardProfile: expect.objectContaining({ buttons: expect.objectContaining(expected) }),
        }),
      );
    }
  });

  it('returns layout field errors and preserves the invalid submitted draft', async () => {
    const { app, url, payload, updateServer } = fixture();
    const invalidLayout = JSON.stringify({
      version: 3,
      buttons: [],
      elements: [{ id: 'invalid-id', type: 'text', visible: true, template: 'Keep this draft' }],
    });
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        layoutVersion: '3',
        layoutJson: invalidLayout,
        showConnectButton: '',
        showMapRulesButton: '',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Card Layout needs correction');
    expect(response.body).toContain('Card Layout elements.0.id');
    expect(response.body).toContain('Keep this draft');
    expect(response.body).toContain('id="layoutJson-error"');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('identifies strict-schema fields and preserves the submitted values', async () => {
    const { app, url, payload, updateServer } = fixture();
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, displayName: 'Keep this name', unknownControl: 'unexpected' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Unexpected form field: unknownControl');
    expect(response.body).toContain('value="Keep this name"');
    expect(updateServer).not.toHaveBeenCalled();
  });

  it('keeps an invalid saved layout intact and offers an explicit recovery path', async () => {
    const { app, url, shared } = fixture();
    const saved = await shared.deps.prisma.gameServer.findFirst();
    shared.deps.prisma.gameServer.findFirst.mockResolvedValue({
      ...saved,
      cardProfile: { layout: { version: 99, buttons: [], elements: [] } },
    });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-layout-valid="false"');
    expect(response.body).toContain('data-saved-layout-invalid="true"');
    expect(response.body).toContain('&quot;version&quot;:99');
    expect(response.body).toContain(
      'Restoring defaults replaces the entire card layout and appearance',
    );
  });

  it('preserves an invalid submitted layout so Discard can reload saved configuration', async () => {
    const { app, url, payload, updateServer } = fixture();
    const invalidDraft = JSON.stringify({
      version: 3,
      buttons: [],
      elements: [{ id: 'bad', type: 'unknown' }],
    });
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, layoutVersion: '3', layoutJson: invalidDraft },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('data-submitted-edits');
    expect(response.body).toContain('data-layout-valid="false"');
    expect(response.body).toContain('data-saved-layout-invalid="false"');
    expect(response.body).toContain('&quot;type&quot;:&quot;unknown&quot;');
    expect(updateServer).not.toHaveBeenCalled();
  });

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
    expect(page.body).toContain('Starting example');
    expect(page.body).toContain('Stale example');
    expect(page.body).toContain('Widen preview');
    expect(page.body).toContain('Show or hide card contents');
    expect(page.body).toContain('Community Updates preset');
    for (const [name] of CARD_PLACEHOLDERS) {
      expect(page.body).toContain(`value="{${name}}"`);
    }
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
        showConnectButton: '1',
        showMapRulesButton: '1',
        layoutVersion: '2',
        layoutJson: JSON.stringify({ version: 2, elements }),
      },
    });
    expect(response.statusCode).toBe(303);
    const command = updateServer.mock.calls[0]?.[0] as { cardProfile: CardProfile };
    expect(command.cardProfile.layout?.version).toBe(2);
    expect(command.cardProfile.layout?.elements.map((element) => element.type)).toEqual(
      elements.map((element) => element.type),
    );
    expect(command.cardProfile.layout?.elements.map((element) => element.id)).toEqual(
      elements.map((element) => element.id),
    );
    expect(command.cardProfile.buttons).toMatchObject({
      connect: true,
      mapRules: true,
      connectLabel: 'Connect',
      mapRulesLabel: 'Map & Rules',
    });
  });
  it('accepts restored default legacy buttons on the first edit submission', async () => {
    const { app, url, payload, updateServer } = fixture();
    const elements = resolveCardLayout(undefined, null);
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        showConnectButton: '1',
        showMapRulesButton: '1',
        layoutVersion: '3',
        layoutJson: JSON.stringify({ version: 3, buttons: [], elements }),
      },
    });
    expect(response.statusCode).toBe(303);
    expect(updateServer).toHaveBeenCalledOnce();
  });
  it('persists and hydrates a custom Community Updates nested layout', async () => {
    const { app, url, payload, updateServer, shared } = fixture();
    const original = (await shared.deps.prisma.gameServer.findFirst()) as {
      cardProfile: unknown;
      description: string | null;
    };
    const layout = resolveCardLayout(original.cardProfile, original.description);
    const blocks = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        type: 'text',
        visible: true,
        template: 'Patch notes for {servername}',
        style: 'medium',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        type: 'gallery',
        visible: true,
        items: [
          {
            id: '00000000-0000-4000-8000-000000000103',
            source: 'custom',
            url: 'https://example.com/release.png',
            description: 'Release image',
          },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000104',
        type: 'separator',
        visible: true,
        divider: true,
        spacing: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000105',
        type: 'feed',
        feed: 'CHANGELOG',
        visible: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000106',
        type: 'feed',
        feed: 'ANNOUNCEMENTS',
        visible: true,
      },
    ];
    const legacyUpdates = defaultUpdatesElement('00000000-0000-4000-8000-000000000100');
    if (legacyUpdates.type !== 'updates') throw new Error('Expected legacy Updates fixture');
    const elements = [...layout.slice(0, -3), { ...legacyUpdates, blocks }];
    const result = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...payload,
        layoutVersion: '2',
        layoutJson: JSON.stringify({ version: 2, elements }),
      },
    });
    expect(result.statusCode).toBe(303);
    const command = updateServer.mock.calls[0]?.[0] as { cardProfile: CardProfile };
    expect(command.cardProfile.layout?.version).toBe(2);
    expect(
      command.cardProfile.layout?.elements.find((element) => element.type === 'updates'),
    ).toMatchObject({
      type: 'updates',
      blocks,
    });
    const savedUpdates = command.cardProfile.layout?.elements.find(
      (element) => element.type === 'updates',
    );
    expect(savedUpdates?.type).toBe('updates');
    expect(
      savedUpdates?.type === 'updates'
        ? savedUpdates.blocks?.find((block) => block.id === blocks[0]?.id)
        : undefined,
    ).toMatchObject({
      type: 'text',
      template: 'Patch notes for {servername}',
    });
    shared.deps.prisma.gameServer.findFirst.mockResolvedValue({
      ...original,
      cardProfile: command.cardProfile,
    });
    const reload = await app.inject({ method: 'GET', url });
    expect(reload.statusCode).toBe(200);
    expect(reload.body).toContain('Patch notes for {servername}');
    expect(reload.body).toContain('release.png');
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
