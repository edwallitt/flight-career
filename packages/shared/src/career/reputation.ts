// Reputation tiers and the gameplay payoffs they unlock.
//
// This is the single source of truth for: (a) the tier thresholds (the server's
// `tierForScore` delegates here, and the web reads the same constants), and
// (b) what each per-client standing tier grants the player — a loyalty pay
// bonus, more frequent ("priority") work, and a lighter cancellation penalty.
//
// Pure logic, no I/O — safe to import from the shared job generator, the server
// lifecycle services, and the web UI alike.

export type ReputationTier = "novice" | "mid" | "high" | "top";

/** Inclusive lower bound of each tier. Mirrors the by-client/by-role bars. */
export const REPUTATION_TIER_MIN: Record<ReputationTier, number> = {
  novice: 0,
  mid: 25,
  high: 60,
  top: 85,
};

export function reputationTier(score: number): ReputationTier {
  if (score >= REPUTATION_TIER_MIN.top) return "top";
  if (score >= REPUTATION_TIER_MIN.high) return "high";
  if (score >= REPUTATION_TIER_MIN.mid) return "mid";
  return "novice";
}

// -- Loyalty pay bonus -------------------------------------------------------
// Higher standing with a client raises the pay on that client's jobs. Baked
// into `jobs.pay` at generation time (so the board number equals the payout),
// applied in calculatePay as `× (1 + loyaltyBonus)`.

export const LOYALTY_BONUS_BY_TIER: Record<ReputationTier, number> = {
  novice: 0,
  mid: 0.1,
  high: 0.2,
  top: 0.3,
};

export function loyaltyBonusForScore(score: number): number {
  return LOYALTY_BONUS_BY_TIER[reputationTier(score)];
}

// -- Priority job frequency --------------------------------------------------
// Loyal clients send you more work: at High+ standing their expected job rate
// is multiplied before sampling in the generator.

export const JOB_FREQUENCY_MULT_BY_TIER: Record<ReputationTier, number> = {
  novice: 1,
  mid: 1,
  high: 1.5,
  top: 1.5,
};

export function jobFrequencyMultiplierForScore(score: number): number {
  return JOB_FREQUENCY_MULT_BY_TIER[reputationTier(score)];
}

// -- Cancellation forgiveness ------------------------------------------------
// A client you have High+ standing with forgives a backed-out contract: the
// *client* reputation hit on cancel/abort is halved. Role-level standing is NOT
// shielded — your reputation in the broader role/industry still takes the full
// hit, so this is a client-scoped perk like the others.

export function cancellationPenaltyFactorForScore(score: number): number {
  const tier = reputationTier(score);
  return tier === "high" || tier === "top" ? 0.5 : 1;
}

/**
 * Apply the cancellation-forgiveness perk to a raw {role, client} reputation
 * penalty. The single chokepoint for the perk's math AND rounding, so the
 * pre-emptive preview (active job surface) and the value actually applied on
 * cancel/abort can never disagree. Role penalty is untouched; the client
 * penalty is halved (rounded) at High+ standing.
 */
export function applyCancellationPerk(
  penalty: { role: number; client: number },
  clientRepScore: number,
): { role: number; client: number } {
  const factor = cancellationPenaltyFactorForScore(clientRepScore);
  return {
    role: penalty.role,
    client: Math.round(penalty.client * factor),
  };
}

/** Compact human-readable list of the perks a tier grants, for UI surfacing. */
export function reputationPerksForTier(tier: ReputationTier): string[] {
  const perks: string[] = [];
  const bonus = LOYALTY_BONUS_BY_TIER[tier];
  if (bonus > 0) perks.push(`+${Math.round(bonus * 100)}% pay`);
  if (JOB_FREQUENCY_MULT_BY_TIER[tier] > 1) perks.push("priority work");
  if (cancellationPenaltyFactorForScore(REPUTATION_TIER_MIN[tier]) < 1) {
    perks.push("lighter cancel penalty");
  }
  return perks;
}
