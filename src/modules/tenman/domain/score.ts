import { z } from 'zod';

const scoreSchema = z.object({
  team1: z.number().int().nonnegative(),
  team2: z.number().int().nonnegative(),
});

export type MatchScore = z.infer<typeof scoreSchema>;

export function parseMatchScore(value: unknown): MatchScore | null {
  const result = scoreSchema.safeParse(value);
  return result.success ? result.data : null;
}
