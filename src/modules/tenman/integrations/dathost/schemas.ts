import { z } from 'zod';

export const dathostServerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  user_data: z.string().nullable().optional(),
  location: z.string().optional(),
  created_at: z.number().int().nonnegative(),
  on: z.boolean().optional(),
  booting: z.boolean(),
  ip: z.string().optional(),
  ports: z.looseObject({ game: z.number().int().min(1).max(65_535) }).optional(),
  deletion_protection: z.boolean().optional(),
});

export type DatHostServer = z.infer<typeof dathostServerSchema>;
