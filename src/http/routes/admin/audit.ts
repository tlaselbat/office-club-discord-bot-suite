import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { auditPage } from '../../admin/views.js';
import { idSchema } from './shared.js';
import type { SharedHelpers } from './shared.js';

export function registerAuditRoutes(app: FastifyInstance, shared: SharedHelpers): void {
  app.get('/admin/guilds/:guildId/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    shared.headers(reply);
    const auth = await shared.authenticate(request, reply);
    if (auth === null) return;
    const params = z.object({ guildId: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(404).type('text/html').send('<h1>Not found</h1>');
    const discordGuild = shared.guild(params.data.guildId);
    if (discordGuild === undefined)
      return reply.code(404).type('text/html').send('<h1>Not found</h1>');
    const entries = await shared.recentAudit(params.data.guildId, 100);
    return reply.type('text/html').send(
      auditPage({
        id: params.data.guildId,
        name: discordGuild.name,
        username: auth.discordUserId,
        csrf: auth.csrf,
        entries,
      }),
    );
  });
}
