// Aircraft insurance tier definitions.
//
// Pure data. Three tiers covering UNSCHEDULED maintenance events only —
// scheduled 100hr/annual/overhaul work is always fully player-paid and is
// never insurable. Tiers differ on three axes: monthly premium rate,
// per-claim deductible, and which event severities are covered.
//
// -------------------------------------------------------------------------
// TUNING INTENT — READ BEFORE CHANGING THESE NUMBERS
// -------------------------------------------------------------------------
// Insurance here is deliberately NET-NEGATIVE in expectation. Across the
// distribution of unscheduled events produced by the maintenance risk model
// (see packages/shared/src/maintenance/events.ts SEVERITY_WEIGHTS), total
// premiums a typical player pays should modestly EXCEED total insurer
// payouts. The player is buying variance reduction, not profit.
//
// These rates/deductibles/ceilings are starting estimates and are explicitly
// tunable after playtesting. If you change them, keep the net-negative
// property: `insurance/__tests__/net-negative.test.ts` is an advisory guard
// that draws a representative spread of events and asserts premiums comfortably
// exceed payouts. Do NOT tune toward insurance being profitable.
// -------------------------------------------------------------------------

import type { EventSeverity } from "../maintenance/events.js";

// Single source of truth for the tier set and its display order. The
// server DB column (apps/server schema.ts) mirrors these literals as its
// own persistence contract and must stay in sync.
export const INSURANCE_TIER_ORDER = [
  "basic",
  "standard",
  "comprehensive",
] as const;

export type InsuranceTier = (typeof INSURANCE_TIER_ORDER)[number];

export interface InsuranceTierSpec {
  tier: InsuranceTier;
  label: string;
  description: string;
  // Which unscheduled event severities the insurer pays toward.
  coveredSeverities: EventSeverity[];
  // Per-claim deductible — a fixed cents amount the player always pays first.
  deductibleCents: number;
  // Insurer covers costs up to this ceiling per claim; player pays any excess.
  perClaimCeilingCents: number;
  // Monthly premium as basis points of the aircraft's insured value.
  premiumRateBps: number;
  // Top tier is unavailable to aircraft past hard maintenance limits.
  requiresAirworthy: boolean;
}

export const INSURANCE_TIERS: Record<InsuranceTier, InsuranceTierSpec> = {
  basic: {
    tier: "basic",
    label: "Basic",
    description:
      "Covers severe failures only. High deductible. Lowest premium. Light and moderate events remain fully your cost.",
    coveredSeverities: ["severe"],
    deductibleCents: 500_000, // $5,000
    perClaimCeilingCents: 5_000_000, // $50,000
    premiumRateBps: 18, // 0.18% of insured value / month
    requiresAirworthy: false,
  },
  standard: {
    tier: "standard",
    label: "Standard",
    description:
      "Covers moderate and severe failures. Moderate deductible. Light events remain your cost.",
    coveredSeverities: ["moderate", "severe"],
    deductibleCents: 200_000, // $2,000
    perClaimCeilingCents: 12_000_000, // $120,000
    premiumRateBps: 42, // 0.42% of insured value / month
    requiresAirworthy: false,
  },
  comprehensive: {
    tier: "comprehensive",
    label: "Comprehensive",
    description:
      "Covers all unscheduled failures including light events. Low deductible. Highest premium. Requires the aircraft to be airworthy.",
    coveredSeverities: ["light", "moderate", "severe"],
    deductibleCents: 50_000, // $500
    perClaimCeilingCents: 30_000_000, // $300,000
    premiumRateBps: 85, // 0.85% of insured value / month
    requiresAirworthy: true,
  },
};

