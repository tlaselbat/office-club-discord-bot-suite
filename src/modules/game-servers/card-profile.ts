import { z } from 'zod';

export const DEFAULT_CARD_ACCENT_COLOR = '#2b8aef';
export const DEFAULT_CARD_DESCRIPTION =
  'Challenge other players 1v1, warm up, or kill time between matches. Open to all Office Club members.';
export const DEFAULT_THUMBNAIL_IMAGE_URL =
  'https://raw.githubusercontent.com/tlaselbat/office-club-discord-bot-suite/master/assets/server-info/clickcs-server-thumbnail.png';

export const CARD_TEMPLATE_FIELDS = [
  'title',
  'subtitle',
  'description',
  'playerCount',
  'currentMap',
  'serverAddress',
] as const;
export type CardTemplateField = (typeof CARD_TEMPLATE_FIELDS)[number];
export const CARD_BODY_FIELDS = ['description', 'currentMap', 'serverAddress'] as const;
export const DEFAULT_CARD_TEMPLATES: Record<CardTemplateField, string> = {
  title: '{servername}',
  subtitle: '{statusicon} {status}{location}',
  description: DEFAULT_CARD_DESCRIPTION,
  playerCount: '{playercount} players',
  currentMap: 'Current map: {currentmap}',
  serverAddress: '{serveraddress}',
};
export const DEFAULT_STATUS_LABELS = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Server starting…',
  stale: 'Status stale',
  pending: 'Status pending',
  unavailable: 'Server unavailable',
};
export const CARD_PLACEHOLDERS = [
  ['playercount', 'Connected and maximum players, such as 0/5'],
  ['players', 'Connected player count'],
  ['maxplayers', 'Maximum player count'],
  ['online', 'Configured status icon and label'],
  ['status', 'Current human-readable server state'],
  ['statusicon', 'Configured icon for the current server state'],
  ['location', 'Configured DatHost data center'],
  ['serveraddress', 'Configured host and port'],
  ['serverip', 'Configured hostname or IP'],
  ['serverport', 'Configured connection port'],
  ['currentmap', 'Current map from the cached server snapshot'],
  ['servername', 'Configured display name'],
  ['lastupdated', 'Time since the latest successful snapshot'],
  ['announcements.preview', 'Latest sanitized announcements excerpt'],
  ['announcements.time', 'Discord relative timestamp of the latest announcement'],
  ['announcements.new', 'NEW indicator while the announcement is fresh'],
  ['announcements.url', 'Canonical announcements thread URL'],
  ['changelog.preview', 'Latest sanitized changelog excerpt'],
  ['changelog.time', 'Discord relative timestamp of the latest changelog entry'],
  ['changelog.new', 'NEW indicator while the changelog entry is fresh'],
  ['changelog.url', 'Canonical changelog thread URL'],
] as const;

const templateFieldSchema = z.object({
  title: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.title),
  subtitle: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.subtitle),
  description: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.description),
  playerCount: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.playerCount),
  currentMap: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.currentMap),
  serverAddress: validatedTemplate().default(DEFAULT_CARD_TEMPLATES.serverAddress),
});
const placeholderNames = new Set<string>(CARD_PLACEHOLDERS.map(([name]) => name));
export function validateCardTemplate(template: string): string[] {
  const errors: string[] = [];
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const name = (match[1] ?? '').toLowerCase();
    if (!placeholderNames.has(name) && name !== 'severaddress') {
      errors.push(`Unknown placeholder {${match[1] ?? ''}}.`);
    }
  }
  return [...new Set(errors)];
}
function validatedTemplate() {
  return z
    .string()
    .max(500)
    .superRefine((template, context) => {
      for (const message of validateCardTemplate(template))
        context.addIssue({ code: 'custom', message });
    });
}

export const CARD_LINE_IDS = [
  'title',
  'subtitle',
  'playerCount',
  'description',
  'currentMap',
  'serverAddress',
] as const;
export const CARD_LINE_STYLES = ['large', 'medium', 'small', 'normal', 'subtext'] as const;
export type CardLineStyle = (typeof CARD_LINE_STYLES)[number];
export const DEFAULT_CARD_LINE_STYLES: Record<(typeof CARD_LINE_IDS)[number], CardLineStyle> = {
  title: 'normal',
  subtitle: 'normal',
  playerCount: 'normal',
  description: 'normal',
  currentMap: 'normal',
  serverAddress: 'normal',
};
const cardLineSchema = z.object({
  id: z.enum(CARD_LINE_IDS),
  template: validatedTemplate(),
  visible: z.boolean(),
  style: z.enum(CARD_LINE_STYLES),
});
export type CardLine = z.infer<typeof cardLineSchema>;
const textLinesSchema = z
  .array(cardLineSchema)
  .length(6)
  .refine(
    (lines) => new Set(lines.map((line) => line.id)).size === 6,
    'Each line ID must occur exactly once',
  );

const visibleFieldSchema = z.object({
  title: z.boolean().default(true),
  subtitle: z.boolean().default(true),
  description: z.boolean().default(true),
  playerCount: z.boolean().default(true),
  currentMap: z.boolean().default(true),
  serverAddress: z.boolean().default(true),
  updates: z.boolean().default(true),
});
const statusLabelsSchema = z.object({
  online: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.online),
  offline: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.offline),
  starting: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.starting),
  stale: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.stale),
  pending: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.pending),
  unavailable: z.string().trim().min(1).max(80).default(DEFAULT_STATUS_LABELS.unavailable),
});
const buttonSchema = z.object({
  connect: z.boolean().default(true),
  mapRules: z.boolean().default(true),
  connectLabel: z.string().trim().min(1).max(80).default('Connect'),
  mapRulesLabel: z.string().trim().min(1).max(80).default('Map & Rules'),
});

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', 'Must use HTTPS');
const emojiId = z.string().regex(/^\d{17,20}$/, 'Must be a Discord emoji ID');

export const CARD_LAYOUT_VERSION = 3;
export const CARD_BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger', 'link'] as const;
export type CardButtonStyle = (typeof CARD_BUTTON_STYLES)[number];
const cardButtonSchema = z
  .object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(80),
    emoji: z.string().max(100).nullable().default(null),
    style: z.enum(CARD_BUTTON_STYLES).default('secondary'),
    action: z.enum([
      'connect',
      'map-rules',
      'copy-address',
      'announcements-thread',
      'changelog-thread',
      'external-https-url',
    ]),
    destination: z.string().max(2048).nullable().default(null),
    visible: z.boolean().default(true),
  })
  .superRefine((button, context) => {
    const linked =
      button.action === 'announcements-thread' ||
      button.action === 'changelog-thread' ||
      button.action === 'external-https-url';
    if (linked !== (button.style === 'link'))
      context.addIssue({
        code: 'custom',
        path: ['style'],
        message: 'Link actions require Link style, and interactive actions require a button style.',
      });
    if (button.action === 'external-https-url') {
      if (!button.destination || !httpsUrl.safeParse(button.destination).success)
        context.addIssue({
          code: 'custom',
          path: ['destination'],
          message: 'Enter a valid HTTPS destination.',
        });
    } else if (button.destination !== null)
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'This action does not use a destination.',
      });
    if (
      button.emoji !== null &&
      button.emoji.length > 0 &&
      !/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(button.emoji) &&
      !/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3)+$/u.test(
        button.emoji,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['emoji'],
        message: 'Enter one Unicode emoji or a valid custom Discord emoji.',
      });
  });
export type CardButton = z.infer<typeof cardButtonSchema>;
const updatesFeedSchema = z.object({
  visible: z.boolean().default(true),
  displayLabel: z.string().trim().min(1).max(80),
  textStyle: z.enum(['normal', 'heading', 'subtext']),
  emptyPlaceholder: z.string().max(240),
  showTimestamp: z.boolean(),
  timestampMode: z.enum(['plain', 'discord_native']).default('plain'),
  showNew: z.boolean().default(true),
  showOpenButton: z.boolean(),
  openButtonLabel: z.string().trim().min(1).max(80),
  latestMessageLength: z.number().int().min(40).max(1000),
});
/** Optional nested layout. Older profiles retain their exact feed-order rendering until edited. */
const updateBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.uuid(), type: z.literal('heading'), visible: z.boolean() }),
  z.object({
    id: z.uuid(),
    type: z.literal('feed'),
    visible: z.boolean(),
    feed: z.enum(['ANNOUNCEMENTS', 'CHANGELOG']),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('text'),
    visible: z.boolean(),
    template: validatedTemplate(),
    style: z.enum(CARD_LINE_STYLES),
    timestampMode: z.enum(['plain', 'discord_native']).default('plain'),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('separator'),
    visible: z.boolean(),
    divider: z.boolean(),
    spacing: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('gallery'),
    visible: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.uuid(),
          source: z.enum(['map', 'custom', 'fallback']),
          url: httpsUrl.nullable().default(null),
          description: z.string().max(1024),
        }),
      )
      .min(1)
      .max(10),
  }),
]);
export type UpdateLayoutBlock = z.infer<typeof updateBlockSchema>;
const updatesElementSchema = z
  .object({
    id: z.uuid(),
    type: z.literal('updates'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    showHeading: z.boolean().default(false),
    title: z.string().trim().max(80),
    headingStyle: z.enum(['normal', 'heading', 'subtext']),
    blocks: z.array(updateBlockSchema).max(25).optional(),
    feedOrder: z
      .array(z.enum(['ANNOUNCEMENTS', 'CHANGELOG']))
      .length(2)
      .refine((order) => new Set(order).size === 2)
      .default(['ANNOUNCEMENTS', 'CHANGELOG']),
    separator: z
      .object({
        enabled: z.boolean().default(false),
        divider: z.boolean().default(true),
        spacing: z.union([z.literal(1), z.literal(2)]).default(1),
      })
      .default({ enabled: false, divider: true, spacing: 1 }),
    emptyBehavior: z.enum(['show_placeholders', 'hide_empty_entries']),
    announcements: updatesFeedSchema,
    changelog: updatesFeedSchema,
  })
  .superRefine((updates, context) => {
    if (updates.showHeading && !updates.title)
      context.addIssue({ code: 'custom', path: ['title'], message: 'Enter a heading or hide it.' });
    if (updates.blocks !== undefined) {
      const ids = updates.blocks.map((block) => block.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: 'custom',
          path: ['blocks'],
          message: 'Update block IDs must be unique.',
        });
      for (const type of ['heading', 'ANNOUNCEMENTS', 'CHANGELOG'] as const) {
        const matches = updates.blocks.filter((block) =>
          type === 'heading'
            ? block.type === 'heading'
            : block.type === 'feed' && block.feed === type,
        );
        if (matches.length > 1)
          context.addIssue({
            code: 'custom',
            path: ['blocks'],
            message: 'Heading and feed blocks can appear only once.',
          });
      }
    }
  });
const cardLayoutElementSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.uuid(),
    type: z.literal('text'),
    label: z.string().trim().min(1).max(80),
    template: validatedTemplate(),
    visible: z.boolean(),
    style: z.enum(CARD_LINE_STYLES),
    timestampMode: z.enum(['plain', 'discord_native']).default('plain'),
    accessory: z
      .object({
        type: z.literal('thread_link'),
        destination: z.enum(['ANNOUNCEMENTS', 'CHANGELOG']),
        enabled: z.boolean(),
        label: z.string().trim().min(1).max(80),
        visibility: z.enum(['thread_exists', 'message_exists', 'never']),
      })
      .optional(),
    accessoryButtonId: z.uuid().optional(),
    conditionalVisibility: z
      .object({
        mode: z.enum(['always', 'thread_exists', 'message_exists', 'any_update_visible']),
        source: z.enum(['ANNOUNCEMENTS', 'CHANGELOG']).default('ANNOUNCEMENTS'),
      })
      .optional(),
    emptyBehavior: z.enum(['fallback', 'hide']).optional(),
    emptyText: z.string().max(240).optional(),
    previewLength: z.number().int().min(40).max(1000).optional(),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('gallery'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    items: z
      .array(
        z.object({
          id: z.uuid(),
          source: z.enum(['map', 'custom', 'fallback']),
          url: httpsUrl.nullable().default(null),
          description: z.string().max(1024),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('separator'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    divider: z.boolean(),
    spacing: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('section'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    template: validatedTemplate(),
    style: z.enum(CARD_LINE_STYLES),
    timestampMode: z.enum(['plain', 'discord_native']).default('plain'),
    thumbnailUrl: httpsUrl.nullable().default(null),
    accessoryButtonId: z.uuid().optional(),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('actions'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal('button_row'),
    label: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    buttonIds: z.array(z.uuid()).min(1).max(5),
  }),
  updatesElementSchema,
]);
export type CardLayoutElement = z.infer<typeof cardLayoutElementSchema>;
export const cardLayoutSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(CARD_LAYOUT_VERSION)]),
    buttons: z.array(cardButtonSchema).max(100).default([]),
    elements: z.array(cardLayoutElementSchema).min(1).max(35),
  })
  .superRefine((layout, context) => {
    const ids = layout.elements.map((element) => element.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Layout element IDs must be unique.' });
    if (layout.elements.filter((element) => element.type === 'actions').length > 1)
      context.addIssue({ code: 'custom', message: 'Only one action row is supported.' });
    if (layout.elements.filter((element) => element.type === 'updates').length > 1)
      context.addIssue({
        code: 'custom',
        message: 'Only one Community Updates element is supported.',
      });
    const buttonIds = layout.buttons.map((button) => button.id);
    if (new Set(buttonIds).size !== buttonIds.length)
      context.addIssue({
        code: 'custom',
        path: ['buttons'],
        message: 'Button IDs must be unique.',
      });
    const definitions = new Set(buttonIds);
    const placements = new Set<string>();
    for (const element of layout.elements) {
      const refs =
        element.type === 'button_row'
          ? element.buttonIds
          : (element.type === 'text' || element.type === 'section') && element.accessoryButtonId
            ? [element.accessoryButtonId]
            : [];
      for (const id of refs) {
        if (!definitions.has(id))
          context.addIssue({
            code: 'custom',
            path: ['elements'],
            message: 'Button placement refers to a missing button.',
          });
        if (placements.has(id))
          context.addIssue({
            code: 'custom',
            path: ['elements'],
            message: 'A button can only be placed once.',
          });
        placements.add(id);
      }
    }
    for (const button of layout.buttons) {
      if (
        button.style !== 'link' &&
        button.emoji?.startsWith('<') &&
        !/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(button.emoji)
      )
        context.addIssue({
          code: 'custom',
          path: ['buttons'],
          message: 'Custom emoji must use a valid Discord emoji format.',
        });
    }
    const componentCount =
      1 +
      layout.elements.reduce((total, element) => {
        if (!element.visible) return total;
        if (element.type === 'actions') return total + 3;
        if (element.type === 'button_row')
          return (
            total +
            1 +
            element.buttonIds.filter(
              (id) => layout.buttons.find((button) => button.id === id)?.visible !== false,
            ).length
          );
        if (element.type === 'text')
          return total + (element.accessoryButtonId || element.accessory?.enabled ? 3 : 1);
        if (element.type === 'section') return total + 3;
        if (element.type !== 'updates') return total + 1;
        if (element.blocks !== undefined) {
          return (
            total +
            element.blocks.reduce((sum, block) => {
              if (!block.visible) return sum;
              if (block.type === 'heading') return sum + (element.showHeading ? 1 : 0);
              if (block.type === 'feed') {
                const feed =
                  block.feed === 'ANNOUNCEMENTS' ? element.announcements : element.changelog;
                return sum + (feed.visible ? (feed.showOpenButton ? 4 : 2) : 0);
              }
              return sum + 1;
            }, 0)
          );
        }
        const visibleFeeds = [element.announcements, element.changelog].filter(
          (feed) => feed.visible,
        );
        if (!visibleFeeds.length) return total;
        return (
          total +
          (element.showHeading ? 1 : 0) +
          visibleFeeds.reduce((feeds, feed) => feeds + (feed.showOpenButton ? 4 : 2), 0) +
          (visibleFeeds.length > 1 && element.separator.enabled ? 1 : 0)
        );
      }, 0);
    if (componentCount > 40)
      context.addIssue({
        code: 'custom',
        path: ['elements'],
        message: 'Visible card layout exceeds Discord’s 40 component message limit.',
      });
  });

export function defaultUpdatesElement(id: string): CardLayoutElement {
  return {
    id,
    type: 'updates',
    label: 'Community Updates',
    visible: true,
    title: 'Latest Updates',
    showHeading: false,
    headingStyle: 'normal',
    feedOrder: ['ANNOUNCEMENTS', 'CHANGELOG'],
    separator: { enabled: false, divider: true, spacing: 1 },
    emptyBehavior: 'show_placeholders',
    announcements: {
      visible: true,
      displayLabel: 'Announcements',
      textStyle: 'normal',
      emptyPlaceholder: 'No announcements yet.',
      showTimestamp: true,
      timestampMode: 'plain',
      showNew: false,
      showOpenButton: true,
      openButtonLabel: 'Open',
      latestMessageLength: 240,
    },
    changelog: {
      visible: true,
      displayLabel: 'Changelog',
      textStyle: 'normal',
      emptyPlaceholder: 'No changelog entries yet.',
      showTimestamp: true,
      timestampMode: 'plain',
      showNew: false,
      showOpenButton: true,
      openButtonLabel: 'Open',
      latestMessageLength: 240,
    },
  };
}

/** Converts the former single-purpose Updates element to ordinary reusable card rows. */
export function migrateLegacyUpdateElements(elements: unknown[]): unknown[] {
  const migrated: unknown[] = [];
  const asObject = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const feedRow = (
    id: string,
    feed: 'ANNOUNCEMENTS' | 'CHANGELOG',
    config: Record<string, unknown>,
    visible: boolean,
    emptyBehavior: unknown,
  ) => {
    const token = feed === 'ANNOUNCEMENTS' ? 'announcements' : 'changelog';
    const label = typeof config.displayLabel === 'string' ? config.displayLabel : '';
    const timestamp = config.showTimestamp === true ? `\n{${token}.time}` : '';
    const defaultLabel = feed === 'ANNOUNCEMENTS' ? '📢 **Announcements**' : '🛠 **Changelog**';
    const generatedLabel = feed === 'ANNOUNCEMENTS' ? 'Announcements' : 'Changelog';
    const visibleLabel = label === defaultLabel ? generatedLabel : label;
    const newToken = config.showNew !== false ? `{${token}.new}` : '';
    const style = config.textStyle === 'heading' ? 'large' : config.textStyle;
    const accessory =
      config.showOpenButton === true
        ? {
            type: 'thread_link',
            destination: feed,
            enabled: true,
            label: typeof config.openButtonLabel === 'string' ? config.openButtonLabel : 'Open',
            visibility: 'thread_exists',
          }
        : undefined;
    return {
      id,
      type: 'text',
      label:
        visibleLabel.replace(/[*_~`]/g, '').trim() ||
        (feed === 'ANNOUNCEMENTS' ? 'Announcements' : 'Changelog'),
      template: `${visibleLabel}${visibleLabel ? ' ' : ''}{${token}.preview}${newToken}${timestamp}`,
      visible,
      style: CARD_LINE_STYLES.includes(style as (typeof CARD_LINE_STYLES)[number])
        ? style
        : 'normal',
      ...(accessory ? { accessory } : {}),
      timestampMode: config.timestampMode === 'discord_native' ? 'discord_native' : 'plain',
      conditionalVisibility: { mode: 'always', source: feed },
      emptyBehavior: emptyBehavior === 'hide_empty_entries' ? 'hide' : 'fallback',
      emptyText:
        typeof config.emptyPlaceholder === 'string' ? config.emptyPlaceholder : 'No updates yet.',
      previewLength:
        Number.isInteger(config.latestMessageLength) &&
        Number(config.latestMessageLength) >= 40 &&
        Number(config.latestMessageLength) <= 1000
          ? config.latestMessageLength
          : 140,
    };
  };

  for (const value of elements) {
    const element = asObject(value);
    if (element?.type !== 'updates') {
      migrated.push(value);
      continue;
    }
    const id = typeof element.id === 'string' ? element.id : stableLayoutId('community-updates');
    const active = element.visible !== false;
    const emptyBehavior = element.emptyBehavior;
    const announcements = asObject(element.announcements) ?? {};
    const changelog = asObject(element.changelog) ?? {};
    const blocks = Array.isArray(element.blocks) ? element.blocks : null;
    const converted: unknown[] = [];
    if (blocks) {
      for (const blockValue of blocks) {
        const block = asObject(blockValue);
        if (!block) continue;
        if (block.type === 'heading') {
          if (element.showHeading !== false)
            converted.push({
              id: block.id,
              type: 'text',
              label: 'Latest Updates',
              template:
                element.title === '**Latest Updates**'
                  ? 'Latest Updates'
                  : typeof element.title === 'string'
                    ? element.title
                    : 'Latest Updates',
              visible: active && block.visible !== false,
              style:
                element.headingStyle === 'heading' ? 'large' : (element.headingStyle ?? 'normal'),
              timestampMode: 'plain',
            });
        } else if (block.type === 'feed') {
          const feed = block.feed === 'CHANGELOG' ? 'CHANGELOG' : 'ANNOUNCEMENTS';
          converted.push(
            feedRow(
              typeof block.id === 'string' ? block.id : stableLayoutId(`${id}:${feed}`),
              feed,
              feed === 'ANNOUNCEMENTS' ? announcements : changelog,
              active &&
                block.visible !== false &&
                (feed === 'ANNOUNCEMENTS'
                  ? announcements.visible !== false
                  : changelog.visible !== false),
              emptyBehavior,
            ),
          );
        } else if (block.type === 'text') {
          converted.push({
            ...block,
            label: 'Updates text',
            visible: active && block.visible !== false,
          });
        } else if (block.type === 'separator' || block.type === 'gallery') {
          converted.push({
            ...block,
            label: block.type === 'separator' ? 'Separator' : 'Gallery',
            visible: active && block.visible !== false,
          });
        }
      }
    } else {
      if (element.showHeading !== false)
        converted.push({
          id: stableLayoutId(`${id}:heading`),
          type: 'text',
          label: 'Latest Updates',
          template:
            element.title === '**Latest Updates**'
              ? 'Latest Updates'
              : typeof element.title === 'string'
                ? element.title
                : 'Latest Updates',
          visible: active,
          style: element.headingStyle === 'heading' ? 'large' : (element.headingStyle ?? 'normal'),
          timestampMode: 'plain',
        });
      const order: Array<'ANNOUNCEMENTS' | 'CHANGELOG'> = Array.isArray(element.feedOrder)
        ? element.feedOrder.filter(
            (feed: unknown): feed is 'ANNOUNCEMENTS' | 'CHANGELOG' =>
              feed === 'ANNOUNCEMENTS' || feed === 'CHANGELOG',
          )
        : ['ANNOUNCEMENTS', 'CHANGELOG'];
      for (const feed of order) {
        if (
          feed === order[1] &&
          order[0] !== order[1] &&
          asObject(element.separator)?.enabled === true
        ) {
          const separator = asObject(element.separator) ?? {};
          converted.push({
            id: stableLayoutId(`${id}:feed-separator`),
            type: 'separator',
            label: 'Updates separator',
            visible: active,
            divider: separator.divider !== false,
            spacing: separator.spacing === 2 ? 2 : 1,
          });
        }
        const settings = feed === 'ANNOUNCEMENTS' ? announcements : changelog;
        converted.push(
          feedRow(
            stableLayoutId(`${id}:${feed}`),
            feed,
            settings,
            active && settings.visible !== false,
            emptyBehavior,
          ),
        );
      }
    }
    if (migrated.length + converted.length > 35) {
      // Keep the complete legacy shape readable if an unusually customized layout cannot fit.
      migrated.push(value);
    } else migrated.push(...converted);
  }
  return migrated;
}

/** Persisted card presentation overrides. Null image and emoji values inherit their legacy defaults. */
export const cardProfileSchema = z.object({
  layout: cardLayoutSchema.optional(),
  textLines: textLinesSchema.optional(),
  mapArtwork: z.boolean().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default(DEFAULT_CARD_ACCENT_COLOR),
  thumbnailImageUrl: httpsUrl.nullable().default(null),
  onlineEmojiId: emojiId.nullable().default(null),
  offlineEmojiId: emojiId.nullable().default(null),
  warningEmojiId: emojiId.nullable().default(null),
  pendingEmojiId: emojiId.nullable().default(null),
  templates: templateFieldSchema.default(DEFAULT_CARD_TEMPLATES),
  visibleFields: visibleFieldSchema.default({
    title: true,
    subtitle: true,
    description: true,
    playerCount: true,
    currentMap: true,
    serverAddress: true,
    updates: true,
  }),
  statusLabels: statusLabelsSchema.default(DEFAULT_STATUS_LABELS),
  fieldOrder: z
    .array(z.enum(CARD_BODY_FIELDS))
    .length(CARD_BODY_FIELDS.length)
    .refine((fields) => new Set(fields).size === CARD_BODY_FIELDS.length)
    .default([...CARD_BODY_FIELDS]),
  buttons: buttonSchema.default({
    connect: true,
    mapRules: true,
    connectLabel: 'Connect',
    mapRulesLabel: 'Map & Rules',
  }),
});

export type CardProfile = z.infer<typeof cardProfileSchema>;
export type CardProfileInput = z.input<typeof cardProfileSchema>;

export interface ResolvedCardProfile extends CardProfile {
  thumbnailImageUrl: string;
  onlineEmojiId: string | null;
  offlineEmojiId: string | null;
  warningEmojiId: string | null;
  pendingEmojiId: string | null;
}

/** Safely reads JSON persisted by older versions or hand-edited database rows. */
export function normalizeCardProfile(value: unknown): CardProfile {
  const source =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const field = <T>(schema: z.ZodType<T>, input: unknown): T => {
    const parsed = schema.safeParse(input);
    return parsed.success ? parsed.data : schema.parse(undefined);
  };
  const normalized: CardProfile = {
    accentColor: field(cardProfileSchema.shape.accentColor, source.accentColor),
    thumbnailImageUrl: field(cardProfileSchema.shape.thumbnailImageUrl, source.thumbnailImageUrl),
    onlineEmojiId: field(cardProfileSchema.shape.onlineEmojiId, source.onlineEmojiId),
    offlineEmojiId: field(cardProfileSchema.shape.offlineEmojiId, source.offlineEmojiId),
    warningEmojiId: field(cardProfileSchema.shape.warningEmojiId, source.warningEmojiId),
    pendingEmojiId: field(cardProfileSchema.shape.pendingEmojiId, source.pendingEmojiId),
    templates: Object.fromEntries(
      CARD_TEMPLATE_FIELDS.map((key) => [
        key,
        field(
          templateFieldSchema.shape[key],
          sanitizePersistedTemplate((source.templates as Record<string, unknown> | null)?.[key]),
        ),
      ]),
    ) as CardProfile['templates'],
    ...normalizeTextLines(source.textLines),
    ...(typeof source.mapArtwork === 'boolean' ? { mapArtwork: source.mapArtwork } : {}),
    visibleFields: field(cardProfileSchema.shape.visibleFields, source.visibleFields),
    statusLabels: field(cardProfileSchema.shape.statusLabels, source.statusLabels),
    fieldOrder: field(cardProfileSchema.shape.fieldOrder, source.fieldOrder),
    buttons: field(cardProfileSchema.shape.buttons, source.buttons),
    ...(source.layout === undefined
      ? {}
      : (() => {
          const raw = source.layout as { version?: unknown; elements?: unknown; buttons?: unknown };
          const migrated =
            (raw.version === 1 || raw.version === 2 || raw.version === CARD_LAYOUT_VERSION) &&
            Array.isArray(raw.elements)
              ? (() => {
                  let elements = raw.elements.map((value: unknown) => {
                    if (value === null || typeof value !== 'object' || Array.isArray(value))
                      return value;
                    const element = value as Record<string, unknown>;
                    if (element.type !== 'updates') return element;
                    const defaults = defaultUpdatesElement(stableLayoutId('community-updates'));
                    if (defaults.type !== 'updates') return element;
                    return {
                      ...defaults,
                      ...element,
                      showHeading:
                        typeof element.showHeading === 'boolean' ? element.showHeading : false,
                      feedOrder: Array.isArray(element.feedOrder)
                        ? element.feedOrder
                        : defaults.feedOrder,
                      separator:
                        typeof element.separator === 'object' && element.separator !== null
                          ? { ...defaults.separator, ...element.separator }
                          : defaults.separator,
                      announcements: {
                        ...defaults.announcements,
                        ...(typeof element.announcements === 'object' &&
                        element.announcements !== null
                          ? element.announcements
                          : {}),
                        showNew:
                          typeof (element.announcements as Record<string, unknown> | undefined)
                            ?.showNew === 'boolean'
                            ? (element.announcements as Record<string, unknown>).showNew
                            : true,
                      },
                      changelog: {
                        ...defaults.changelog,
                        ...(typeof element.changelog === 'object' && element.changelog !== null
                          ? element.changelog
                          : {}),
                        showNew:
                          typeof (element.changelog as Record<string, unknown> | undefined)
                            ?.showNew === 'boolean'
                            ? (element.changelog as Record<string, unknown>).showNew
                            : true,
                      },
                    };
                  });
                  if (
                    raw.version === 1 &&
                    !elements.some(
                      (element) =>
                        element !== null &&
                        typeof element === 'object' &&
                        !Array.isArray(element) &&
                        (element as Record<string, unknown>).type === 'updates',
                    )
                  ) {
                    const updates = {
                      ...defaultUpdatesElement(stableLayoutId('community-updates')),
                      visible:
                        (source.visibleFields as Record<string, unknown> | undefined)?.updates !==
                        false,
                    };
                    const oldSeparator = elements.findIndex(
                      (element) =>
                        element !== null &&
                        typeof element === 'object' &&
                        !Array.isArray(element) &&
                        (element as Record<string, unknown>).type === 'separator' &&
                        (element as Record<string, unknown>).label === 'Updates separator',
                    );
                    if (oldSeparator >= 0 && elements.length < 35)
                      elements.splice(oldSeparator + 1, 0, updates);
                    else if (oldSeparator >= 0) elements.splice(oldSeparator, 1, updates);
                    else if (elements.length < 35) elements.push(updates);
                  }
                  if (raw.version < CARD_LAYOUT_VERSION) {
                    elements = migrateLegacyUpdateElements(elements);
                  }
                  const oldButtons = source.buttons as Record<string, unknown> | undefined;
                  const definitions = Array.isArray(raw.buttons)
                    ? raw.buttons
                    : [
                        ...(oldButtons?.connect !== false
                          ? [
                              {
                                id: stableLayoutId('legacy-button:connect'),
                                label:
                                  typeof oldButtons?.connectLabel === 'string'
                                    ? oldButtons.connectLabel
                                    : 'Connect',
                                emoji: '▶',
                                style: 'primary',
                                action: 'connect',
                                destination: null,
                                visible: true,
                              },
                            ]
                          : []),
                        ...(oldButtons?.mapRules !== false
                          ? [
                              {
                                id: stableLayoutId('legacy-button:map-rules'),
                                label:
                                  typeof oldButtons?.mapRulesLabel === 'string'
                                    ? oldButtons.mapRulesLabel
                                    : 'Map & Rules',
                                emoji: '🗺',
                                style: 'secondary',
                                action: 'map-rules',
                                destination: null,
                                visible: true,
                              },
                            ]
                          : []),
                      ];
                  const buttonsByAction = new Map(
                    (definitions as Record<string, unknown>[]).map((button) => [
                      button.action,
                      button.id,
                    ]),
                  );
                  const withButtonRows = elements.map((value) => {
                    if (value === null || typeof value !== 'object' || Array.isArray(value))
                      return value;
                    const element = value as Record<string, unknown>;
                    if (element.type !== 'actions') return element;
                    const buttonIds = ['connect', 'map-rules']
                      .map((action) => buttonsByAction.get(action))
                      .filter((id): id is string => typeof id === 'string');
                    return buttonIds.length
                      ? {
                          id: element.id,
                          type: 'button_row',
                          label: element.label ?? 'Server actions',
                          visible: element.visible !== false,
                          buttonIds,
                        }
                      : { ...element, visible: false };
                  });
                  return {
                    version: CARD_LAYOUT_VERSION,
                    buttons: definitions,
                    elements: withButtonRows,
                  };
                })()
              : source.layout;
          const parsed = cardLayoutSchema.safeParse(migrated);
          return parsed.success ? { layout: parsed.data } : {};
        })()),
  };
  return normalized;
}

/** Stable legacy projection; generated IDs remain deterministic and do not create DB writes. */
export function resolveCardLayout(
  value: unknown,
  legacyDescription?: string | null,
): CardLayoutElement[] {
  const profile = normalizeCardProfile(value);
  if (profile.layout !== undefined) return profile.layout.elements;
  const lines = resolveCardLines(value, legacyDescription);
  const stableId = (key: string) => {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, '0').slice(-12)}`;
  };
  const element = (key: string, data: CardLayoutElement): CardLayoutElement => ({
    ...data,
    id: stableId(key),
  });
  const header = lines.slice(0, 3);
  const headerText =
    header
      .map((line) => {
        if (!line.visible || !line.template.trim()) return '';
        const prefix = { large: '# ', medium: '## ', small: '### ', normal: '', subtext: '-# ' }[
          line.style
        ];
        return prefix + line.template.replace(/^(?:#{1,3}|-#)\s+/, '');
      })
      .filter(Boolean)
      .join('\n') || '\u200b';
  const layout: CardLayoutElement[] = [
    element('header', {
      id: '',
      type: 'section',
      label: 'Header and thumbnail',
      visible: true,
      template: headerText,
      style: 'normal',
      timestampMode: 'plain',
      thumbnailUrl: profile.thumbnailImageUrl,
    }),
  ];
  for (let index = 3; index < 6; index++) {
    const line = lines[index];
    if (index === 4 && (profile.mapArtwork ?? profile.visibleFields.currentMap))
      layout.push(
        element('map-separator', {
          id: '',
          type: 'separator',
          label: 'Map separator',
          visible: true,
          divider: true,
          spacing: 1,
        }),
      );
    if (line?.visible)
      layout.push(
        element(`text-${line.id}`, {
          id: '',
          type: 'text',
          label: `Card ${line.id}`,
          visible: true,
          template: line.template,
          style: line.style,
          timestampMode: 'plain',
        }),
      );
    if (index === 4 && (profile.mapArtwork ?? profile.visibleFields.currentMap))
      layout.push(
        element('map-gallery', {
          id: '',
          type: 'gallery',
          label: 'Map artwork',
          visible: true,
          items: [
            {
              id: stableId('map-image'),
              source: 'map',
              url: null,
              description: '{currentmap} map artwork',
            },
          ],
        }),
      );
  }
  if (profile.buttons.connect || profile.buttons.mapRules)
    layout.push(
      element('actions', { id: '', type: 'actions', label: 'Server actions', visible: true }),
    );
  layout.push(
    element('updates-separator', {
      id: '',
      type: 'separator',
      label: 'Updates separator',
      visible: true,
      divider: true,
      spacing: 1,
    }),
  );
  if (profile.visibleFields.updates)
    layout.push(
      element('community-updates', defaultUpdatesElement(stableLayoutId('community-updates'))),
    );
  return migrateLegacyUpdateElements(layout) as CardLayoutElement[];
}

export function stableLayoutId(key: string): string {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${hex.padStart(12, '0').slice(-12)}`;
}

function sanitizePersistedTemplate(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/\{([^{}]+)\}/g, (match: string) =>
        validateCardTemplate(match).length ? '' : match,
      )
    : value;
}

function normalizeTextLines(value: unknown): { textLines?: CardLine[] } {
  if (!Array.isArray(value) || value.length !== 6) return {};
  const ids = value.map((line: unknown) =>
    line !== null && typeof line === 'object' ? (line as Record<string, unknown>).id : undefined,
  );
  if (new Set(ids).size !== 6 || ids.some((id) => !CARD_LINE_IDS.includes(id as CardLine['id'])))
    return {};
  return {
    textLines: value.map((line: Record<string, unknown>) => {
      const id = line.id as CardLine['id'];
      return {
        id,
        template: validatedTemplate().safeParse(sanitizePersistedTemplate(line.template)).success
          ? (sanitizePersistedTemplate(line.template) as string)
          : DEFAULT_CARD_TEMPLATES[id],
        visible: typeof line.visible === 'boolean' ? line.visible : true,
        style: z.enum(CARD_LINE_STYLES).safeParse(line.style).success
          ? (line.style as CardLineStyle)
          : DEFAULT_CARD_LINE_STYLES[id],
      };
    }),
  };
}

/** Materializes six generic lines without persisting a migration or changing legacy rendering. */
export function resolveCardLines(
  profileValue: unknown,
  legacyDescription?: string | null,
): CardLine[] {
  const profile = normalizeCardProfile(profileValue);
  if (profile.textLines !== undefined) return profile.textLines;
  const hasTemplates =
    profileValue !== null &&
    typeof profileValue === 'object' &&
    Object.hasOwn(profileValue, 'templates');
  return (['title', 'subtitle', 'playerCount', ...profile.fieldOrder] as const).map((id) => ({
    id,
    template:
      id === 'description' && !hasTemplates && legacyDescription?.trim()
        ? legacyDescription.trim()
        : id === 'subtitle' && profile.templates.subtitle === DEFAULT_CARD_TEMPLATES.subtitle
          ? '{statusicon} {status} \u00b7 {location}'
          : profile.templates[id],
    visible: profile.visibleFields[id],
    style: DEFAULT_CARD_LINE_STYLES[id],
  }));
}

export function isHttpsUrl(value: string | null | undefined): value is string {
  if (value === undefined || value === null || value === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function environmentEmoji(name: string): string | null {
  const value = process.env[name]?.trim();
  return value !== undefined && /^\d{17,20}$/.test(value) ? value : null;
}

/** Resolves nullable overrides against validated environment settings and legacy assets. */
export function resolveCardProfile(value: unknown): ResolvedCardProfile {
  const profile = normalizeCardProfile(value);
  return {
    ...profile,
    thumbnailImageUrl: profile.thumbnailImageUrl ?? DEFAULT_THUMBNAIL_IMAGE_URL,
    onlineEmojiId: profile.onlineEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_ONLINE_ID'),
    offlineEmojiId: profile.offlineEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_OFFLINE_ID'),
    warningEmojiId: profile.warningEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_WARNING_ID'),
    pendingEmojiId: profile.pendingEmojiId ?? environmentEmoji('GAME_SERVER_EMOJI_PENDING_ID'),
  };
}

export function cardAccentColor(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}
