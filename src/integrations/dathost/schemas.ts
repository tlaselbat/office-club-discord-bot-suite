import { z } from 'zod';

const timeSeriesPointSchema = z.tuple([z.iso.datetime(), z.number().nullable()]);
const graphPointSchema = z.looseObject({
  timestamp: z.number().int(),
  value: z.number(),
});
const playerSchema = z.looseObject({
  name: z.string(),
  duration: z.number().int().optional(),
  score: z.number().int().optional(),
});

export const dathostServerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  user_data: z.string().nullable().optional(),
  location: z.string().optional(),
  created_at: z.number().int().nonnegative(),
  on: z.boolean().optional(),
  booting: z.boolean(),
  game: z.string().optional(),
  ip: z.string().optional(),
  raw_ip: z.string().optional(),
  custom_domain: z.string().nullable().optional(),
  players_online: z.number().int().nonnegative().optional(),
  ports: z.looseObject({ game: z.number().int().min(1).max(65_535) }).optional(),
  cs2_settings: z
    .looseObject({
      slots: z.number().int().positive().optional(),
      max_players: z.number().int().positive().optional(),
    })
    .optional(),
  csgo_settings: z
    .looseObject({
      slots: z.number().int().positive().optional(),
      max_players: z.number().int().positive().optional(),
    })
    .optional(),
  deletion_protection: z.boolean().optional(),
});

export const dathostFileSchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'directory']).default('file'),
  size: z.number().int().nonnegative().optional(),
});

export const dathostServerMetricsSchema = z.looseObject({
  all_time_players: z.array(playerSchema).optional(),
  maps_played: z
    .array(z.looseObject({ map: z.string(), seconds: z.number().int().nonnegative() }))
    .optional(),
  players_online: z.array(playerSchema).optional(),
  players_online_graph: z.array(graphPointSchema).optional(),
  memory_usage_bytes_graph: z.array(graphPointSchema).optional(),
});

const multiSeriesSchema = z.looseObject({
  series: z.array(
    z.looseObject({
      name: z.string().optional(),
      steamid64: z.string().optional(),
      values: z.array(timeSeriesPointSchema),
    }),
  ),
});

export const dathostCsMonitoringMetricsSchema = z.looseObject({
  durationMs: z.number().int().nonnegative().optional(),
  cpu_memory: z
    .looseObject({
      cpu: z.array(timeSeriesPointSchema).optional(),
      memory_mb: z.array(timeSeriesPointSchema).optional(),
    })
    .optional(),
  player_ping: multiSeriesSchema.optional(),
  player_loss: multiSeriesSchema.optional(),
  svms: z.looseObject({ values: z.array(timeSeriesPointSchema) }).optional(),
  player_ids: z
    .looseObject({
      players: z.array(
        z.looseObject({
          adr: z.string().optional(),
          maxPing: z.number().optional(),
          name: z.string().optional(),
          steamid64: z.string(),
          time: z.iso.datetime(),
        }),
      ),
    })
    .optional(),
});

export const dathostCsMonitoringOverviewSchema = z.looseObject({
  durationMs: z.number().int().nonnegative().optional(),
  overview_activity: z.looseObject({ values: z.array(timeSeriesPointSchema) }).optional(),
  server_metadata: z
    .looseObject({
      name: z.string().optional(),
      location: z.string().optional(),
      ip: z.string().optional(),
      game_port: z.number().int().min(1).max(65_535).optional(),
      created_at: z.string().optional(),
      deleted_at: z.string().nullable().optional(),
      started_at: z.string().nullable().optional(),
      stopped_at: z.string().nullable().optional(),
      on: z.boolean().optional(),
      game: z.string().optional(),
    })
    .optional(),
});

export type DatHostFile = z.infer<typeof dathostFileSchema>;
export type DatHostServer = z.infer<typeof dathostServerSchema>;
export type DatHostServerMetrics = z.infer<typeof dathostServerMetricsSchema>;
export type DatHostCsMonitoringMetrics = z.infer<typeof dathostCsMonitoringMetricsSchema>;
export type DatHostCsMonitoringOverview = z.infer<typeof dathostCsMonitoringOverviewSchema>;
