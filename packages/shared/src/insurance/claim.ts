// Insurance claim resolution.
//
// Pure logic: given the active policy tier (or null when uninsured), the
// severity of an unscheduled maintenance event and its full cost, work out
// the split between what the insurer pays and what the player pays.
//
// Insurance covers UNSCHEDULED events only — this function is never called
// for scheduled 100hr/annual/overhaul work.

import type { EventSeverity } from "../maintenance/events.js";
import { INSURANCE_TIERS, type InsuranceTier } from "./tiers.js";

export interface ClaimInputs {
  policyTier: InsuranceTier | null; // null = uninsured
  eventSeverity: EventSeverity;
  eventCostCents: number; // full cost of the unscheduled event
}

export interface ClaimOutcome {
  // The tier that resolved this claim — null when uninsured. Carried so the
  // UI can label the split ("Insurance (Standard) covered …") without a
  // separate lookup.
  policyTier: InsuranceTier | null;
  covered: boolean; // did the policy cover this severity at all
  fullEventCostCents: number;
  deductibleCents: number; // what the player pays as deductible (0 if not covered)
  insurerPaidCents: number; // what the insurer covered
  playerPaidCents: number; // total the player pays (deductible + excess over ceiling)
  reason: string; // human-readable explanation
}

function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function resolveClaim(inputs: ClaimInputs): ClaimOutcome {
  const { policyTier, eventSeverity, eventCostCents } = inputs;

  // Uninsured — the operator bears the full cost.
  if (policyTier === null) {
    return {
      policyTier: null,
      covered: false,
      fullEventCostCents: eventCostCents,
      deductibleCents: 0,
      insurerPaidCents: 0,
      playerPaidCents: eventCostCents,
      reason: "Uninsured — full cost borne by operator.",
    };
  }

  const spec = INSURANCE_TIERS[policyTier];

  // Severity not covered by this tier — policy applies, but not to this kind
  // of failure.
  if (!spec.coveredSeverities.includes(eventSeverity)) {
    return {
      policyTier,
      covered: false,
      fullEventCostCents: eventCostCents,
      deductibleCents: 0,
      insurerPaidCents: 0,
      playerPaidCents: eventCostCents,
      reason: `${spec.label} cover does not include ${eventSeverity} failures.`,
    };
  }

  const deductible = spec.deductibleCents;

  // Cost fell under the deductible — the policy applied (covered=true) but
  // the player simply pays the small cost and the insurer pays nothing. No
  // claim row should be recorded for this on the server side.
  if (eventCostCents <= deductible) {
    return {
      policyTier,
      covered: true,
      fullEventCostCents: eventCostCents,
      deductibleCents: deductible,
      insurerPaidCents: 0,
      playerPaidCents: eventCostCents,
      reason: `Covered, but cost fell under the ${formatDollars(deductible)} deductible.`,
    };
  }

  // Normal covered claim. Player pays the deductible; the insurer covers the
  // remainder up to the per-claim ceiling; the player pays any excess above
  // the ceiling.
  const aboveDeductible = eventCostCents - deductible;
  const excessOverCeiling = Math.max(
    0,
    aboveDeductible - spec.perClaimCeilingCents,
  );
  const playerPaid = deductible + excessOverCeiling;
  const insurerPaid = eventCostCents - playerPaid;

  const reason =
    excessOverCeiling > 0
      ? `${spec.label} cover: ${formatDollars(deductible)} deductible, insurer paid ${formatDollars(insurerPaid)} (capped at ${formatDollars(spec.perClaimCeilingCents)}); you pay ${formatDollars(excessOverCeiling)} excess.`
      : `${spec.label} cover: ${formatDollars(deductible)} deductible, insurer paid ${formatDollars(insurerPaid)}.`;

  return {
    policyTier,
    covered: true,
    fullEventCostCents: eventCostCents,
    deductibleCents: deductible,
    insurerPaidCents: insurerPaid,
    playerPaidCents: playerPaid,
    reason,
  };
}
