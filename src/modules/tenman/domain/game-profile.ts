import { z } from 'zod';

const mapNamePattern = /^(de_|workshop\/)[a-z0-9_/-]+$/;
const cvarNamePattern = /^[a-z][a-z0-9_]*$/;

export const gameProfileSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    enabled: z.boolean(),
    playersPerTeam: z.number().int().min(2).max(5),
    numMaps: z.number().int().min(1).max(5),
    serverSlots: z.number().int().min(4).max(64),
    mapAllowlist: z.array(z.string().regex(mapNamePattern)).min(1),
    matchzy: z.object({
      wingman: z.boolean().optional(),
      minPlayersToReady: z.number().int().min(0).max(10),
      knifeRound: z.boolean(),
      mapSide: z.enum(['knife', 'team1_ct', 'team2_ct']),
      cvars: z.record(z.string().regex(cvarNamePattern), z.string()),
    }),
  })
  .superRefine((profile, context) => {
    if (profile.serverSlots < profile.playersPerTeam * 2 + 1) {
      context.addIssue({ code: 'custom', message: 'Server slots must include players and GOTV' });
    }
    if (profile.matchzy.minPlayersToReady > profile.playersPerTeam * 2) {
      context.addIssue({ code: 'custom', message: 'Ready threshold exceeds roster capacity' });
    }
  });

export type GameProfile = z.infer<typeof gameProfileSchema>;
