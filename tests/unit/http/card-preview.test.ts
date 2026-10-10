import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { appendInlineMarkdown } from '../../../src/http/admin/views/card-lines.js';
import { cardPreviewScript } from '../../../src/http/admin/views/card-preview.js';
import { panelCss } from '../../../src/http/admin/views/styles.js';

class PreviewElement {
  children: PreviewElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  tagName = '';

  get lastChild(): PreviewElement | null {
    return this.children.at(-1) ?? null;
  }

  append(...nodes: PreviewElement[]) {
    this.children.push(...nodes);
    this.textContent += nodes.map((node) => node.textContent).join('');
  }

  replaceChildren(...nodes: PreviewElement[]) {
    this.children = nodes;
    this.textContent = nodes.map((node) => node.textContent).join('');
  }

  addEventListener() {}

  insertBefore(node: PreviewElement, reference: PreviewElement | null) {
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  classList = { add: () => {} };
}

class MarkdownNode {
  tagName = '';
  children: MarkdownNode[] = [];
  className = '';
  alt = '';
  src = '';
  replacedWith: MarkdownNode | null = null;
  handlers = new Map<string, () => void>();
  private ownText = '';
  classList = { toggle: () => {} };

  append(...nodes: MarkdownNode[]) {
    this.children.push(...nodes);
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }

  replaceWith(node: MarkdownNode) {
    this.replacedWith = node;
  }

  addEventListener(type: string, handler: () => void) {
    this.handlers.set(type, handler);
  }
}

describe('Game Server card preview', () => {
  it('renders Discord inline formatting and safe custom emoji images with a text fallback', () => {
    const images: MarkdownNode[] = [];
    const doc = {
      createElement: (tagName: string) => {
        const node = new MarkdownNode();
        node.tagName = tagName;
        if (tagName === 'img') images.push(node);
        return node;
      },
      createTextNode: (text: string) => {
        const node = new MarkdownNode();
        node.textContent = text;
        return node;
      },
    } as unknown as Parameters<typeof appendInlineMarkdown>[2];
    const parent = new MarkdownNode();
    appendInlineMarkdown(
      parent as unknown as Parameters<typeof appendInlineMarkdown>[0],
      '***bold italic*** __under__ ~~strike~~ `connect host` <:status_dot:123456789012345678> <a:party:234567890123456789>',
      doc,
    );

    expect(parent.textContent).toContain('bold italic');
    expect(parent.textContent).toContain('connect host');
    expect(parent.children.some((child) => child.tagName === 'strong')).toBe(true);
    expect(images.map((image) => image.src)).toEqual([
      'https://cdn.discordapp.com/emojis/123456789012345678.webp?size=32&quality=lossless',
      'https://cdn.discordapp.com/emojis/234567890123456789.gif?size=32&quality=lossless',
    ]);
    images[1]?.handlers.get('error')?.();
    expect(images[1]?.replacedWith?.textContent).toBe(':party:');
  });

  it('uses scoped Discord typography and removes browser block margins', () => {
    expect(panelCss).toContain('font-size:16px');
    expect(panelCss).toContain('font-family:"gg sans","Noto Sans"');
    expect(panelCss).toContain('#card-preview-lines h1');
    expect(panelCss).toContain('#card-preview-lines code');
    expect(panelCss).toContain('#card-preview-lines>div{margin:0');
  });

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
          latestMessageAt: new Date(Date.now() - 120_000).toISOString(),
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
      headingStyle: 'heading',
      emptyBehavior: 'show_placeholders',
      announcements: {
        visible: true,
        displayLabel: '📢 **Announcements**',
        textStyle: 'heading',
        emptyPlaceholder: 'No announcements yet.',
        showTimestamp: true,
        showOpenButton: true,
        openButtonLabel: 'Open',
        latestMessageLength: 240,
      },
      changelog: {
        visible: true,
        displayLabel: '🛠 **Changelog**',
        textStyle: 'subtext',
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
    const layoutJson = { value: JSON.stringify([updates]) };
    const context = {
      HTMLElement: PreviewElement,
      document: {
        getElementById: (id: string) => nodes.get(id) ?? null,
        createElement: (tagName: string) => {
          const element = new PreviewElement();
          element.tagName = tagName;
          return element;
        },
      },
      previewRoot,
      layoutJson,
      inputValue: (_name: string, fallback = '') => fallback,
      formControl: () => null,
      previewIcon: () => '•',
      resolveLineTemplate: (text: string) => text,
      styleLineText: (text: string, style: string) =>
        style === 'normal' ? text : `[${style}]${text}`,
      appendInlineMarkdown: (element: PreviewElement, text: string) => {
        const inlineText = new PreviewElement();
        inlineText.textContent = text;
        element.append(inlineText);
      },
    };

    runInNewContext(`${cardPreviewScript}\nupdateCardPreview();`, context);

    expect(output.children.map((child) => child.dataset.discordComponent)).toEqual([
      'TextDisplay',
      'Section',
      'Section',
    ]);
    const [heading, announcements, changelog] = output.children;
    expect(heading?.textContent).toBe('[large]**Latest Updates**');
    expect(announcements?.children[0]?.textContent).toBe('[large]📢 **Announcements**');
    expect(announcements?.children[2]?.dataset.discordAccessory).toBe('Button');
    expect(announcements?.children[1]?.textContent).toBe('No announcements yet.');
    expect(changelog?.children[0]?.textContent).toBe('[subtext]🛠 **Changelog**');
    expect(changelog?.children[2]?.dataset.discordAccessory).toBe('Button');
    expect(changelog?.children[1]?.textContent).toContain('Detailed changelog');
    expect(changelog?.children[1]?.textContent).not.toContain('[subtext]');
    expect(changelog?.children[1]?.textContent).toContain('2 minutes ago');

    layoutJson.value = JSON.stringify([
      {
        id: 'formatted-lines',
        type: 'text',
        visible: true,
        template: '# Large\n## Medium\n### Small\n-# Muted\n\n**Bold** `connect host`',
        style: 'normal',
      },
    ]);
    runInNewContext('updateCardPreview();', context);
    expect(output.children[0]?.children.map((child) => child.tagName)).toEqual([
      'h1',
      'h2',
      'h3',
      'small',
      'br',
      'br',
      '',
    ]);
  });
});
