import {
  calculateMonthlyOwnership,
  checkMaintenanceEligibility,
  estimateMaintenance,
  MAINTENANCE_SPECS,
  MAINTENANCE_TYPES,
  type MaintenanceCost,
  type MaintenanceEligibility,
  type MaintenanceType,
  type MaintenanceTypeSpec,
} from "@flightcareer/shared";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  maintenanceEvents,
  ownedAircraft,
} from "../db/schema.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;
const RECOMMENDED_100HR_HOURS = 90;
const RECOMMENDED_ANNUAL_DAYS = 330;
const RECOMMENDED_OVERHAUL_FRACTION = 0.85;

// Hard ceiling on monthly deductions per aircraft per call. 600 months = 50
// years of back-fees, well above any realistic single sim-time advance.
const MAX_MONTHLY_DEDUCTIONS_PER_AIRCRAFT = 600;

function rngForBooking(): () => number {
  // Same cheap LCG used by jobBoard. Seeded from time + jitter so each call
  // produces a different stream.
  let s = (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export interface MaintenanceOption {
  type: MaintenanceType;
  spec: MaintenanceTypeSpec;
  eligibility: MaintenanceEligibility;
  estimate: MaintenanceCost;
  recommended: boolean;
  counterStatus: {
    current: number;
    threshold: number;
    daysOverdue?: number;
    hoursOverdue?: number;
  };
}

export type InProgressMaintenanceType = MaintenanceType | "unscheduled";

export interface InProgressMaintenance {
  eventId: number;
  type: InProgressMaintenanceType;
  // Display label — for scheduled types this comes from MAINTENANCE_SPECS;
  // for unscheduled events we synthesize "Unscheduled repair".
  label: string;
  description: string;
  startedAt: number;
  scheduledCompletionAt: number;
  cost: number;
  airportIcao: string;
  airportName: string;
}

export interface MaintenanceOptionsResult {
  ownedAircraftId: number;
  tailNumber: string;
  model: string;
  currentLocationIcao: string;
  airportName: string;
  inProgress: InProgressMaintenance | null;
  options: MaintenanceOption[];
}

function counterStatusFor(
  type: MaintenanceType,
  owned: typeof ownedAircraft.$inferSelect,
  tboHours: number,
  simNow: number,
): MaintenanceOption["counterStatus"] {
  switch (type) {
    case "100hr": {
      const hoursOverdue = Math.max(0, owned.hoursSince100hr - 100);
      return {
        current: owned.hoursSince100hr,
        threshold: 100,
        ...(hoursOverdue > 0 ? { hoursOverdue } : {}),
      };
    }
    case "annual": {
      const dueAt = owned.annualDueAt;
      const daysOverdue = Math.max(
        0,
        Math.round((simNow - dueAt) / SIM_DAY_MS),
      );
      // Surface "current" as days since the last annual.
      const current = Math.max(
        0,
        Math.round(365 - (dueAt - simNow) / SIM_DAY_MS),
      );
      return {
        current,
        threshold: 365,
        ...(daysOverdue > 0 ? { daysOverdue } : {}),
      };
    }
    case "overhaul": {
      const hoursOverdue = Math.max(0, owned.engineHoursSinceOverhaul - tboHours);
      return {
        current: owned.engineHoursSinceOverhaul,
        threshold: tboHours,
        ...(hoursOverdue > 0 ? { hoursOverdue } : {}),
      };
    }
  }
}

function isRecommended(
  type: MaintenanceType,
  owned: typeof ownedAircraft.$inferSelect,
  tboHours: number,
  simNow: number,
): boolean {
  switch (type) {
    case "100hr":
      return owned.hoursSince100hr >= RECOMMENDED_100HR_HOURS;
    case "annual": {
      const daysUntilDue = Math.round((owned.annualDueAt - simNow) / SIM_DAY_MS);
      return daysUntilDue <= 365 - RECOMMENDED_ANNUAL_DAYS;
    }
    case "overhaul":
      return (
        owned.engineHoursSinceOverhaul >=
        tboHours * RECOMMENDED_OVERHAUL_FRACTION
      );
  }
}

export function getAvailableMaintenance(input: {
  ownedAircraftId: number;
}): MaintenanceOptionsResult | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  const simNow = careerRow.simDateTime;

  const row = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .where(eq(ownedAircraft.id, input.ownedAircraftId))
    .get();
  if (!row) return null;
  const { owned, type, ap } = row;

  // In-progress event (if any) — we surface the active one rather than
  // offering further bookings while work is happening.
  const inProgressRow = db
    .select()
    .from(maintenanceEvents)
    .where(
      and(
        eq(maintenanceEvents.ownedAircraftId, owned.id),
        eq(maintenanceEvents.status, "in_progress"),
      ),
    )
    .get();

  let inProgress: InProgressMaintenance | null = null;
  if (inProgressRow) {
    const ipType = inProgressRow.type as InProgressMaintenanceType;
    const spec =
      ipType === "unscheduled" ? null : (MAINTENANCE_SPECS[ipType] ?? null);
    inProgress = {
      eventId: inProgressRow.id,
      type: ipType,
      label: spec ? spec.label : "Unscheduled repair",
      description: inProgressRow.description,
      startedAt: inProgressRow.startedAt,
      scheduledCompletionAt: inProgressRow.scheduledCompletionAt ?? 0,
      cost: inProgressRow.cost,
      airportIcao: ap.icao,
      airportName: ap.name,
    };
  }

  const rng = rngForBooking();
  const options: MaintenanceOption[] = MAINTENANCE_TYPES.map((t) => {
    const spec = MAINTENANCE_SPECS[t];
    const estimate = estimateMaintenance(
      t,
      {
        hundredHourCostCents: type.hundredHourCost,
        annualCostCents: type.annualCost,
        overhaulCostCents: type.overhaulCost,
      },
      rng,
    );
    const eligibility = checkMaintenanceEligibility(t, {
      aircraft: {
        currentLocationIcao: owned.currentLocationIcao,
        status: owned.status,
        hoursSince100hr: owned.hoursSince100hr,
        hoursSinceAnnual: owned.hoursSinceAnnual,
        engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
        tboHours: type.tboHours,
      },
      airport: {
        icao: ap.icao,
        hasMaintenance: ap.hasMaintenance,
        size: ap.size,
      },
      cost: estimate.baseCostCents,
      cash: careerRow.cash,
    });

    return {
      type: t,
      spec,
      eligibility,
      estimate,
      recommended: isRecommended(t, owned, type.tboHours, simNow),
      counterStatus: counterStatusFor(t, owned, type.tboHours, simNow),
    };
  });

  return {
    ownedAircraftId: owned.id,
    tailNumber: owned.tailNumber,
    model: type.model,
    currentLocationIcao: owned.currentLocationIcao,
    airportName: ap.name,
    inProgress,
    options,
  };
}

export type BookMaintenanceResult =
  | {
      ok: true;
      eventId: number;
      scheduledCompletionAt: number;
      costCents: number;
      durationDays: number;
    }
  | { ok: false; error: string };

export function bookMaintenance(input: {
  ownedAircraftId: number;
  type: MaintenanceType;
}): BookMaintenanceResult {
  return db.transaction((tx): BookMaintenanceResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    const simNow = careerRow.simDateTime;

    const owned = tx
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, input.ownedAircraftId))
      .get();
    if (!owned) return { ok: false, error: "Aircraft not found" };

    const type = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, owned.aircraftTypeId))
      .get();
    if (!type) return { ok: false, error: "Aircraft type not found" };

    const ap = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, owned.currentLocationIcao))
      .get();
    if (!ap) return { ok: false, error: "Aircraft location not found" };

    const spec = MAINTENANCE_SPECS[input.type];
    if (!spec) return { ok: false, error: "Unknown maintenance type" };

    const rng = rngForBooking();
    const estimate = estimateMaintenance(
      input.type,
      {
        hundredHourCostCents: type.hundredHourCost,
        annualCostCents: type.annualCost,
        overhaulCostCents: type.overhaulCost,
      },
      rng,
    );

    const eligibility = checkMaintenanceEligibility(input.type, {
      aircraft: {
        currentLocationIcao: owned.currentLocationIcao,
        status: owned.status,
        hoursSince100hr: owned.hoursSince100hr,
        hoursSinceAnnual: owned.hoursSinceAnnual,
        engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
        tboHours: type.tboHours,
      },
      airport: {
        icao: ap.icao,
        hasMaintenance: ap.hasMaintenance,
        size: ap.size,
      },
      cost: estimate.baseCostCents,
      cash: careerRow.cash,
    });
    if (!eligibility.eligible) {
      return { ok: false, error: eligibility.reasons.join("; ") };
    }

    const scheduledCompletionAt =
      simNow + estimate.durationDays * SIM_DAY_MS;

    const insert = tx
      .insert(maintenanceEvents)
      .values({
        ownedAircraftId: owned.id,
        type: input.type,
        cost: estimate.baseCostCents,
        startedAt: simNow,
        scheduledCompletionAt,
        completedAt: null,
        description: `${spec.label} at ${ap.icao}`,
        status: "in_progress" as const,
      })
      .run();
    const eventId = Number(insert.lastInsertRowid);

    tx.update(career)
      .set({ cash: careerRow.cash - estimate.baseCostCents })
      .where(eq(career.id, 1))
      .run();

    tx.update(ownedAircraft)
      .set({ status: "in_maintenance" })
      .where(eq(ownedAircraft.id, owned.id))
      .run();

    return {
      ok: true,
      eventId,
      scheduledCompletionAt,
      costCents: estimate.baseCostCents,
      durationDays: estimate.durationDays,
    };
  });
}

export interface MaintenanceCompletionResult {
  resolved: number;
}

export function processMaintenanceCompletions(): MaintenanceCompletionResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { resolved: 0 };
  const simNow = careerRow.simDateTime;

  const due = db
    .select()
    .from(maintenanceEvents)
    .where(
      and(
        eq(maintenanceEvents.status, "in_progress"),
        lte(maintenanceEvents.scheduledCompletionAt, simNow),
      ),
    )
    .all();
  if (due.length === 0) return { resolved: 0 };

  let resolved = 0;
  for (const ev of due) {
    db.transaction((tx) => {
      const fresh = tx
        .select()
        .from(maintenanceEvents)
        .where(eq(maintenanceEvents.id, ev.id))
        .get();
      if (!fresh || fresh.status !== "in_progress") return;

      tx.update(maintenanceEvents)
        .set({ status: "completed", completedAt: simNow })
        .where(eq(maintenanceEvents.id, ev.id))
        .run();

      const owned = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, fresh.ownedAircraftId))
        .get();
      if (!owned) return;

      const updates: Partial<typeof ownedAircraft.$inferInsert> = {};
      const eventType = fresh.type as MaintenanceType | "unscheduled";
      switch (eventType) {
        case "100hr":
          updates.hoursSince100hr = 0;
          break;
        case "annual":
          updates.hoursSinceAnnual = 0;
          updates.annualDueAt = simNow + 365 * SIM_DAY_MS;
          break;
        case "overhaul":
          updates.engineHoursSinceOverhaul = 0;
          break;
        case "unscheduled":
          // Unscheduled repairs don't reset any counter; the grounding
          // period elapses and the aircraft becomes available again.
          break;
        default: {
          const exhaustive: never = eventType;
          throw new Error(`Unhandled maintenance type: ${String(exhaustive)}`);
        }
      }

      // Only flip status back to available if the aircraft is still in
      // maintenance. If something else moved it (shouldn't happen during
      // in_maintenance, but defensive), leave it alone.
      if (owned.status === "in_maintenance") {
        updates.status = "available";
      }

      // Drizzle errors on .set({}); only run when there's something to
      // change. (Possible for an unscheduled event whose aircraft is no
      // longer in_maintenance.)
      if (Object.keys(updates).length === 0) return;

      tx.update(ownedAircraft)
        .set(updates)
        .where(eq(ownedAircraft.id, owned.id))
        .run();
    });
    resolved += 1;
  }

  return { resolved };
}

export interface MonthlyOwnershipResult {
  applied: number;
  totalDeductedCents: number;
}

export function processMonthlyOwnership(): MonthlyOwnershipResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { applied: 0, totalDeductedCents: 0 };
  const simNow = careerRow.simDateTime;

  const due = db
    .select({ owned: ownedAircraft, type: aircraftTypes })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .where(lte(ownedAircraft.nextMonthlyCostAt, simNow))
    .all();
  if (due.length === 0) return { applied: 0, totalDeductedCents: 0 };

  let applied = 0;
  let totalDeducted = 0;

  for (const { owned, type } of due) {
    const cost = calculateMonthlyOwnership({
      hangarageMonthlyCents: type.hangarageMonthly,
      insuranceMonthlyCents: type.insuranceMonthly,
    });

    let guard = MAX_MONTHLY_DEDUCTIONS_PER_AIRCRAFT;
    while (guard-- > 0) {
      const result = db.transaction((tx): { paid: number } | null => {
        const fresh = tx
          .select()
          .from(ownedAircraft)
          .where(eq(ownedAircraft.id, owned.id))
          .get();
        if (!fresh) return null;
        if (fresh.nextMonthlyCostAt > simNow) return null;

        const careerNow = tx.select().from(career).where(eq(career.id, 1)).get();
        if (!careerNow) return null;

        // Allow negative cash — the design lets ownership costs overdraft.
        tx.update(career)
          .set({ cash: careerNow.cash - cost.totalCents })
          .where(eq(career.id, 1))
          .run();

        tx.update(ownedAircraft)
          .set({
            nextMonthlyCostAt: fresh.nextMonthlyCostAt + 30 * SIM_DAY_MS,
          })
          .where(eq(ownedAircraft.id, fresh.id))
          .run();

        return { paid: cost.totalCents };
      });
      if (result == null) break;
      applied += 1;
      totalDeducted += result.paid;
    }
  }

  return { applied, totalDeductedCents: totalDeducted };
}
