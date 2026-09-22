import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url().refine((value) => value.startsWith('postgresql://'), 'Must be PostgreSQL'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  PANEL_OWNER_DISCORD_USER_IDS: z.string().transform((value, context) => {
    const ids = [
      ...new Set(
        value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0 || ids.some((id) => !/^\d{17,20}$/.test(id))) {
      context.addIssue({
        code: 'custom',
        message: 'Must contain comma-separated Discord user IDs',
      });
      return z.NEVER;
    }
    return ids;
  }),
  PANEL_SESSION_SECRET: z.string().min(32),
  DATHOST_EMAIL: z.email(),
  DATHOST_PASSWORD: z.string().min(1),
  DATHOST_TEMPLATE_SERVER_ID: z.string().min(1),
  PUBLIC_BASE_URL: z.url().refine((value) => value.startsWith('https://'), 'HTTPS is required'),
  MATCH_TOKEN_SIGNING_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'Must encode exactly 32 bytes'),
  DEFAULT_DATHOST_LOCATION: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  MATCHZY_RECONCILIATION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(30_000),
  MATCHZY_STALE_AFTER_MS: z.coerce.number().int().min(30_000).default(120_000),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  DEMO_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  DEMO_COLLECTION_DEADLINE_SECONDS: z.coerce.number().int().min(60).max(7200).default(1800),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment fields: ${fields}`);
  }
  return result.data;
}
