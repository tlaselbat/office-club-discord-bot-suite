import { z } from 'zod';

const steamId64Schema = z.string().regex(/^7656119\d{10}$/);
const teamNameSchema = z.string().min(1).max(64);
const playerNameSchema = z.string().min(1).max(64);
const mapNameSchema = z.string().regex(/^(de_|workshop\/)[a-z0-9_/-]+$/);
const sideSchema = z.enum(['ct', 't', 'spec']).nullable();
const teamSchema = z.enum(['team1', 'team2', 'spec']).nullable();

export const matchzyConfigSchema = z.strictObject({
  matchid: z.number().int().positive(),
  team1: z.strictObject({
    name: teamNameSchema,
    players: z.record(steamId64Schema, playerNameSchema),
  }),
  team2: z.strictObject({
    name: teamNameSchema,
    players: z.record(steamId64Schema, playerNameSchema),
  }),
  num_maps: z.number().int().min(1).max(5),
  maplist: z.array(mapNameSchema).min(1).max(5),
  map_sides: z.array(z.enum(['knife', 'team1_ct', 'team2_ct'])).optional(),
  players_per_team: z.number().int().min(2).max(5).optional(),
  min_players_to_ready: z.number().int().min(0).max(10).optional(),
  cvars: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string()).optional(),
  wingman: z.boolean().optional(),
  remote_log_url: z.url().optional(),
  remote_log_header_key: z.string().min(1).max(64).optional(),
  remote_log_header_value: z.string().min(16).max(256).optional(),
});

const eventBase = z.object({ event: z.string(), matchid: z.number().int().positive() });
const winnerSchema = z.object({ side: sideSchema, team: teamSchema });
const statsTeamSchema = z.looseObject({
  name: z.string(),
  series_score: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
});

export const matchzyEventSchema = z.discriminatedUnion('event', [
  eventBase.extend({
    event: z.literal('series_start'),
    num_maps: z.number().int().positive(),
    team1: z.looseObject({ name: z.string() }),
    team2: z.looseObject({ name: z.string() }),
  }),
  eventBase.extend({ event: z.literal('going_live'), map_number: z.number().int().nonnegative() }),
  eventBase.extend({
    event: z.literal('round_end'),
    map_number: z.number().int().nonnegative(),
    round_number: z.number().int().nonnegative(),
    round_time: z.number().int().nonnegative(),
    reason: z.number().int().nonnegative(),
    winner: winnerSchema,
    team1: statsTeamSchema,
    team2: statsTeamSchema,
  }),
  eventBase.extend({
    event: z.literal('map_result'),
    map_number: z.number().int().nonnegative(),
    winner: winnerSchema,
    team1: statsTeamSchema,
    team2: statsTeamSchema,
  }),
  eventBase.extend({
    event: z.literal('series_end'),
    team1_series_score: z.number().int().nonnegative(),
    team2_series_score: z.number().int().nonnegative(),
    winner: winnerSchema,
    time_until_restore: z.number().int().nonnegative(),
  }),
  eventBase.extend({
    event: z.enum(['map_picked', 'map_vetoed']),
    team: teamSchema,
    map_name: mapNameSchema,
    map_number: z.number().int().nonnegative(),
  }),
  eventBase.extend({
    event: z.literal('side_picked'),
    team: teamSchema,
    map_name: mapNameSchema,
    map_number: z.number().int().nonnegative(),
    side: sideSchema,
  }),
  eventBase.extend({
    event: z.literal('demo_upload_ended'),
    map_number: z.number().int().nonnegative(),
    filename: z.string().min(1).max(255),
    success: z.boolean(),
  }),
]);

export type MatchZyConfig = z.infer<typeof matchzyConfigSchema>;
export type MatchZyEvent = z.infer<typeof matchzyEventSchema>;
