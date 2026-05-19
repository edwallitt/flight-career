// Per-aircraft insurance service.
//
// Insurance covers UNSCHEDULED maintenance events only — scheduled work is
// always fully player-paid. Policies are per owned aircraft; one active
// policy at a time (enforced here, not by a DB constraint — see schema.ts).
// Premium / deductible / ceiling / insured value are snapshotted at purchase
// and never float over the policy's life.

import {
  assessRisk,
  INSURANCE_TIER_ORDER,
  INSURANCE_TIERS,
  type InsuranceTier,
  priceAircraft,
  quotePremium,
  type PremiumQuote,
  type RiskTier,
} from "@flightcareer/shared";
import { and, eq, lte } from "drizzle-orm";
import { db, type DB } from "../db/client.js";
import {
  aircraftTypes,
  career,
  insurancePolicies,
  ownedAircraft,
} from "../db/schema.js";
import {
  getOwnedAircraftById,
  type OwnedAircraftDetail,
} from "./hangar.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;
const PREMIUM_PERIOD_MS = 30 * SIM_DAY_MS;

// Same hard ceiling rationale as processMonthlyOwnership: 600 months of
// back-charges, well beyond any realistic single sim-time advance.
const MAX_PREMIUM_CHARGES_PER_POLICY = 600;

// Accepts either the root db handle or an open transaction. Structurally
// typing on the query surface keeps both the db and the SQLiteTransaction
// assignable (a plain `DB | Transaction` union trips on the `$client`
// property the transaction type lacks).
type DbOrTx = Pick<DB, "select" | "insert" | "update" | "delete">;

export interface InsurancePolicySummary {
  id: number;
  tier: InsuranceTier;
  tierLabel: string;
  monthlyPremiumCents: number;
  insuredValueCents: number;
  deductibleCents: number;
  perClaimCeilingCents: number;
  startedAt: number;
  nextPremiumDueAt: number;
  paymentsMade: number;
  status: "active" | "cancelled";
}

export interface InsuranceQuotesResult {
  aircraft: OwnedAircraftDetail;
  currentPolicy: InsurancePolicySummary | null;
  quotes: PremiumQuote[];
}

// Minimal maintenance-counter shape needed for a risk read. Both an
// owned_aircraft row joined with its type, and the OwnedAircraftDetail the
// hangar service builds, satisfy this — so quotes and buyPolicy share one
// risk computation instead of duplicating it.
interface RiskCounters {
  hoursSince100hr: number;
  engineHoursSinceOverhaul: number;
  airframeHours: number;
  annualDueAt: number;
  tboHours: number;
}

// Days-since-last-annual derived from the annualDueAt anchor, matching the
// pure logic's >365 = overdue convention (identical to complete.ts and the
// FleetCard risk chip).
function riskTierFor(
  c: RiskCounters,
  simNow: number,
): { tier: RiskTier; cannotDispatch: boolean } {
  const daysSinceAnnual =
    365 + Math.max(0, (simNow - c.annualDueAt) / SIM_DAY_MS);
  const a = assessRisk({
    hoursSince100hr: c.hoursSince100hr,
    hoursSinceAnnual: daysSinceAnnual,
    engineHoursSinceOverhaul: c.engineHoursSinceOverhaul,
    tboHours: c.tboHours,
    airframeHours: c.airframeHours,
  });
  return { tier: a.tier, cannotDispatch: a.cannotDispatch };
}

function valuationCentsFor(
  owned: typeof ownedAircraft.$inferSelect,
  type: typeof aircraftTypes.$inferSelect,
): number {
  return priceAircraft({
    basePurchasePriceCents: type.basePurchasePrice,
    airframeHours: owned.airframeHours,
    engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
    tboHours: type.tboHours,
    hoursSinceAnnual: owned.hoursSinceAnnual,
    hoursSince100hr: owned.hoursSince100hr,
    conditionGrade: "good",
  }).askingPriceCents;
}

function toPolicySummary(
  row: typeof insurancePolicies.$inferSelect,
): InsurancePolicySummary {
  const tier = row.tier;
  return {
    id: row.id,
    tier,
    tierLabel: INSURANCE_TIERS[tier].label,
    monthlyPremiumCents: row.monthlyPremiumCents,
    insuredValueCents: row.insuredValueCents,
    deductibleCents: row.deductibleCents,
    perClaimCeilingCents: row.perClaimCeilingCents,
    startedAt: row.startedAt,
    nextPremiumDueAt: row.nextPremiumDueAt,
    paymentsMade: row.paymentsMade,
    status: row.status as "active" | "cancelled",
  };
}

function activePolicyRow(
  ownedAircraftId: number,
  tx: DbOrTx = db,
): typeof insurancePolicies.$inferSelect | null {
  return (
    tx
      .select()
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.ownedAircraftId, ownedAircraftId),
          eq(insurancePolicies.status, "active"),
        ),
      )
      .get() ?? null
  );
}

// Looks up the active policy tier for an aircraft. Used by the flight
// completion flow to resolve claims against unscheduled events.
export function getActivePolicyForAircraft(
  ownedAircraftId: number,
  tx: DbOrTx = db,
): typeof insurancePolicies.$inferSelect | null {
  return activePolicyRow(ownedAircraftId, tx);
}

export function getInsuranceQuotes(input: {
  ownedAircraftId: number;
}): InsuranceQuotesResult | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  const simNow = careerRow.simDateTime;

  // Reuse the hangar service's detail — it already runs priceAircraft with
  // the same inputs, so the modal header's "Insured value" and the tier-card
  // premiums are guaranteed to agree (no second, independently-drifting
  // valuation). buyPolicy still re-derives valuation transactionally from
  // raw rows; this read-only quote path can trust the detail.
  const aircraft = getOwnedAircraftById(input.ownedAircraftId);
  if (!aircraft) return null;

  const insuredValueCents = aircraft.estimatedValueCents;
  const risk = riskTierFor(aircraft, simNow);

  const quotes = INSURANCE_TIER_ORDER.map((tier) =>
    quotePremium({
      tier,
      insuredValueCents,
      riskTier: risk.tier,
      cannotDispatch: risk.cannotDispatch,
    }),
  );

  const policyRow = activePolicyRow(input.ownedAircraftId);

  return {
    aircraft,
    currentPolicy: policyRow ? toPolicySummary(policyRow) : null,
    quotes,
  };
}

export type BuyPolicyResult =
  | { ok: true; policyId: number }
  | { ok: false; error: string };

export function buyPolicy(input: {
  ownedAircraftId: number;
  tier: InsuranceTier;
}): BuyPolicyResult {
  return db.transaction((tx): BuyPolicyResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    const simNow = careerRow.simDateTime;

    const owned = tx
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, input.ownedAircraftId))
      .get();
    if (!owned) return { ok: false, error: "Aircraft not found" };
    if (owned.status === "sold") {
      return { ok: false, error: "Aircraft has already been sold" };
    }

    const existing = activePolicyRow(input.ownedAircraftId, tx);
    if (existing) {
      return {
        ok: false,
        error:
          "This aircraft already has an active policy. Cancel it before buying a different tier.",
      };
    }

    const type = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, owned.aircraftTypeId))
      .get();
    if (!type) return { ok: false, error: "Aircraft type not found" };

    // Re-quote server-side — never trust a client-supplied premium.
    const insuredValueCents = valuationCentsFor(owned, type);
    const risk = riskTierFor(
      { ...owned, tboHours: type.tboHours },
      simNow,
    );
    const quote = quotePremium({
      tier: input.tier,
      insuredValueCents,
      riskTier: risk.tier,
      cannotDispatch: risk.cannotDispatch,
    });
    if (!quote.available) {
      return {
        ok: false,
        error: quote.unavailableReason ?? "This tier is unavailable",
      };
    }

    const insert = tx
      .insert(insurancePolicies)
      .values({
        ownedAircraftId: owned.id,
        tier: input.tier,
        monthlyPremiumCents: quote.monthlyPremiumCents,
        insuredValueCents: quote.insuredValueCents,
        deductibleCents: quote.deductibleCents,
        perClaimCeilingCents: quote.perClaimCeilingCents,
        startedAt: simNow,
        nextPremiumDueAt: simNow + PREMIUM_PERIOD_MS,
        paymentsMade: 1, // the first month is charged immediately below
        status: "active",
      })
      .run();

    // Charge the first month's premium now. Overdraft is allowed, consistent
    // with loan payments and monthly ownership costs.
    tx.update(career)
      .set({ cash: careerRow.cash - quote.monthlyPremiumCents })
      .where(eq(career.id, 1))
      .run();

    return { ok: true, policyId: Number(insert.lastInsertRowid) };
  });
}

export type CancelPolicyResult =
  | { ok: true }
  | { ok: false; error: string };

export function cancelPolicy(input: {
  ownedAircraftId: number;
}): CancelPolicyResult {
  return db.transaction((tx): CancelPolicyResult => {
    const policy = activePolicyRow(input.ownedAircraftId, tx);
    if (!policy) {
      return { ok: false, error: "No active policy on this aircraft" };
    }
    // No proration or refund of the current month — consistent with the
    // no-proration approach used elsewhere. Cover ends immediately; the
    // player paid for the month and forfeits the remainder. The cancel UI
    // states this plainly.
    tx.update(insurancePolicies)
      .set({ status: "cancelled" })
      .where(eq(insurancePolicies.id, policy.id))
      .run();
    return { ok: true };
  });
}

export interface InsurancePremiumResult {
  charged: number;
  totalCents: number;
}

// Monthly premium processor. Mirrors processMonthlyOwnership / loan payments:
// find active policies whose premium is due, charge the snapshotted premium,
// advance the due date 30 sim days, loop for multi-month gaps. Overdraft is
// allowed. Non-payment does NOT auto-cancel the policy — overdraft is the
// consequence model, consistent with loans (a possible future addition).
export function processInsurancePremiums(): InsurancePremiumResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { charged: 0, totalCents: 0 };
  const simNow = careerRow.simDateTime;

  const due = db
    .select()
    .from(insurancePolicies)
    .where(
      and(
        eq(insurancePolicies.status, "active"),
        lte(insurancePolicies.nextPremiumDueAt, simNow),
      ),
    )
    .all();
  if (due.length === 0) return { charged: 0, totalCents: 0 };

  let charged = 0;
  let totalCents = 0;

  for (const policy of due) {
    let guard = MAX_PREMIUM_CHARGES_PER_POLICY;
    while (guard-- > 0) {
      const result = db.transaction((tx): { paid: number } | null => {
        const fresh = tx
          .select()
          .from(insurancePolicies)
          .where(eq(insurancePolicies.id, policy.id))
          .get();
        if (!fresh) return null;
        if (fresh.status !== "active") return null;
        if (fresh.nextPremiumDueAt > simNow) return null;

        const careerNow = tx.select().from(career).where(eq(career.id, 1)).get();
        if (!careerNow) return null;

        tx.update(career)
          .set({ cash: careerNow.cash - fresh.monthlyPremiumCents })
          .where(eq(career.id, 1))
          .run();

        tx.update(insurancePolicies)
          .set({
            nextPremiumDueAt: fresh.nextPremiumDueAt + PREMIUM_PERIOD_MS,
            paymentsMade: fresh.paymentsMade + 1,
          })
          .where(eq(insurancePolicies.id, fresh.id))
          .run();

        return { paid: fresh.monthlyPremiumCents };
      });
      if (result == null) break;
      charged += 1;
      totalCents += result.paid;
    }
  }

  return { charged, totalCents };
}
