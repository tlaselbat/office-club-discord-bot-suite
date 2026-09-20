import { PublicError } from '../../../errors/public-error.js';

/** Reject policy values that do not have a complete durable formation workflow. */
export function assertSupportedFormationPolicy(policy: {
  teamSelectionMode: string;
  captainPolicy: string;
  mapSelectionMode: string;
}): void {
  if (!['CAPTAINS', 'RANDOM'].includes(policy.teamSelectionMode)) {
    throw unsupported('team selection', policy.teamSelectionMode);
  }
  if (policy.captainPolicy !== 'RANDOM') {
    throw unsupported('captain selection', policy.captainPolicy);
  }
  if (!['CAPTAIN_VETO', 'RANDOM'].includes(policy.mapSelectionMode)) {
    throw unsupported('map selection', policy.mapSelectionMode);
  }
}

function unsupported(subject: string, value: string): PublicError {
  return new PublicError(
    'FORMATION_POLICY_UNSUPPORTED',
    `The configured ${subject} policy (${value}) is not supported by this formation workflow.`,
  );
}
