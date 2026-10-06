import { describe, expect, it } from 'vitest';
import { adminShell, generalPage, guildIndex } from '../../../src/http/admin/views.js';

describe('admin page headings', () => {
  it('renders one page title on the guild list, overview, and module pages', () => {
    const pages = [
      guildIndex('owner', 'csrf', []),
      generalPage({
        id: '123',
        name: 'Office Club',
        username: 'owner',
        csrf: 'csrf',
        discordAvailable: true,
        modules: [],
        recentAudit: [],
      }),
      adminShell(
        {
          title: 'Game Servers',
          username: 'owner',
          csrf: 'csrf',
          currentPath: '/admin/guilds/123/game-servers',
          currentGuildId: '123',
        },
        '<p>Content</p>',
      ),
    ];

    for (const html of pages) {
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    }
  });
});
