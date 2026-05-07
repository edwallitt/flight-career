import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  aircraftListings,
  career,
  loans,
  ownedAircraft,
} from "../../db/schema.js";
import {
  getCareer,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  refreshMarketplace,
  rngFromSeed,
} from "../marketplace.js";
import {
  executePurchase,
  previewPurchase,
  processLoanPayments,
} from "../purchase.js";
import { acceptJob } from "../jobLifecycle.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seed the marketplace deterministically so tests can pick a listing without
 * coupling to live RNG output. Returns the cheapest available listing.
 */
function seedAndPickCheapest(): typeof aircraftListings.$inferSelect {
  refreshMarketplace(24, rngFromSeed(42));
  const rows = db
    .select()
    .from(aircraftListings)
    .where(eq(aircraftListings.status, "available"))
    .all();
  expect(rows.length).toBeGreaterThan(0);
  return rows.sort((a, b) => a.askingPriceCents - b.askingPriceCents)[0]!;
}

describe("refreshMarketplace", () => {
  beforeEach(() => resetTestDb());

  it("seeds up to the target size on an empty marketplace", () => {
    const result = refreshMarketplace(24, rngFromSeed(1));
    expect(result.added).toBeGreaterThan(0);
    expect(result.added).toBeLessThanOrEqual(24);
    expect(result.expired).toBe(0);
  });

  it("does not add listings when already at or above target", () => {
    refreshMarketplace(24, rngFromSeed(1));
    const second = refreshMarketplace(24, rngFromSeed(2));
    expect(second.added).toBe(0);
  });

  it("expires listings whose expiresAt is now in the past", () => {
    refreshMarketplace(24, rngFromSeed(1));
    const now = getCareer().simDateTime;
    // Force-expire all current listings by jumping sim time forward.
    db.update(career)
      .set({ simDateTime: now + 365 * SIM_DAY_MS })
      .where(eq(career.id, 1))
      .run();
    const result = refreshMarketplace(24, rngFromSeed(3));
    expect(result.expired).toBeGreaterThan(0);
  });
});

describe("previewPurchase", () => {
  beforeEach(() => resetTestDb({ cash: 5_000_000_00 })); // $5M

  it("returns cashAfterCents and the financing slate for an available listing", () => {
    const listing = seedAndPickCheapest();
    const result = previewPurchase({ listingId: listing.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.listing.id).toBe(listing.id);
    expect(result.preview.cash.totalCents).toBe(listing.askingPriceCents);
    expect(result.preview.cash.affordable).toBe(true);
    expect(result.preview.cash.cashAfterCents).toBe(
      5_000_000_00 - listing.askingPriceCents,
    );
    expect(result.preview.loans.length).toBeGreaterThan(0);
    for (const loan of result.preview.loans) {
      expect(loan.affordable).toBe(true); // $5M down covers any reasonable down payment
    }
  });

  it("flags cash.affordable=false when player can't cover the asking price", () => {
    resetTestDb({ cash: 100_00 }); // $100
    const listing = seedAndPickCheapest();
    const result = previewPurchase({ listingId: listing.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.cash.affordable).toBe(false);
  });

  it("rejects unknown listing ids", () => {
    const result = previewPurchase({ listingId: 99999 });
    expect(result).toEqual({ ok: false, error: "Listing not found" });
  });

  it("rejects expired listings", () => {
    const listing = seedAndPickCheapest();
    db.update(aircraftListings)
      .set({ status: "expired" })
      .where(eq(aircraftListings.id, listing.id))
      .run();
    const result = previewPurchase({ listingId: listing.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not available/);
  });
});

describe("executePurchase", () => {
  beforeEach(() => resetTestDb({ cash: 5_000_000_00 }));

  it("cash purchase: debits cash, creates owned aircraft, marks listing sold, no loan", () => {
    const listing = seedAndPickCheapest();
    const beforeCash = getCareer().cash;

    const result = executePurchase({
      listingId: listing.id,
      paymentMethod: "cash",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loanId).toBeNull();

    const afterCash = getCareer().cash;
    expect(afterCash).toBe(beforeCash - listing.askingPriceCents);

    const listingRow = db
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.id, listing.id))
      .get()!;
    expect(listingRow.status).toBe("sold");

    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, result.ownedAircraftId))
      .get()!;
    expect(ownedRow.tailNumber).toBe(listing.tailNumber);
    expect(ownedRow.aircraftTypeId).toBe(listing.aircraftTypeId);
    expect(ownedRow.currentLocationIcao).toBe(listing.locationIcao);
    expect(ownedRow.purchasePrice).toBe(listing.askingPriceCents);
    expect(ownedRow.status).toBe("available");
    expect(ownedRow.loanId).toBeNull();
    expect(ownedRow.fuelOnBoardGal).toBe(0); // listings convey dry, the player tops up
  });

  it("loan purchase: debits down payment only, creates loan row, links it to the aircraft", () => {
    const listing = seedAndPickCheapest();
    const preview = previewPurchase({ listingId: listing.id });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const term = preview.preview.loans[0]!.termMonths;
    const downPayment = preview.preview.loans[0]!.downPaymentCents;
    const principal = preview.preview.loans[0]!.principalCents;

    const beforeCash = getCareer().cash;
    const result = executePurchase({
      listingId: listing.id,
      paymentMethod: "loan",
      loanTermMonths: term,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loanId).not.toBeNull();

    const afterCash = getCareer().cash;
    expect(afterCash).toBe(beforeCash - downPayment);

    const loanRow = db
      .select()
      .from(loans)
      .where(eq(loans.id, result.loanId!))
      .get()!;
    expect(loanRow.principal).toBe(principal);
    expect(loanRow.remainingBalance).toBe(principal);
    expect(loanRow.termMonths).toBe(term);
    expect(loanRow.originalTermMonths).toBe(term);
    expect(loanRow.paymentsMade).toBe(0);
    expect(loanRow.ownedAircraftId).toBe(result.ownedAircraftId);

    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, result.ownedAircraftId))
      .get()!;
    expect(ownedRow.loanId).toBe(result.loanId);
  });

  it("loan purchase rejects an unsupported term", () => {
    const listing = seedAndPickCheapest();
    const result = executePurchase({
      listingId: listing.id,
      paymentMethod: "loan",
      loanTermMonths: 1, // not in the offered slate
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/term not offered/i);
  });

  it("rejects when cash is insufficient for a cash purchase", () => {
    resetTestDb({ cash: 100_00 });
    const listing = seedAndPickCheapest();
    const result = executePurchase({
      listingId: listing.id,
      paymentMethod: "cash",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Insufficient cash/);
  });

  it("rejects re-purchasing a listing that has already been sold", () => {
    const listing = seedAndPickCheapest();
    const first = executePurchase({
      listingId: listing.id,
      paymentMethod: "cash",
    });
    expect(first.ok).toBe(true);

    const second = executePurchase({
      listingId: listing.id,
      paymentMethod: "cash",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/not available/);
  });

  it("rejects purchase while a job is active", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });

    const listing = seedAndPickCheapest();
    const result = executePurchase({
      listingId: listing.id,
      paymentMethod: "cash",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/job is active/);
  });
});

describe("processLoanPayments", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  /**
   * Insert a freshly-formed loan due *now* against an owned aircraft.
   * Returns the loan id so tests can re-read it after processing.
   */
  function seedDueLoan(over: Partial<{
    principal: number;
    remainingBalance: number;
    monthlyPayment: number;
    interestRateBps: number;
    nextPaymentDue: number;
    termMonths: number;
    paymentsMade: number;
  }> = {}): number {
    const ac = insertOwnedAircraft();
    const now = getCareer().simDateTime;
    const insert = db
      .insert(loans)
      .values({
        ownedAircraftId: ac.id,
        principal: over.principal ?? 100_000_00,
        remainingBalance: over.remainingBalance ?? 100_000_00,
        monthlyPayment: over.monthlyPayment ?? 2_000_00,
        interestRateBps: over.interestRateBps ?? 600, // 6% APR
        nextPaymentDue: over.nextPaymentDue ?? now,
        termMonths: over.termMonths ?? 60,
        originalTermMonths: over.termMonths ?? 60,
        paymentsMade: over.paymentsMade ?? 0,
      })
      .run();
    return Number(insert.lastInsertRowid);
  }

  it("processes a single payment when next_payment_due is now", () => {
    const loanId = seedDueLoan({
      remainingBalance: 100_000_00,
      monthlyPayment: 2_000_00,
      interestRateBps: 600,
    });
    const beforeCash = getCareer().cash;
    const result = processLoanPayments();

    expect(result.paymentsProcessed).toBe(1);
    expect(result.totalDeductedCents).toBe(2_000_00);
    expect(getCareer().cash).toBe(beforeCash - 2_000_00);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.paymentsMade).toBe(1);
    // Interest on $100k at 6% APR = $500/month → principal portion = $1,500.
    expect(loanRow.remainingBalance).toBe(100_000_00 - 1_500_00);
    // next_payment_due bumped 30 days forward.
    expect(loanRow.nextPaymentDue).toBe(getCareer().simDateTime + 30 * SIM_DAY_MS);
  });

  it("skips loans whose next_payment_due is still in the future", () => {
    const now = getCareer().simDateTime;
    const loanId = seedDueLoan({ nextPaymentDue: now + 5 * SIM_DAY_MS });
    const beforeCash = getCareer().cash;

    const result = processLoanPayments();
    expect(result.paymentsProcessed).toBe(0);
    expect(getCareer().cash).toBe(beforeCash);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.paymentsMade).toBe(0);
  });

  it("walks a multi-month catch-up: 90 days overdue → 4 monthly debits", () => {
    // Same N+1 walker behavior as monthly ownership: due_at ≤ simNow loops
    // until due_at > simNow, advancing 30 days per step.
    const now = getCareer().simDateTime;
    const loanId = seedDueLoan({ nextPaymentDue: now - 3 * 30 * SIM_DAY_MS });
    const result = processLoanPayments();

    expect(result.paymentsProcessed).toBe(4);
    expect(result.totalDeductedCents).toBe(4 * 2_000_00);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.paymentsMade).toBe(4);
    expect(loanRow.nextPaymentDue).toBeGreaterThan(now);
  });

  it("final payment: principal portion clamps to remaining balance + interest", () => {
    // remainingBalance = $1,000; interest at 6% APR = $5; monthly payment $2,000
    // → principal portion would be $1,995 but is capped at $1,000.
    // → actual payment = $1,000 + $5 = $1,005, balance → 0.
    const loanId = seedDueLoan({
      remainingBalance: 1_000_00,
      monthlyPayment: 2_000_00,
      interestRateBps: 600,
    });
    const beforeCash = getCareer().cash;

    const result = processLoanPayments();
    expect(result.paymentsProcessed).toBe(1);
    // 1000 * (600/10000/12) = 5.0 → rounds to 500 cents.
    expect(result.totalDeductedCents).toBe(1_000_00 + 500);
    expect(getCareer().cash).toBe(beforeCash - (1_000_00 + 500));

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.remainingBalance).toBe(0);

    // Paid loans drop out of subsequent runs.
    const second = processLoanPayments();
    expect(second.paymentsProcessed).toBe(0);
  });

  it("interest-only edge: when monthly payment ≤ accrued interest, principal stays put", () => {
    // remainingBalance = $100k, interest at 6% APR = $500/month.
    // monthlyPayment = $400 → principalPortion = max(0, 400 - 500) = 0.
    const loanId = seedDueLoan({
      remainingBalance: 100_000_00,
      monthlyPayment: 400_00,
      interestRateBps: 600,
    });

    const beforeBalance = 100_000_00;
    const result = processLoanPayments();
    expect(result.paymentsProcessed).toBe(1);
    expect(result.totalDeductedCents).toBe(400_00);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.remainingBalance).toBe(beforeBalance); // unchanged
    expect(loanRow.paymentsMade).toBe(1);
  });

  it("ignores loans that are already fully paid (remainingBalance = 0)", () => {
    const now = getCareer().simDateTime;
    const loanId = seedDueLoan({
      remainingBalance: 0,
      nextPaymentDue: now - SIM_DAY_MS,
      paymentsMade: 60,
    });

    const beforeCash = getCareer().cash;
    const result = processLoanPayments();
    expect(result.paymentsProcessed).toBe(0);
    expect(getCareer().cash).toBe(beforeCash);

    const loanRow = db.select().from(loans).where(eq(loans.id, loanId)).get()!;
    expect(loanRow.paymentsMade).toBe(60);
  });

  it("returns zero when there are no loans at all", () => {
    expect(processLoanPayments()).toEqual({
      paymentsProcessed: 0,
      totalDeductedCents: 0,
    });
  });

  it("processes multiple loans independently in a single call", () => {
    const a = seedDueLoan({ monthlyPayment: 1_500_00 });
    const b = seedDueLoan({ monthlyPayment: 2_500_00 });

    const result = processLoanPayments();
    expect(result.paymentsProcessed).toBe(2);
    expect(result.totalDeductedCents).toBe(1_500_00 + 2_500_00);

    const aRow = db.select().from(loans).where(eq(loans.id, a)).get()!;
    const bRow = db.select().from(loans).where(eq(loans.id, b)).get()!;
    expect(aRow.paymentsMade).toBe(1);
    expect(bRow.paymentsMade).toBe(1);
  });
});
