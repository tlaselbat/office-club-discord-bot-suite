import {
  Window,
  type HTMLButtonElement,
  type HTMLFormElement,
  type HTMLInputElement,
  type HTMLSelectElement,
} from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { cardLineScript } from '../../../src/http/admin/views/card-lines.js';
import { gameServerEditPage } from '../../../src/http/admin/views/pages/game-servers.js';
import {
  cardLayoutSchema,
  stableLayoutId,
} from '../../../src/modules/game-servers/card-profile.js';

const connectId = '5841ee99-0000-4000-8000-00005841ee99';
const copyAddressId = '61d01633-921f-4469-83ac-e8a7d78ca743';
const secondCopyAddressId = '7d01396f-7001-4303-8c6a-82d58f62a061';
const rowId = '57a1d2c3-01ab-4cde-8fab-1234567890ab';
const windows: Window[] = [];

// The generic type models the specific selector result without requiring DOM lib globals.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function query<T>(root: { querySelector(selector: string): unknown }, selector: string): T | null {
  return root.querySelector(selector) as T | null;
}

function queryAll<T>(
  root: { querySelectorAll(selector: string): Iterable<unknown> },
  selector: string,
): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}

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
  id: copyAddressId,
  label: 'Copy Address',
  emoji: null,
  style: 'secondary',
  action: 'copy-address',
  destination: null,
  visible: true,
};

function createEditPage(
  buttonIds: string[],
  buttons: Button[] = [connect, copyAddress],
  version = 3,
) {
  const elements =
    version === 3
      ? [
          {
            id: '36a03222-0588-4815-a822-44fb5ab92104',
            type: 'actions',
            label: 'Legacy actions',
            visible: true,
          },
          { id: rowId, type: 'button_row', label: 'Server actions', visible: true, buttonIds },
        ]
      : [{ id: rowId, type: 'actions', label: 'Server actions', visible: true }];
  const layout = { version, buttons: version === 3 ? buttons : [], elements };
  const parsed = cardLayoutSchema.safeParse(layout);
  if (!parsed.success) throw new Error(parsed.error.message);

  return gameServerEditPage({
    guildId: '12345678901234567',
    guildName: 'Office',
    username: 'owner',
    csrf: 'test-only',
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
      providerServerId: 'test-server',
      version: 1,
      cardProfile: {
        layout,
        buttons: { connect: true, mapRules: true },
      },
    },
    textChannels: [],
    cards: [],
  });
}

function hydrate(html: string) {
  const window = new Window({ url: 'https://example.test/admin/edit' });
  windows.push(window);
  Object.assign(window, { structuredClone });
  window.document.write(html);
  window.eval(cardLineScript);
  return window;
}

function buttonRowIds(window: Window): string[] {
  return queryAll<HTMLSelectElement>(window.document, '[data-row-button] select').map(
    (select) => select.value,
  );
}

function savedLayout(window: Window) {
  return JSON.parse(
    query<HTMLInputElement>(window.document, '#card-layout-json')?.value ?? 'null',
  ) as { buttons: Button[]; elements: Array<{ type: string; buttonIds?: string[] }> };
}

afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.abort();
});

describe('Card Studio reusable button hydration', () => {
  it.each([
    ['Connect and Copy Address', [connectId, copyAddressId], [connect, copyAddress]],
    ['Copy Address only', [copyAddressId], [connect, copyAddress]],
    ['reversed order', [copyAddressId, connectId], [connect, copyAddress]],
    [
      'duplicate display labels with distinct UUIDs',
      [copyAddressId, secondCopyAddressId],
      [
        { ...copyAddress, label: 'Utility' },
        { ...copyAddress, id: secondCopyAddressId, label: 'Utility' },
      ],
    ],
  ])(
    'preserves %s through initialization, serialization, save, and reload',
    (_name, placements, buttons) => {
      const firstLoad = hydrate(createEditPage(placements, buttons));
      const loadedLayout = savedLayout(firstLoad);
      const expectedActions = placements.map(
        (id) => buttons.find((button) => button.id === id)?.action,
      );

      expect(buttonRowIds(firstLoad)).toEqual(placements);
      expect(
        loadedLayout.elements.find((element) => element.type === 'button_row')?.buttonIds,
      ).toEqual(placements);
      expect(
        placements.map((id) => loadedLayout.buttons.find((button) => button.id === id)?.action),
      ).toEqual(expectedActions);
      const form = query<HTMLInputElement>(firstLoad.document, '#card-layout-json')?.form;
      expect(form?.dataset.dirty).toBe('false');
      expect(
        query<HTMLButtonElement>(form as HTMLFormElement, 'button[type="submit"]')?.disabled,
      ).toBe(true);

      const reloaded = hydrate(
        createEditPage(
          loadedLayout.elements.find((element) => element.type === 'button_row')?.buttonIds ?? [],
          loadedLayout.buttons,
        ),
      );
      expect(buttonRowIds(reloaded)).toEqual(placements);
      expect(
        placements.map(
          (id) => savedLayout(reloaded).buttons.find((button) => button.id === id)?.action,
        ),
      ).toEqual(expectedActions);
    },
  );

  it('keeps a missing UUID visible and reports it instead of selecting Connect', () => {
    const window = hydrate(createEditPage([connectId, copyAddressId]));
    const select = query<HTMLSelectElement>(
      window.document,
      '[data-row-button] select:last-of-type',
    );
    expect(select).not.toBeNull();
    const missingId = '0ddf0324-5353-4b8d-8b1b-10709394d4d1';
    const missing = window.document.createElement('option');
    missing.value = missingId;
    missing.selected = true;
    select?.append(missing);
    if (select) select.value = missingId;
    select?.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(select?.value).toBe(missingId);
    expect(select?.selectedOptions[0]?.textContent).toContain('Missing button reference');
    const copyDefinition = query<HTMLButtonElement>(
      window.document,
      `[data-button-definition="${copyAddressId}"] [data-button-move="up"]`,
    );
    copyDefinition?.click();
    expect(select?.value).toBe(missingId);
    expect(select?.selectedOptions[0]?.textContent).toContain('Missing button reference');
    expect(
      savedLayout(window).elements.find((element) => element.type === 'button_row')?.buttonIds,
    ).toContain(missingId);
  });

  it('supports add, remove, undo, redo, and discard without changing the saved references', async () => {
    const window = hydrate(createEditPage([connectId, copyAddressId]));
    const add = query<HTMLButtonElement>(window.document, '[data-row-button-add]');
    add?.click();
    await window.happyDOM.waitUntilComplete();
    const selectors = queryAll<HTMLSelectElement>(window.document, '[data-row-button] select');
    const addedPlacement = selectors[2];
    expect(addedPlacement).toBeDefined();
    if (!addedPlacement) throw new Error('Expected a newly added button placement.');
    addedPlacement.value = copyAddressId;
    addedPlacement.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(buttonRowIds(window)).toEqual([connectId, copyAddressId, copyAddressId]);

    const form = query<HTMLInputElement>(window.document, '#card-layout-json')?.form;
    expect(query<HTMLButtonElement>(form as HTMLFormElement, '[data-card-undo]')?.disabled).toBe(
      false,
    );
    query<HTMLButtonElement>(form as HTMLFormElement, '[data-card-undo]')?.click();
    expect(buttonRowIds(window)).toEqual([connectId, copyAddressId, connectId]);
    query<HTMLButtonElement>(form as HTMLFormElement, '[data-card-redo]')?.click();
    expect(buttonRowIds(window)).toEqual([connectId, copyAddressId, copyAddressId]);

    const remove = query<HTMLButtonElement>(
      window.document,
      '[data-row-button]:last-of-type [data-row-remove]',
    );
    remove?.click();
    expect(buttonRowIds(window)).toEqual([connectId, copyAddressId]);
    query<HTMLButtonElement>(window.document, '[data-discard-server-changes]')?.click();
    expect(buttonRowIds(window)).toEqual([connectId, copyAddressId]);
    expect(
      savedLayout(window).elements.find((element) => element.type === 'button_row')?.buttonIds,
    ).toEqual([connectId, copyAddressId]);
  });

  it.each([1, 2])('continues hydrating legacy version %i actions', (version) => {
    const window = hydrate(createEditPage([], [], version));
    const layout = savedLayout(window);
    const row = layout.elements.find((element) => element.type === 'button_row');
    expect(row?.buttonIds).toEqual([
      stableLayoutId('legacy-button:connect'),
      stableLayoutId('legacy-button:map-rules'),
    ]);
    expect(buttonRowIds(window)).toEqual(row?.buttonIds);
  });
});
