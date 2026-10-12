import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { chromium, type Browser, type Page } from 'playwright';
import { gameServerEditPage } from '../../src/http/admin/views/pages/game-servers.js';
import { panelCss } from '../../src/http/admin/views/styles.js';
import { panelScript } from '../../src/http/admin/views/client.js';
import { cardLayoutSchema, stableLayoutId } from '../../src/modules/game-servers/card-profile.js';

const connectId = '5841ee99-0000-4000-8000-00005841ee99';
const copyId = '69fbd921-08d1-4ed2-a515-4a02bb8d07c7';
const secondCopyId = '7d01396f-7001-4303-8c6a-82d58f62a061';
const rowId = '57a1d2c3-01ab-4cde-8fab-1234567890ab';
const scriptVersion = createHash('sha256').update(panelScript).digest('hex');
const cssVersion = createHash('sha256').update(panelCss).digest('hex');

type Button = {
  id: string;
  label: string;
  emoji: string | null;
  style: string;
  action: string;
  destination: string | null;
  visible: boolean;
};

const connect: Button = {
  id: connectId,
  label: 'Connect',
  emoji: '▶',
  style: 'primary',
  action: 'connect',
  destination: null,
  visible: true,
};
const copyAddress: Button = {
  id: copyId,
  label: 'Copy Address',
  emoji: null,
  style: 'secondary',
  action: 'copy-address',
  destination: null,
  visible: true,
};

function editPage(buttonIds: string[], buttons: Button[], version = 3): string {
  const elements =
    version === 3
      ? [
          ...Array.from({ length: 9 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            type: 'text' as const,
            label: `Text ${String(index + 1)}`,
            visible: true,
            template: `Text ${String(index + 1)}`,
            style: 'normal' as const,
            timestampMode: 'plain' as const,
          })),
          {
            id: rowId,
            type: 'button_row' as const,
            label: 'Server actions',
            visible: true,
            buttonIds,
          },
        ]
      : [{ id: rowId, type: 'actions' as const, label: 'Server actions', visible: true }];
  const parsed = cardLayoutSchema.safeParse({
    version,
    buttons: version === 3 ? buttons : [],
    elements,
  });
  if (!parsed.success) throw new Error(parsed.error.message);

  return gameServerEditPage({
    guildId: '12345678901234567',
    guildName: 'Office',
    username: 'browser fixture',
    csrf: 'fixture-only',
    server: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      displayName: 'Test server',
      description: null,
      enabled: true,
      public: true,
      connectDomain: null,
      joinUrl: null,
      imageUrl: null,
      sortOrder: 0,
      provider: 'dathost',
      providerServerId: 'fixture-server',
      version: 1,
      cardProfile: { layout: parsed.data, buttons: { connect: true, mapRules: true } },
    },
    textChannels: [],
    cards: [],
  });
}

async function fixtureServer(): Promise<{
  server: Server;
  baseUrl: string;
  assetHits: { javascript: number; css: number };
}> {
  const pages = new Map<string, string>([
    ['/connect-copy', editPage([connectId, copyId], [connect, copyAddress])],
    ['/copy-only', editPage([copyId], [connect, copyAddress])],
    ['/reversed', editPage([copyId, connectId], [connect, copyAddress])],
    [
      '/same-labels',
      editPage(
        [copyId, secondCopyId],
        [
          { ...copyAddress, label: 'Utility' },
          { ...copyAddress, id: secondCopyId, label: 'Utility' },
        ],
      ),
    ],
    ['/legacy-1', editPage([], [], 1)],
    ['/legacy-2', editPage([], [], 2)],
  ]);
  const assetHits = { javascript: 0, css: 0 };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/admin/assets/panel.js') {
      assetHits.javascript += 1;
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: `"${scriptVersion}"`,
      });
      response.end(panelScript);
      return;
    }
    if (path === '/admin/assets/panel.css') {
      assetHits.css += 1;
      response.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: `"${cssVersion}"`,
      });
      response.end(panelCss);
      return;
    }
    const html = pages.get(path);
    if (html === undefined) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('Fixture server did not bind.'));
      resolve({ server, baseUrl: `http://127.0.0.1:${String(address.port)}`, assetHits });
    });
  });
}

async function browserExecutable(): Promise<string | undefined> {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (configured) return configured;
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next installed browser.
      }
    }
  }
  return undefined;
}

async function placements(page: Page) {
  const layout = JSON.parse(await layoutJson(page)) as { buttons: Button[] };
  const actions = Object.fromEntries(layout.buttons.map((button) => [button.id, button.action]));
  return page.locator('[data-row-button] select').evaluateAll(
    (selects, metadata) =>
      selects.map((raw) => {
        const select = raw as {
          value: string;
          selectedIndex: number;
          selectedOptions: ArrayLike<{ textContent: string | null }>;
        };
        return {
          placementUuid: metadata.rowId,
          buttonUuid: select.value,
          actionType: metadata.actions[select.value] ?? 'missing',
          dropdownValue: select.value,
          selectedIndex: select.selectedIndex,
          optionLabel: select.selectedOptions[0]?.textContent?.trim() ?? '',
        };
      }),
    { actions: actions as Record<string, string>, rowId },
  );
}

function serverRenderedLayout(html: string) {
  const input = html.match(
    /<input type="hidden" name="layoutJson" id="card-layout-json"[^>]*>/,
  )?.[0];
  const value = input?.match(/\bvalue="([^"]*)"/)?.[1];
  if (value === undefined)
    throw new Error('Server HTML did not contain the hidden layoutJson input.');
  const decoded = value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(decoded) as {
    version: number;
    buttons: Button[];
    elements: Array<{ type: string; buttonIds?: string[] }>;
  };
}

async function layoutJson(page: Page) {
  return page.locator('#card-layout-json').inputValue();
}

async function outlineIds(page: Page) {
  return page
    .locator('#card-layout-editors > [data-layout-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        (node as { getAttribute(name: string): string | null }).getAttribute('data-layout-id'),
      ),
    );
}

async function main(): Promise<void> {
  const { server, baseUrl, assetHits } = await fixtureServer();
  let browser: Browser | undefined;
  try {
    const executablePath = await browserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const context = await browser.newContext();
    const responseHashes: string[] = [];
    const jsRequests: string[] = [];
    const browserEvidence: Array<Record<string, unknown>> = [];
    context.on('response', async (response) => {
      if (new URL(response.url()).pathname !== '/admin/assets/panel.js') return;
      responseHashes.push(
        createHash('sha256')
          .update(await response.body())
          .digest('hex'),
      );
    });
    context.on('request', (request) => {
      if (new URL(request.url()).pathname === '/admin/assets/panel.js')
        jsRequests.push(request.url());
    });

    const scenarios = [
      ['/connect-copy', [connectId, copyId]],
      ['/copy-only', [copyId]],
      ['/reversed', [copyId, connectId]],
      ['/same-labels', [copyId, secondCopyId]],
      [
        '/legacy-1',
        [stableLayoutId('legacy-button:connect'), stableLayoutId('legacy-button:map-rules')],
      ],
      [
        '/legacy-2',
        [stableLayoutId('legacy-button:connect'), stableLayoutId('legacy-button:map-rules')],
      ],
    ] as const;

    for (const [path, expectedIds] of scenarios) {
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      const source = await page.context().request.get(baseUrl + path);
      const html = await source.text();
      const serverLayout = serverRenderedLayout(html);
      const serverRow = serverLayout.elements.find((element) => element.type === 'button_row');
      if (!serverRow) throw new Error(`${path}: missing serialized Button Row.`);
      assert.deepEqual(
        serverRow.buttonIds,
        expectedIds,
        `${path}: server-rendered hidden layoutJson`,
      );
      if (
        path.startsWith('/connect-copy') ||
        path.startsWith('/copy-only') ||
        path.startsWith('/reversed') ||
        path.startsWith('/same-labels')
      )
        assert.equal(serverLayout.elements.length, 10, `${path}: ten-element fixture`);
      browserEvidence.push({
        path,
        checkpoint: 'server-rendered-before-initialization',
        version: serverLayout.version,
        buttonDefinitions: serverLayout.buttons.map(({ id, action }) => ({
          buttonUuid: id,
          actionType: action,
        })),
        placementUuids: serverRow.buttonIds ?? [],
      });
      assert.match(html, new RegExp(`/admin/assets/panel\\.js\\?v=${scriptVersion}`));
      assert.match(html, new RegExp(`/admin/assets/panel\\.css\\?v=${cssVersion}`));
      await page.goto(baseUrl + path);
      const before = await placements(page);
      assert.deepEqual(
        before.map((placement) => placement.buttonUuid),
        expectedIds,
        `${path}: initial mount`,
      );
      const preSubmit = JSON.parse(await layoutJson(page)) as {
        buttons: Button[];
        elements: Array<{ id: string; type: string; buttonIds?: string[] }>;
      };
      const serializedRow = preSubmit.elements.find((element) => element.type === 'button_row');
      assert.deepEqual(serializedRow?.buttonIds, expectedIds, `${path}: serialized placement`);
      assert.equal(
        await page
          .locator('#card-layout-json')
          .evaluate(
            (element) =>
              (element as { form: { dataset: { dirty?: string } } | null }).form?.dataset.dirty,
          ),
        'false',
        `${path}: initialization must not dirty an unchanged profile`,
      );
      const expectedPreview = (serverRow.buttonIds ?? []).map((id) => {
        const button = preSubmit.buttons.find((item) => item.id === id);
        if (!button) throw new Error(`${path}: missing button definition ${id}.`);
        return `${button.emoji ? `${button.emoji} ` : ''}${button.label}`;
      });
      assert.deepEqual(
        await page.locator('#card-template-preview .preview-action').allTextContents(),
        expectedPreview,
        `${path}: preview labels reflect the saved button UUIDs`,
      );
      browserEvidence.push({
        path,
        checkpoint: 'after-row-construction-and-mount',
        placements: before,
        outlineSummary: await page
          .locator(`[data-layout-id="${rowId}"] .card-layout-row-summary`)
          .textContent(),
        previewActions: await page
          .locator('#card-template-preview .preview-action')
          .allTextContents(),
      });

      if (path === '/connect-copy') {
        const row = page.locator(`[data-layout-id="${rowId}"]`);
        const other = page.locator('[data-layout-element="text"]').first();
        await other
          .locator('[data-select-layout]')
          .evaluate((element) => (element as { click(): void }).click());
        await row
          .locator('[data-select-layout]')
          .evaluate((element) => (element as { click(): void }).click());
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
        );
        browserEvidence.push({
          path,
          checkpoint: 'after-outline-selection-and-inspector-move',
          placements: await placements(page),
        });

        await page
          .locator('[data-properties-tab="buttons"]')
          .evaluate((element) => (element as { click(): void }).click());
        await page
          .locator(`[data-button-definition="${copyId}"] [data-button-move="up"]`)
          .evaluate((element) => (element as { click(): void }).click());
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
          'refreshButtonReferences',
        );
        browserEvidence.push({
          path,
          checkpoint: 'after-refreshButtonReferences',
          placements: await placements(page),
        });
        await page
          .locator('[data-properties-tab="elements"]')
          .evaluate((element) => (element as { click(): void }).click());
        await row
          .locator('[data-select-layout]')
          .evaluate((element) => (element as { click(): void }).click());

        const label = page.locator('#card-layout-properties-editor [data-layout-field="label"]');
        await label.fill('Server action placements');
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
        );
        const restored = JSON.parse(await layoutJson(page)) as {
          elements: Array<{ type: string; buttonIds?: string[] }>;
        };
        assert.deepEqual(
          restored.elements.find((element) => element.type === 'button_row')?.buttonIds,
          expectedIds,
        );
        browserEvidence.push({
          path,
          checkpoint: 'final-serialized-layout',
          placementUuids: restored.elements.find((element) => element.type === 'button_row')
            ?.buttonIds,
        });

        await page.reload();
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
          'full page reconstruction',
        );
        const warmedLayout = JSON.parse(await layoutJson(page)) as {
          elements: Array<{ type: string; buttonIds?: string[] }>;
        };
        assert.deepEqual(
          warmedLayout.elements.find((element) => element.type === 'button_row')?.buttonIds,
          expectedIds,
        );

        const rowAfterReload = page.locator(`[data-layout-id="${rowId}"]`);
        await rowAfterReload
          .locator('[data-layout-move="up"]')
          .evaluate((element) => (element as { click(): void }).click());
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
          'refreshRows',
        );
        assert.equal(
          (await outlineIds(page)).at(-2),
          rowId,
          'row can be reordered in the live browser',
        );
        browserEvidence.push({
          path,
          checkpoint: 'after-refreshRows',
          placements: await placements(page),
        });
        await page
          .locator('[data-card-undo]')
          .evaluate((element) => (element as { click(): void }).click());
        assert.equal(
          (await outlineIds(page)).at(-1),
          rowId,
          'Undo restores the saved outline order',
        );
        await page
          .locator('[data-card-redo]')
          .evaluate((element) => (element as { click(): void }).click());
        assert.equal((await outlineIds(page)).at(-2), rowId, 'Redo reapplies the outline order');
        await page
          .locator('[data-discard-server-changes]')
          .evaluate((element) => (element as { click(): void }).click());
        assert.equal(
          (await outlineIds(page)).at(-1),
          rowId,
          'Discard restores the saved outline order',
        );
        assert.deepEqual(
          (await placements(page)).map((placement) => placement.buttonUuid),
          expectedIds,
          'Undo/Redo/Discard',
        );
        browserEvidence.push({
          path,
          checkpoint: 'after-Undo-Redo-Discard',
          placements: await placements(page),
        });
      }

      if (path === '/copy-only' || path === '/reversed' || path === '/same-labels') {
        const row = page.locator(`[data-layout-id="${rowId}"]`);
        await row
          .locator('[data-layout-move="up"]')
          .evaluate((element) => (element as { click(): void }).click());
        const values = await placements(page);
        assert.deepEqual(
          values.map((placement) => placement.buttonUuid),
          expectedIds,
          `${path}: refreshRows`,
        );
        if (path === '/same-labels') assert.notEqual(values[0]?.buttonUuid, values[1]?.buttonUuid);
      }

      await page.close();
    }

    assert.ok(jsRequests.length >= 1, 'script loads on a cold page');
    assert.ok(jsRequests.every((url) => url.endsWith(`?v=${scriptVersion}`)));
    assert.ok(responseHashes.length >= 1);
    assert.ok(responseHashes.every((hash) => hash === scriptVersion));

    const warmPage = await context.newPage();
    await warmPage.goto(baseUrl + '/connect-copy');
    const firstResource = await warmPage.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname === '/admin/assets/panel.js')?.name,
    );
    assert.equal(firstResource, `${baseUrl}/admin/assets/panel.js?v=${scriptVersion}`);
    const scriptRequestsBeforeReload = assetHits.javascript;
    await warmPage.reload();
    assert.deepEqual(
      (await placements(warmPage)).map((placement) => placement.buttonUuid),
      [connectId, copyId],
    );
    assert.equal(
      assetHits.javascript,
      scriptRequestsBeforeReload,
      'warm cache reuses the same content-addressed script',
    );
    await warmPage.close();
    await context.close();
    process.stdout.write(
      JSON.stringify({
        browser: browser.version(),
        scriptVersion,
        scenarios: scenarios.map(([path]) => path),
        browserScriptRequests: jsRequests.length,
        assetServerHits: assetHits,
        scriptResponseHashes: [...new Set(responseHashes)],
        checkpoints: browserEvidence
          .filter((item) => item.path === '/connect-copy')
          .map((item) => ({
            checkpoint: item.checkpoint,
            placements: item.placements,
          })),
        result: 'passed',
      }) + '\n',
    );
  } finally {
    await browser?.close();
    server.close();
    await once(server, 'close').catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
