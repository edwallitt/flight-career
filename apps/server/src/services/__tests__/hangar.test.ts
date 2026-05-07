import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  airports,
  loans,
  maintenanceEvents,
  ownedAircraft,
} from "../../db/schema.js";
import {
  getCareer,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  getOwnedAircraft,
  getOwnedAircraftById,
  refuelOwnedAircraft,
} from "../hangar.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

describe("getOwnedAircraft", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("returns an empty list when nothing is owned", () => {
    expect(getOwnedAircraft()).toEqual([]);
  });

  it("returns each non-sold aircraft sorted newest-purchase-first, with type + airport joined", () => {
    const a = insertOwnedAircraft({ tailNumber: "C-FONE" });
    const b = insertOwnedAircraft({ tailNumber: "C-FTWO" });
    db.update(ownedAircraft)
      .set({ purchasedAt: a.purchasedAt - 1000 })
      .where(eq(ownedAircraft.id, a.id))
      .run();

    const list = getOwnedAircraft();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(b.id); // newer purchase first
    expect(list[1]!.id).toBe(a.id);

    const detail = list[0]!;
    expect(detail.manufacturer).toBeTruthy();
    expect(detail.locationName).toBeTruthy();
    expect(detail.cruiseSpeedKts).toBeGreaterThan(0);
    expect(detail.fuelCapacityGal).toBeGreaterThan(0);
  });

  it("excludes sold aircraft from the list", () => {
    const sold = insertOwnedAircraft();
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, sold.id))
      .run();

    expect(getOwnedAircraft()).toEqual([]);
  });

  it("computes engine/100hr/annual remaining figures", () => {
    const ac = insertOwnedAircraft({
      hoursSince100hr: 30,
      hoursSinceAnnual: 100,
    });
    const detail = getOwnedAircraftById(ac.id)!;
    expect(detail.hundredHourRemainingHours).toBe(70);
    expect(detail.engineRemainingHours).toBe(detail.tboHours - 200);
    // annualDueAt is +180 days in the fixture.
    expect(detail.annualDaysRemaining).toBeGreaterThan(170);
    expect(detail.annualDaysRemaining).toBeLessThanOrEqual(181);
  });

  it("attaches loan info, exposes LTV ratio, includes loan payment in monthly fixed costs", () => {
    const ac = insertOwnedAircraft();
    const now = getCareer().simDateTime;
    const loanInsert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: 200_000_00,
        remainingBalance: 100_000_00,
        monthlyPayment: 3_000_00,
        interestRateBps: 600,
        nextPaymentDue: now + 30 * SIM_DAY_MS,
        termMonths: 60,
        originalTermMonths: 60,
        paymentsMade: 24,
      })
      .run();
    db.update(ownedAircraft)
      .set({ loanId: Number(loanInsert.lastInsertRowid) })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const detail = getOwnedAircraftById(ac.id)!;
    expect(detail.loan).not.toBeNull();
    expect(detail.loan!.remainingBalanceCents).toBe(100_000_00);
    expect(detail.loan!.fullyPaid).toBe(false);
    expect(detail.loanLtvRatio).toBeGreaterThan(0);
    expect(detail.monthlyFixedCostsCents).toBe(
      detail.hangarageMonthlyCents +
        detail.insuranceMonthlyCents +
        3_000_00,
    );
  });

  it("marks loans with zero balance and full payments as fullyPaid (no monthly cost contribution)", () => {
    const ac = insertOwnedAircraft();
    const now = getCareer().simDateTime;
    const loanInsert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: 100_000_00,
        remainingBalance: 0,
        monthlyPayment: 2_000_00,
        interestRateBps: 600,
        nextPaymentDue: now + 30 * SIM_DAY_MS,
        termMonths: 60,
        originalTermMonths: 60,
        paymentsMade: 60,
      })
      .run();
    db.update(ownedAircraft)
      .set({ loanId: Number(loanInsert.lastInsertRowid) })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const detail = getOwnedAircraftById(ac.id)!;
    expect(detail.loan!.fullyPaid).toBe(true);
    expect(detail.loan!.paidOffAt).not.toBeNull();
    expect(detail.monthlyFixedCostsCents).toBe(
      detail.hangarageMonthlyCents + detail.insuranceMonthlyCents,
    );
  });

  it("surfaces an in-progress maintenance summary when present", () => {
    const ac = insertOwnedAircraft();
    const now = getCareer().simDateTime;
    db.insert(maintenanceEvents)
      .values({
        ownedAircraftId: ac.id,
        type: "100hr",
        cost: 5_000_00,
        startedAt: now,
        scheduledCompletionAt: now + SIM_DAY_MS,
        completedAt: null,
        description: "100hr at CYHZ",
        status: "in_progress",
      })
      .run();

    const detail = getOwnedAircraftById(ac.id)!;
    expect(detail.inProgressMaintenance).not.toBeNull();
    expect(detail.inProgressMaintenance!.type).toBe("100hr");
    expect(detail.inProgressMaintenance!.label).toBe("100-Hour Inspection");
    expect(detail.inProgressMaintenance!.cost).toBe(5_000_00);
  });

  it("getOwnedAircraftById returns null for unknown or sold aircraft", () => {
    expect(getOwnedAircraftById(99999)).toBeNull();

    const sold = insertOwnedAircraft();
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, sold.id))
      .run();
    expect(getOwnedAircraftById(sold.id)).toBeNull();
  });
});

describe("refuelOwnedAircraft", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("tops up to capacity, debits cash by gallons × airport price", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      fuelOnBoardGal: 10,
    });
    const before = getCareer().cash;

    const result = refuelOwnedAircraft(ac.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fuelAddedGal).toBeGreaterThan(0);
    expect(result.costCents).toBe(
      Math.round(result.fuelAddedGal *
        (refuelTargetPriceFor("avgas", "CYHZ"))),
    );

    const after = getCareer();
    expect(after.cash).toBe(before - result.costCents);
    expect(after.cash).toBe(result.cashAfterCents);

    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.fuelOnBoardGal).toBe(result.fuelOnBoardGal);
    expect(acAfter.fuelOnBoardGal).toBeGreaterThan(10);
  });

  it("rejects when the airport doesn't sell the right fuel", () => {
    // Catalog tables are seeded once per worker — mutate + restore CYHZ's
    // hasAvgas so this test is hermetic for the rest of the file.
    db.update(airports)
      .set({ hasAvgas: false })
      .where(eq(airports.icao, "CYHZ"))
      .run();
    try {
      const ac = insertOwnedAircraft({
        currentLocationIcao: "CYHZ",
        fuelOnBoardGal: 10,
      });
      const result = refuelOwnedAircraft(ac.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/does not sell/i);
    } finally {
      db.update(airports)
        .set({ hasAvgas: true })
        .where(eq(airports.icao, "CYHZ"))
        .run();
    }
  });

  it("rejects when tanks are already full", () => {
    // Fully fuel the aircraft.
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const detail = getOwnedAircraftById(ac.id)!;
    db.update(ownedAircraft)
      .set({ fuelOnBoardGal: detail.fuelCapacityGal })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const result = refuelOwnedAircraft(ac.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already full/i);
  });

  it("rejects when the aircraft is not available (e.g. in flight)", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      status: "in_flight",
    });
    const result = refuelOwnedAircraft(ac.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not available/);
  });

  it("rejects when cash is below the fuel cost", () => {
    resetTestDb({ cash: 1_00 }); // $1
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      fuelOnBoardGal: 0,
    });
    const result = refuelOwnedAircraft(ac.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Insufficient cash/i);

    // Aircraft should NOT have been mutated.
    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.fuelOnBoardGal).toBe(0);
  });
});

// Helper: read airport multiplier and compute the static formula price per
// gallon. Mirrors hangar.ts's lookup so the test can verify the math without
// reimplementing the live-drift fallback logic.
function refuelTargetPriceFor(
  fuelType: "avgas" | "jet-a",
  icao: string,
): number {
  const ap = db.select().from(airports).where(eq(airports.icao, icao)).get()!;
  const base = fuelType === "avgas" ? 700 : 550;
  return Math.round(base * ap.baseFuelMultiplier);
}
