import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cardPreviewScript } from '../../../src/http/admin/views/card-preview.js';

class PreviewElement {
  children: PreviewElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';

  append(...nodes: PreviewElement[]) {
    this.children.push(...nodes);
    this.textContent = nodes.map((node) => node.textContent).join('');
  }

  replaceChildren(...nodes: PreviewElement[]) {
    this.children = nodes;
    this.textContent = nodes.map((node) => node.textContent).join('');
  }

  addEventListener() {}
}

describe('Game Server card preview', () => {
  it('keeps each Open accessory with its title and summary in one Section', () => {
    const output = new PreviewElement();
    const sourceStatus = new PreviewElement();
    const mode = { value: 'current' };
    const previewRoot = new PreviewElement();
    previewRoot.dataset = {
      guildId: '123456789012345678',
      updateThreads: JSON.stringify([
        {
          type: 'ANNOUNCEMENTS',
          threadId: '100000000000000010',
          latestMessageText: '',
          latestMessageAt: null,
          notificationExpiresAt: null,
        },
        {
          type: 'CHANGELOG',
          threadId: '100000000000000011',
          latestMessageText: 'Detailed changelog '.repeat(20),
          latestMessageAt: null,
          notificationExpiresAt: null,
        },
      ]),
    };
    const updates = {
      id: 'updates',
      type: 'updates',
      visible: true,
      showHeading: true,
      title: '**Latest Updates**',
      headingStyle: 'normal',
      emptyBehavior: 'show_placeholders',
      announcements: {
        visible: true,
        displayLabel: '📢 **Announcements**',
        textStyle: 'normal',
        emptyPlaceholder: 'No announcements yet.',
        showTimestamp: true,
        showOpenButton: true,
        openButtonLabel: 'Open',
        latestMessageLength: 240,
      },
      changelog: {
        visible: true,
        displayLabel: '🛠 **Changelog**',
        textStyle: 'normal',
        emptyPlaceholder: 'No changelog entries yet.',
        showTimestamp: true,
        showOpenButton: true,
        openButtonLabel: 'Open',
        latestMessageLength: 1000,
      },
    };
    const nodes = new Map<string, PreviewElement>([
      ['card-preview-lines', output],
      ['card-preview-source', sourceStatus],
      ['card-preview-mode', mode as unknown as PreviewElement],
      ['card-preview-artwork', new PreviewElement()],
      ['card-preview-actions', new PreviewElement()],
    ]);
    const context = {
      HTMLElement: PreviewElement,
      document: {
        getElementById: (id: string) => nodes.get(id) ?? null,
        createElement: () => new PreviewElement(),
      },
      previewRoot,
      layoutJson: { value: JSON.stringify([updates]) },
      inputValue: (_name: string, fallback = '') => fallback,
      formControl: () => null,
      previewIcon: () => '•',
      resolveLineTemplate: (text: string) => text,
      styleLineText: (text: string) => text,
      appendInlineMarkdown: (element: PreviewElement, text: string) => {
        element.textContent = text;
      },
    };

    runInNewContext(`${cardPreviewScript}\nupdateCardPreview();`, context);

    expect(output.children.map((child) => child.dataset.discordComponent)).toEqual([
      'TextDisplay',
      'Section',
      'Section',
    ]);
    const [heading, announcements, changelog] = output.children;
    expect(heading?.textContent).toBe('**Latest Updates**');
    expect(announcements?.children[0]?.textContent).toBe('📢 **Announcements**');
    expect(announcements?.children[2]?.dataset.discordAccessory).toBe('Button');
    expect(announcements?.children[1]?.textContent).toBe('No announcements yet.');
    expect(changelog?.children[0]?.textContent).toBe('🛠 **Changelog**');
    expect(changelog?.children[2]?.dataset.discordAccessory).toBe('Button');
    expect(changelog?.children[1]?.textContent).toContain('Detailed changelog');
  });
});
