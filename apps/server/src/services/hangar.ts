import {
  priceAircraft,
  MAINTENANCE_SPECS,
  type AircraftClass,
  type InsuranceTier,
  type MaintenanceType,
} from "@flightcareer/shared";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  insurancePolicies,
  loans,
  maintenanceEvents,
  ownedAircraft,
} from "../db/schema.js";
import { fuelPriceCentsPerGal } from "./jobLifecycle.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

// True days-since-last-annual for an OWNED aircraft, derived from the
// annualDueAt anchor (the canonical annual clock). Do NOT price owned aircraft
// off the stored owned_aircraft.hoursSinceAnnual column: for owned aircraft
// that column accumulates block *hours* (wrong unit) and is frozen at the last
// flight, while the annual is calendar-based and advances with sim time.
// Inverts seed.ts / purchase.ts (annualDueAt = simNow + (365 - days) * day),
// so a fresh annual reads ~0 and an overdue one reads >365. Clamped at 0.
export function daysSinceAnnualForPricing(
  annualDueAt: number,
  simNow: number,
): number {
  return Math.max(0, 365 - (annualDueAt - simNow) / SIM_DAY_MS);
}

export interface OwnedLoanInfo {
  id: number;
  principalCents: number;
  remainingBalanceCents: number;
  monthlyPaymentCents: number;
  interestRateBps: number;
  nextPaymentDue: number;
  termMonths: number;
  originalTermMonths: number;
  paymentsMade: number;
  fullyPaid: boolean;
  paidOffAt: number | null;
}

export interface InProgressMaintenanceSummary {
  type: MaintenanceType | "unscheduled";
  label: string;
  description: string;
  startedAt: number;
  scheduledCompletionAt: number;
  cost: number;
}

export interface OwnedAircraftDetail {
  id: number;
  tailNumber: string;
  aircraftTypeId: string;
  currentLocationIcao: string;
  airframeHours: number;
  engineHoursSinceOverhaul: number;
  hoursSince100hr: number;
  hoursSinceAnnual: number;
  annualDueAt: number;
  fuelOnBoardGal: number;
  status: "available" | "in_maintenance" | "in_flight" | "committed";
  purchasedAt: number;
  purchasePriceCents: number;

  manufacturer: string;
  model: string;
  aircraftClass: AircraftClass;
  fuelType: "avgas" | "jet-a";
  cruiseSpeedKts: number;
  fuelBurnGph: number;
  rangeNm: number;
  mtowLbs: number;
  maxPayloadLbs: number;
  unpavedCapable: boolean;
  tboHours: number;
  hangarageMonthlyCents: number;
  insuranceMonthlyCents: number;
  hundredHourCostCents: number;
  annualCostCents: number;
  overhaulCostCents: number;

  locationName: string;
  locationHasFuel: boolean;
  fuelPriceCentsPerGal: number;

  loan: OwnedLoanInfo | null;

  engineRemainingHours: number;
  hundredHourRemainingHours: number;
  annualDaysRemaining: number;
  fuelCapacityGal: number;
  estimatedValueCents: number;
  loanLtvRatio: number | null;
  monthlyFixedCostsCents: number;
  inProgressMaintenance: InProgressMaintenanceSummary | null;
  nextMonthlyCostAt: number;
  // Active per-aircraft insurance policy summary. Null = uninsured (a
  // legitimate choice — the UI shows a muted UNINSURED chip, not a warning).
  insurance: {
    tier: InsuranceTier;
    monthlyPremiumCents: number;
  } | null;
}

function buildDetail(
  owned: typeof ownedAircraft.$inferSelect,
  type: typeof aircraftTypes.$inferSelect,
  airport: typeof airports.$inferSelect,
  loanRow: typeof loans.$inferSelect | null,
  inProgress: typeof maintenanceEvents.$inferSelect | null,
  activePolicy: typeof insurancePolicies.$inferSelect | null,
  simNow: number,
): OwnedAircraftDetail {
  const engineRemaining = Math.max(
    0,
    type.tboHours - owned.engineHoursSinceOverhaul,
  );
  const hundredHourRemaining = Math.max(0, 100 - owned.hoursSince100hr);
  const annualDaysRemaining = Math.round(
    (owned.annualDueAt - simNow) / SIM_DAY_MS,
  );

  const pricing = priceAircraft({
    basePurchasePriceCents: type.basePurchasePrice,
    airframeHours: owned.airframeHours,
    engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
    tboHours: type.tboHours,
    hoursSinceAnnual: daysSinceAnnualForPricing(owned.annualDueAt, simNow),
    hoursSince100hr: owned.hoursSince100hr,
    conditionGrade: "good",
  });
  const estimatedValueCents = pricing.askingPriceCents;

  const loanInfo: OwnedLoanInfo | null = loanRow
    ? (() => {
        const originalTerm =
          loanRow.originalTermMonths > 0
            ? loanRow.originalTermMonths
            : loanRow.termMonths;
        const fullyPaid =
          loanRow.remainingBalance <= 0 &&
          loanRow.paymentsMade >= originalTerm;
        // Approximate the date of the final payment as one month before the
        // *current* nextPaymentDue (which advances 30 days after each pay).
        // Good enough for a celebratory "paid off on …" line.
        const paidOffAt = fullyPaid
          ? loanRow.nextPaymentDue - 30 * SIM_DAY_MS
          : null;
        return {
          id: loanRow.id,
          principalCents: loanRow.principal,
          remainingBalanceCents: loanRow.remainingBalance,
          monthlyPaymentCents: loanRow.monthlyPayment,
          interestRateBps: loanRow.interestRateBps,
          nextPaymentDue: loanRow.nextPaymentDue,
          termMonths: loanRow.termMonths,
          originalTermMonths: originalTerm,
          paymentsMade: loanRow.paymentsMade,
          fullyPaid,
          paidOffAt,
        };
      })()
    : null;

  // type.insuranceMonthly is the unavoidable baseline (liability/hangar
  // cover, charged by processMonthlyOwnership regardless of policy choice).
  // An active per-aircraft policy adds its premium ON TOP — the header's
  // "Fixed / mo" must reflect what the player actually pays each month.
  const insuranceField =
    activePolicy && activePolicy.status === "active"
      ? {
          tier: activePolicy.tier,
          monthlyPremiumCents: activePolicy.monthlyPremiumCents,
        }
      : null;

  const monthlyFixedCostsCents =
    type.hangarageMonthly +
    type.insuranceMonthly +
    (insuranceField?.monthlyPremiumCents ?? 0) +
    (loanInfo && !loanInfo.fullyPaid ? loanInfo.monthlyPaymentCents : 0);

  const loanLtvRatio =
    loanInfo && estimatedValueCents > 0
      ? loanInfo.remainingBalanceCents / estimatedValueCents
      : null;

  const locationHasFuel =
    type.fuelType === "jet-a" ? airport.hasJetA : airport.hasAvgas;

  return {
    id: owned.id,
    tailNumber: owned.tailNumber,
    aircraftTypeId: type.id,
    currentLocationIcao: owned.currentLocationIcao,
    airframeHours: owned.airframeHours,
    engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
    hoursSince100hr: owned.hoursSince100hr,
    hoursSinceAnnual: owned.hoursSinceAnnual,
    annualDueAt: owned.annualDueAt,
    fuelOnBoardGal: owned.fuelOnBoardGal,
    status: owned.status as Exclude<typeof owned.status, "sold">,
    purchasedAt: owned.purchasedAt,
    purchasePriceCents: owned.purchasePrice,

    manufacturer: type.manufacturer,
    model: type.model,
    aircraftClass: type.class,
    fuelType: type.fuelType,
    cruiseSpeedKts: type.cruiseSpeedKts,
    fuelBurnGph: type.fuelBurnGph,
    rangeNm: type.rangeNm,
    mtowLbs: type.mtowLbs,
    maxPayloadLbs: type.maxPayloadLbs,
    unpavedCapable: type.unpavedCapable,
    tboHours: type.tboHours,
    hangarageMonthlyCents: type.hangarageMonthly,
    insuranceMonthlyCents: type.insuranceMonthly,
    hundredHourCostCents: type.hundredHourCost,
    annualCostCents: type.annualCost,
    overhaulCostCents: type.overhaulCost,

    locationName: airport.name,
    locationHasFuel,
    fuelPriceCentsPerGal: locationHasFuel
      ? fuelPriceCentsPerGal(type.fuelType, airport.icao, airport.baseFuelMultiplier)
      : 0,

    loan: loanInfo,
    engineRemainingHours: engineRemaining,
    hundredHourRemainingHours: hundredHourRemaining,
    annualDaysRemaining,
    fuelCapacityGal: type.fuelCapacityGal,
    estimatedValueCents,
    loanLtvRatio,
    monthlyFixedCostsCents,
    insurance: insuranceField,
    inProgressMaintenance: inProgress
      ? {
          type: inProgress.type as MaintenanceType | "unscheduled",
          label:
            inProgress.type === "unscheduled"
              ? "Unscheduled repair"
              : (MAINTENANCE_SPECS[inProgress.type as MaintenanceType]?.label ??
                inProgress.type),
          description: inProgress.description,
          startedAt: inProgress.startedAt,
          scheduledCompletionAt: inProgress.scheduledCompletionAt ?? 0,
          cost: inProgress.cost,
        }
      : null,
    nextMonthlyCostAt: owned.nextMonthlyCostAt,
  };
}

function getSimNow(): number {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  return careerRow?.simDateTime ?? Date.now();
}

export function getOwnedAircraft(): OwnedAircraftDetail[] {
  const simNow = getSimNow();
  const rows = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .where(ne(ownedAircraft.status, "sold"))
    .all();
  if (rows.length === 0) return [];

  const loanRows = db.select().from(loans).all();
  const loansByAircraftId = new Map<number, typeof loans.$inferSelect>();
  for (const l of loanRows) {
    loansByAircraftId.set(l.ownedAircraftId, l);
  }

  const inProgressRows = db
    .select()
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.status, "in_progress"))
    .all();
  const inProgressByAircraftId = new Map<
    number,
    typeof maintenanceEvents.$inferSelect
  >();
  for (const ev of inProgressRows) {
    inProgressByAircraftId.set(ev.ownedAircraftId, ev);
  }

  const policyRows = db
    .select()
    .from(insurancePolicies)
    .where(eq(insurancePolicies.status, "active"))
    .all();
  const policyByAircraftId = new Map<
    number,
    typeof insurancePolicies.$inferSelect
  >();
  for (const p of policyRows) {
    policyByAircraftId.set(p.ownedAircraftId, p);
  }

  const details = rows.map(({ owned, type, ap }) =>
    buildDetail(
      owned,
      type,
      ap,
      loansByAircraftId.get(owned.id) ?? null,
      inProgressByAircraftId.get(owned.id) ?? null,
      policyByAircraftId.get(owned.id) ?? null,
      simNow,
    ),
  );
  details.sort((a, b) => b.purchasedAt - a.purchasedAt);
  return details;
}

export function getOwnedAircraftById(id: number): OwnedAircraftDetail | null {
  const simNow = getSimNow();
  const row = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .where(and(eq(ownedAircraft.id, id), ne(ownedAircraft.status, "sold")))
    .get();
  if (!row) return null;

  const loanRow =
    db
      .select()
      .from(loans)
      .where(eq(loans.ownedAircraftId, id))
      .get() ?? null;

  const inProgressRow =
    db
      .select()
      .from(maintenanceEvents)
      .where(
        and(
          eq(maintenanceEvents.ownedAircraftId, id),
          eq(maintenanceEvents.status, "in_progress"),
        ),
      )
      .get() ?? null;

  const activePolicy =
    db
      .select()
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.ownedAircraftId, id),
          eq(insurancePolicies.status, "active"),
        ),
      )
      .get() ?? null;

  return buildDetail(
    row.owned,
    row.type,
    row.ap,
    loanRow,
    inProgressRow,
    activePolicy,
    simNow,
  );
}

export interface RefuelResult {
  ok: true;
  fuelAddedGal: number;
  costCents: number;
  fuelOnBoardGal: number;
  cashAfterCents: number;
}

export type RefuelOutcome = RefuelResult | { ok: false; error: string };

export function refuelOwnedAircraft(aircraftId: number): RefuelOutcome {
  return db.transaction((tx): RefuelOutcome => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };

    const owned = tx
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, aircraftId))
      .get();
    if (!owned) return { ok: false, error: "Aircraft not found" };
    if (owned.status !== "available") {
      return {
        ok: false,
        error: `Aircraft is not available (status: ${owned.status})`,
      };
    }

    const type = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, owned.aircraftTypeId))
      .get();
    if (!type) return { ok: false, error: "Aircraft type not found" };

    const airport = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, owned.currentLocationIcao))
      .get();
    if (!airport) return { ok: false, error: "Aircraft location not found" };

    const hasRightFuel =
      type.fuelType === "jet-a" ? airport.hasJetA : airport.hasAvgas;
    if (!hasRightFuel) {
      return {
        ok: false,
        error: `${airport.icao} does not sell ${type.fuelType.toUpperCase()}`,
      };
    }

    const capacity = type.fuelCapacityGal;
    const needed = Math.max(0, capacity - owned.fuelOnBoardGal);
    if (needed <= 0) {
      return { ok: false, error: "Tanks are already full" };
    }

    const pricePerGal = fuelPriceCentsPerGal(
      type.fuelType,
      airport.icao,
      airport.baseFuelMultiplier,
    );
    const costCents = Math.round(needed * pricePerGal);
    if (careerRow.cash < costCents) {
      return { ok: false, error: "Insufficient cash for fuel" };
    }

    tx.update(ownedAircraft)
      .set({ fuelOnBoardGal: capacity })
      .where(
        and(
          eq(ownedAircraft.id, aircraftId),
          eq(ownedAircraft.status, "available"),
        ),
      )
      .run();

    tx.update(career)
      .set({ cash: careerRow.cash - costCents })
      .where(eq(career.id, 1))
      .run();

    return {
      ok: true,
      fuelAddedGal: needed,
      costCents,
      fuelOnBoardGal: capacity,
      cashAfterCents: careerRow.cash - costCents,
    };
  });
}
