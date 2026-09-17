import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { matchzyEventSchema } from '../integrations/matchzy/schemas.js';
import type { MatchCredentialService } from '../services/match-credential-service.js';
import type { MatchZyEventService } from '../services/matchzy-event-service.js';

const paramsSchema = z.object({ matchId: z.uuid() });

export interface MatchZyRoutesDependencies {
  prisma: PrismaClient;
  credentials: MatchCredentialService;
  events: MatchZyEventService;
}

export function registerMatchZyRoutes(
  app: FastifyInstance,
  dependencies: MatchZyRoutesDependencies,
): void {
  app.get('/internal/matches/:matchId/matchzy-config', async (request, reply) => {
    const { matchId } = paramsSchema.parse(request.params);
    const token = readToken(request.headers['x-matchzy-token']);
    const match = await dependencies.prisma.match.findUnique({
      where: { id: matchId },
      select: { dathostServerId: true, matchzyConfig: true },
    });
    if (
      match === null ||
      match.matchzyConfig === null ||
      !(await dependencies.credentials.verify(token, matchId, 'CONFIG_READ', match.dathostServerId))
    ) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply
      .header('cache-control', 'no-store')
      .header('content-type', 'application/json; charset=utf-8')
      .send(match.matchzyConfig);
  });

  app.post('/webhooks/matchzy/:matchId', async (request, reply) => {
    const { matchId } = paramsSchema.parse(request.params);
    const token = readToken(request.headers['x-matchzy-token']);
    const match = await dependencies.prisma.match.findUnique({
      where: { id: matchId },
      select: { dathostServerId: true },
    });
    if (
      match === null ||
      !(await dependencies.credentials.verify(token, matchId, 'EVENT_WRITE', match.dathostServerId))
    ) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const event = matchzyEventSchema.parse(request.body);
    const result = await dependencies.events.ingest(matchId, event);
    return reply.code(result === 'duplicate' ? 200 : 202).send({ status: result });
  });
}

function readToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) return '';
  return value;
}
