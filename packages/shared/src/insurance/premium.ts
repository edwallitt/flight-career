// Insurance premium quoting.
//
// Pure logic: given a tier, the aircraft's current insured value, and its
// current maintenance risk tier, produce a monthly premium quote. Premium
// scales linearly with insured value and is surcharged for elevated risk
// state. The top tier is unavailable to aircraft past hard maintenance
// limits.

import type { RiskTier } from "../maintenance/risk.js";
import {
  INSURANCE_TIERS,
  type InsuranceTier,
  type InsuranceTierSpec,
} from "./tiers.js";

export interface PremiumInputs {
  tier: InsuranceTier;
  insuredValueCents: number; // the aircraft's current estimated value
  riskTier: RiskTier; // from the maintenance risk system
  // True when the aircraft is past a hard maintenance limit (the risk
  // assessment's `cannotDispatch` flag). Gates the Comprehensive tier.
  cannotDispatch: boolean;
}

export interface PremiumQuote {
  tier: InsuranceTier;
  monthlyPremiumCents: number;
  insuredValueCents: number;
  baseRateBps: number;
  riskSurchargeBps: number; // extra bps applied for elevated risk state
  deductibleCents: number;
  perClaimCeilingCents: number;
  available: boolean; // false if the tier is disallowed for this aircraft
  unavailableReason: string | null;
}

// Additive surcharge in basis points, applied on top of the tier's base
// rate. Reading the spec formula literally: effectiveRate = base + surcharge.
const RISK_SURCHARGE_BPS: Record<RiskTier, number> = {
  healthy: 0,
  monitor: 10,
  elevated: 30,
  high: 70,
  critical: 150,
};

const DOLLAR_CENTS = 100;

function roundToDollar(cents: number): number {
  return Math.round(cents / DOLLAR_CENTS) * DOLLAR_CENTS;
}

export function quotePremium(inputs: PremiumInputs): PremiumQuote {
  const spec: InsuranceTierSpec = INSURANCE_TIERS[inputs.tier];
  const baseRateBps = spec.premiumRateBps;
  const riskSurchargeBps = RISK_SURCHARGE_BPS[inputs.riskTier];
  const effectiveRateBps = baseRateBps + riskSurchargeBps;

  const monthlyPremiumCents = roundToDollar(
    (inputs.insuredValueCents * effectiveRateBps) / 10_000,
  );

  let available = true;
  let unavailableReason: string | null = null;
  if (spec.requiresAirworthy && inputs.cannotDispatch) {
    available = false;
    unavailableReason =
      "Comprehensive cover requires an airworthy aircraft. Resolve outstanding maintenance first.";
  }

  return {
    tier: inputs.tier,
    monthlyPremiumCents,
    insuredValueCents: inputs.insuredValueCents,
    baseRateBps,
    riskSurchargeBps,
    deductibleCents: spec.deductibleCents,
    perClaimCeilingCents: spec.perClaimCeilingCents,
    available,
    unavailableReason,
  };
}

export function quoteAllTiers(
  inputs: Omit<PremiumInputs, "tier">,
): PremiumQuote[] {
  return (Object.keys(INSURANCE_TIERS) as InsuranceTier[]).map((tier) =>
    quotePremium({ ...inputs, tier }),
  );
}
