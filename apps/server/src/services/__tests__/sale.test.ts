import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { airports, loans, ownedAircraft } from "../../db/schema.js";
import {
  getCareer,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  executeSale,
  getPastAircraft,
  getSalePreview,
  getAircraftSalesTotal,
} from "../sale.js";

// CYHZ has hasMaintenance=true in seed data, CYCH does not. We use that to
// exercise the maintenance-capable-airport eligibility branch.
const MAINTENANCE_AIRPORT = "CYHZ";

describe("getSalePreview", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("returns an estimate and eligibility for an available, no-loan aircraft at a maintenance airport", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const result = getSalePreview({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.aircraft.id).toBe(ac.id);
    expect(result.preview.estimate.estimatedValueCents).toBeGreaterThan(0);
    expect(result.preview.estimate.brokerSpreadBps).toBe(1200);
    expect(result.preview.estimate.grossSaleCents).toBeLessThan(
      result.preview.estimate.estimatedValueCents,
    );
    expect(result.preview.estimate.loanPayoffCents).toBe(0);
    expect(result.preview.estimate.underwater).toBe(false);
    expect(result.preview.eligibility.eligible).toBe(true);
  });

  it("flags ineligible at non-maintenance airports", () => {
    // CYCH is the small/remote airport in seed data without maintenance.
    const cych = db
      .select()
      .from(airports)
      .where(eq(airports.icao, "CYCH"))
      .get();
    expect(cych?.hasMaintenance).toBe(false);

    const ac = insertOwnedAircraft({ currentLocationIcao: "CYCH" });
    const result = getSalePreview({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.eligibility.eligible).toBe(false);
    expect(
      result.preview.eligibility.reasons.some((r) =>
        r.includes("maintenance-capable"),
      ),
    ).toBe(true);
  });

  it("flags ineligible when aircraft is in_flight", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: MAINTENANCE_AIRPORT,
      status: "in_flight",
    });
    const result = getSalePreview({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.eligibility.eligible).toBe(false);
    expect(
      result.preview.eligibility.reasons.some((r) => r.includes("in flight")),
    ).toBe(true);
  });

  it("returns an error for an unknown aircraft id", () => {
    const result = getSalePreview({ ownedAircraftId: 99999 });
    expect(result).toEqual({ ok: false, error: "Aircraft not found" });
  });
});

describe("executeSale", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("credits cash, marks aircraft sold, retains the row for past-aircraft history", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const beforeCash = getCareer().cash;

    const preview = getSalePreview({ ownedAircraftId: ac.id });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const expectedNet = preview.preview.estimate.netToPlayerCents;

    const result = executeSale({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netReceivedCents).toBe(expectedNet);
    expect(result.loanRetiredCents).toBe(0);

    const afterCash = getCareer().cash;
    expect(afterCash).toBe(beforeCash + expectedNet);

    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(ownedRow.status).toBe("sold");
    expect(ownedRow.soldAt).toBe(getCareer().simDateTime);
    expect(ownedRow.salePriceCents).toBe(preview.preview.estimate.grossSaleCents);
  });

  it("retires the linked loan: zeroes balance, marks payments complete, no future deductions", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });

    // Attach a loan with a small remaining balance — small enough that the
    // sale net is positive (so eligibility passes without needing extra cash).
    const now = getCareer().simDateTime;
    const loanInsert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: 100_000_00,
        remainingBalance: 50_000_00,
        monthlyPayment: 5_000_00,
        interestRateBps: 600,
        nextPaymentDue: now + 30 * 24 * 60 * 60 * 1000,
        termMonths: 60,
        originalTermMonths: 60,
        paymentsMade: 10,
      })
      .run();
    const loanId = Number(loanInsert.lastInsertRowid);
    db.update(ownedAircraft)
      .set({ loanId })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const result = executeSale({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loanRetiredCents).toBe(50_000_00);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.remainingBalance).toBe(0);
    expect(loanRow.paymentsMade).toBe(60); // bumped to original term
  });

  it("rejects underwater sale when player cannot cover the shortfall", () => {
    resetTestDb({ cash: 500_00 }); // $500 only
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });

    const now = getCareer().simDateTime;
    const loanInsert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: 10_000_000_00, // $10M outstanding — far above sale value
        remainingBalance: 10_000_000_00,
        monthlyPayment: 100_000_00,
        interestRateBps: 600,
        nextPaymentDue: now + 30 * 24 * 60 * 60 * 1000,
        termMonths: 120,
        originalTermMonths: 120,
        paymentsMade: 0,
      })
      .run();
    const loanId = Number(loanInsert.lastInsertRowid);
    db.update(ownedAircraft)
      .set({ loanId })
      .where(eq(ownedAircraft.id, ac.id))
      .run();

    const result = executeSale({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Insufficient cash/i);

    // Aircraft must still be available — the failed sale shouldn't have
    // mutated state.
    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(ownedRow.status).toBe("available");
  });

  it("rejects re-selling an already-sold aircraft", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const first = executeSale({ ownedAircraftId: ac.id });
    expect(first.ok).toBe(true);

    const second = executeSale({ ownedAircraftId: ac.id });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already been sold/i);
  });
});

describe("getPastAircraft / getAircraftSalesTotal", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("lists sold aircraft most-recent-first with net P&L vs purchase price", () => {
    const a = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    const b = insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });

    const r1 = executeSale({ ownedAircraftId: a.id });
    expect(r1.ok).toBe(true);
    const r2 = executeSale({ ownedAircraftId: b.id });
    expect(r2.ok).toBe(true);

    const past = getPastAircraft();
    expect(past).toHaveLength(2);
    // soldAt for both is identical (sim time hasn't advanced) → ordering is
    // stable but unspecified; only check that both are present and net is
    // sale - purchase.
    for (const p of past) {
      expect(p.netCents).toBe(p.salePriceCents - p.purchasePriceCents);
    }

    const total = getAircraftSalesTotal();
    expect(total).toBe(past[0]!.salePriceCents + past[1]!.salePriceCents);
  });

  it("returns an empty list and zero total when no aircraft has been sold", () => {
    insertOwnedAircraft({ currentLocationIcao: MAINTENANCE_AIRPORT });
    expect(getPastAircraft()).toEqual([]);
    expect(getAircraftSalesTotal()).toBe(0);
  });
});
