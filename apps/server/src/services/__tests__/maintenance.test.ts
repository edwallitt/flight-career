import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { career, maintenanceEvents, ownedAircraft } from "../../db/schema.js";
import {
  getCareer,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  bookMaintenance,
  getAvailableMaintenance,
  processMaintenanceCompletions,
  processMonthlyOwnership,
} from "../maintenance.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;
const MAINTENANCE_AIRPORT = "CYHZ";

function setSimNow(now: number): void {
  db.update(career).set({ simDateTime: now }).where(eq(career.id, 1)).run();
}

describe("getAvailableMaintenance", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("returns one option for each MAINTENANCE_TYPE with eligibility and counter status", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: MAINTENANCE_AIRPORT,
      hoursSince100hr: 95,
    });
    const result = getAvailableMaintenance({ ownedAircraftId: ac.id });
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(3);
    const types = result!.options.map((o) => o.type).sort();
    expect(types).toEqual(["100hr", "annual", "overhaul"]);
    const hundred = result!.options.find((o) => o.type === "100hr")!;
    expect(hundred.counterStatus.current).toBe(95);
    expect(hundred.counterStatus.threshold).toBe(100);
    expect(hundred.recommended).toBe(true); // ≥ 90 hours
  });

  it("returns null for unknown aircraft", () => {
    expect(getAvailableMaintenance({ ownedAircraftId: 99999 })).toBeNull();
  });

  it("surfaces an in-progress event instead of letting more bookings happen", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const booked = bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    expect(booked.ok).toBe(true);

    const result = getAvailableMaintenance({ ownedAircraftId: ac.id });
    expect(result!.inProgress).not.toBeNull();
    expect(result!.inProgress!.type).toBe("100hr");
    expect(result!.inProgress!.cost).toBeGreaterThan(0);
  });
});

describe("bookMaintenance", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("books a 100hr: deducts cash, flips aircraft to in_maintenance, creates event", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const beforeCash = getCareer().cash;

    const result = bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.costCents).toBeGreaterThan(0);
    expect(result.durationDays).toBeGreaterThanOrEqual(1);
    expect(result.scheduledCompletionAt).toBe(
      getCareer().simDateTime + result.durationDays * SIM_DAY_MS,
    );

    const afterCash = getCareer().cash;
    expect(afterCash).toBe(beforeCash - result.costCents);

    const acRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acRow.status).toBe("in_maintenance");

    const ev = db
      .select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.id, result.eventId))
      .get()!;
    expect(ev.type).toBe("100hr");
    expect(ev.status).toBe("in_progress");
    expect(ev.ownedAircraftId).toBe(ac.id);
    expect(ev.cost).toBe(result.costCents);
  });

  it("rejects booking at a non-maintenance airport", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYCH" });
    const result = bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/maintenance/i);
  });

  it("rejects booking when cash is below the cost", () => {
    resetTestDb({ cash: 100_00 }); // $100
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const result = bookMaintenance({ ownedAircraftId: ac.id, type: "annual" });
    expect(result.ok).toBe(false);
  });

  it("rejects booking when aircraft is not available (in maintenance)", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    // Try a second concurrent booking — should fail because status is now in_maintenance.
    const result = bookMaintenance({ ownedAircraftId: ac.id, type: "annual" });
    expect(result.ok).toBe(false);
  });
});

describe("processMaintenanceCompletions", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("100hr completion: resets hoursSince100hr, restores aircraft to available", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: MAINTENANCE_AIRPORT,
      hoursSince100hr: 95,
    });
    const booked = bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;

    // Pre-completion: status is in_maintenance, hours unchanged.
    expect(
      db.select().from(ownedAircraft).where(eq(ownedAircraft.id, ac.id)).get()!
        .hoursSince100hr,
    ).toBe(95);

    // Advance sim time past scheduledCompletionAt.
    setSimNow(booked.scheduledCompletionAt + 1);
    const result = processMaintenanceCompletions();
    expect(result.resolved).toBe(1);

    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.status).toBe("available");
    expect(acAfter.hoursSince100hr).toBe(0);

    const ev = db
      .select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.id, booked.eventId))
      .get()!;
    expect(ev.status).toBe("completed");
    expect(ev.completedAt).toBe(getCareer().simDateTime);
  });

  it("annual completion: resets hoursSinceAnnual and pushes annualDueAt 365 days out", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: MAINTENANCE_AIRPORT,
      hoursSinceAnnual: 350,
    });
    const booked = bookMaintenance({ ownedAircraftId: ac.id, type: "annual" });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;

    setSimNow(booked.scheduledCompletionAt + 1);
    processMaintenanceCompletions();

    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.hoursSinceAnnual).toBe(0);
    expect(acAfter.annualDueAt).toBe(getCareer().simDateTime + 365 * SIM_DAY_MS);
  });

  it("does nothing when no events are due", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    bookMaintenance({ ownedAircraftId: ac.id, type: "100hr" });
    // Sim time has not advanced — completion is in the future.
    const result = processMaintenanceCompletions();
    expect(result.resolved).toBe(0);
  });
});

describe("processMonthlyOwnership", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("debits hangarage + insurance once when nextMonthlyCostAt has passed", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    // Default insertOwnedAircraft sets nextMonthlyCostAt to null in the
    // schema default (LATER); the purchase service sets it. For an inserted
    // aircraft we need to set it manually.
    const now = getCareer().simDateTime;
    db.update(ownedAircraft)
      .set({ nextMonthlyCostAt: now - 1 }) // due
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const beforeCash = getCareer().cash;
    const result = processMonthlyOwnership();
    expect(result.applied).toBe(1);
    expect(result.totalDeductedCents).toBeGreaterThan(0);
    expect(getCareer().cash).toBe(beforeCash - result.totalDeductedCents);

    const acRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    // Next due bumped 30 days into the future.
    expect(acRow.nextMonthlyCostAt).toBe(now - 1 + 30 * SIM_DAY_MS);
  });

  it("does not debit aircraft whose nextMonthlyCostAt is in the future", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const now = getCareer().simDateTime;
    db.update(ownedAircraft)
      .set({ nextMonthlyCostAt: now + 30 * SIM_DAY_MS })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const beforeCash = getCareer().cash;
    const result = processMonthlyOwnership();
    expect(result.applied).toBe(0);
    expect(getCareer().cash).toBe(beforeCash);
  });

  it("walks the aircraft forward by multiple months when sim time has jumped far", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const now = getCareer().simDateTime;
    // Due 3 months ago. The loop debits while next_due ≤ simNow, advancing
    // 30 days per step — that's 4 debits before next_due jumps past simNow.
    db.update(ownedAircraft)
      .set({ nextMonthlyCostAt: now - 3 * 30 * SIM_DAY_MS })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const result = processMonthlyOwnership();
    expect(result.applied).toBe(4);
  });
});
