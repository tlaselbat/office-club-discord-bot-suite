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

/**
 * The first Office Club Competitive release intentionally supports one competitive contract only.
 * Keep this separate from the broad storage schema so future modes require an
 * explicit implementation rather than silently inheriting 5v5 assumptions.
 */
export function assertCompetitiveBo1FiveVFive(profile: GameProfile): void {
  if (
    !profile.enabled ||
    profile.key !== 'competitive_5v5' ||
    profile.playersPerTeam !== 5 ||
    profile.numMaps !== 1 ||
    profile.serverSlots !== 11 ||
    profile.mapAllowlist.length < 2
  ) {
    throw new Error('Office Club Competitive first release supports only BO1 5v5 with 11 server slots');
  }
  if (
    profile.matchzy.wingman ||
    profile.matchzy.minPlayersToReady !== 10 ||
    !profile.matchzy.knifeRound ||
    profile.matchzy.mapSide !== 'knife'
  ) {
    throw new Error('Office Club Competitive first release requires a 10-player competitive ready check');
  }
}
