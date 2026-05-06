import {
  calculateFinancingOptions,
  type LoanTerms,
} from "@flightcareer/shared";
import { eq, lte, gt } from "drizzle-orm";
import { and } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftListings,
  aircraftTypes,
  airports,
  career,
  loans,
  ownedAircraft,
} from "../db/schema.js";
import {
  getListingById,
  type EnrichedListing,
} from "./marketplace.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

export interface PurchaseLoanOption extends LoanTerms {
  affordable: boolean;
}

export interface PurchasePreview {
  listing: EnrichedListing;
  cash: { totalCents: number; affordable: boolean; cashAfterCents: number };
  loans: PurchaseLoanOption[];
}

export type PreviewResult =
  | { ok: true; preview: PurchasePreview }
  | { ok: false; error: string };

function getCareerOrError(): typeof career.$inferSelect | null {
  return db.select().from(career).where(eq(career.id, 1)).get() ?? null;
}

export function previewPurchase(input: { listingId: number }): PreviewResult {
  const careerRow = getCareerOrError();
  if (!careerRow) return { ok: false, error: "Career not found" };

  const listing = getListingById(input.listingId, careerRow.currentLocationIcao);
  if (!listing) return { ok: false, error: "Listing not found" };

  const rawListing = db
    .select()
    .from(aircraftListings)
    .where(eq(aircraftListings.id, input.listingId))
    .get();
  if (!rawListing) return { ok: false, error: "Listing not found" };
  if (rawListing.status !== "available") {
    return { ok: false, error: `Listing not available (${rawListing.status})` };
  }
  if (rawListing.expiresAt < careerRow.simDateTime) {
    return { ok: false, error: "Listing has expired" };
  }

  const options = calculateFinancingOptions(listing.askingPriceCents);
  const cashAffordable = careerRow.cash >= listing.askingPriceCents;
  const loans: PurchaseLoanOption[] = options.loans.map((l) => ({
    ...l,
    affordable: careerRow.cash >= l.downPaymentCents,
  }));

  return {
    ok: true,
    preview: {
      listing,
      cash: {
        totalCents: listing.askingPriceCents,
        affordable: cashAffordable,
        cashAfterCents: careerRow.cash - listing.askingPriceCents,
      },
      loans,
    },
  };
}

export interface ExecutePurchaseInput {
  listingId: number;
  paymentMethod: "cash" | "loan";
  loanTermMonths?: number;
}

export type ExecuteResult =
  | { ok: true; ownedAircraftId: number; tailNumber: string; loanId: number | null }
  | { ok: false; error: string };

export function executePurchase(input: ExecutePurchaseInput): ExecuteResult {
  return db.transaction((tx): ExecuteResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeJobId != null) {
      return { ok: false, error: "Cannot purchase while a job is active" };
    }

    const listingRow = tx
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.id, input.listingId))
      .get();
    if (!listingRow) return { ok: false, error: "Listing not found" };
    if (listingRow.status !== "available") {
      return { ok: false, error: `Listing not available (${listingRow.status})` };
    }
    if (listingRow.expiresAt < careerRow.simDateTime) {
      return { ok: false, error: "Listing has expired" };
    }

    const typeRow = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, listingRow.aircraftTypeId))
      .get();
    if (!typeRow) return { ok: false, error: "Aircraft type not found" };

    const apRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, listingRow.locationIcao))
      .get();
    if (!apRow) return { ok: false, error: "Listing airport not found" };

    const askingPriceCents = listingRow.askingPriceCents;
    const options = calculateFinancingOptions(askingPriceCents);

    let loanTermsToWrite: LoanTerms | null = null;
    let cashOutlay = askingPriceCents;
    if (input.paymentMethod === "loan") {
      if (input.loanTermMonths == null) {
        return { ok: false, error: "Missing loanTermMonths" };
      }
      const match = options.loans.find(
        (l) => l.termMonths === input.loanTermMonths,
      );
      if (!match) {
        return { ok: false, error: "Loan term not offered for this listing" };
      }
      if (careerRow.cash < match.downPaymentCents) {
        return { ok: false, error: "Insufficient cash for down payment" };
      }
      loanTermsToWrite = match;
      cashOutlay = match.downPaymentCents;
    } else {
      if (careerRow.cash < askingPriceCents) {
        return { ok: false, error: "Insufficient cash for purchase" };
      }
    }

    // Create the owned aircraft. annual_due_at is a sim-time deadline. We
    // treat hoursSinceAnnual as days since the last annual (1:1 with our
    // listing semantics) and project forward 365 days from there.
    const daysSinceAnnual = Math.max(0, listingRow.hoursSinceAnnual);
    const annualDueAt = Math.round(
      careerRow.simDateTime + (365 - daysSinceAnnual) * SIM_DAY_MS,
    );

    const ownedInsert = tx
      .insert(ownedAircraft)
      .values({
        tailNumber: listingRow.tailNumber,
        aircraftTypeId: listingRow.aircraftTypeId,
        currentLocationIcao: listingRow.locationIcao,
        airframeHours: listingRow.airframeHours,
        engineHoursSinceOverhaul: listingRow.engineHoursSinceOverhaul,
        hoursSince100hr: listingRow.hoursSince100hr,
        hoursSinceAnnual: listingRow.hoursSinceAnnual,
        annualDueAt,
        fuelOnBoardGal: 0,
        status: "available" as const,
        purchasedAt: careerRow.simDateTime,
        purchasePrice: askingPriceCents,
        loanId: null,
        nextMonthlyCostAt: careerRow.simDateTime + 30 * SIM_DAY_MS,
      })
      .run();

    const ownedAircraftId = Number(ownedInsert.lastInsertRowid);
    if (!ownedAircraftId) {
      return { ok: false, error: "Failed to create aircraft record" };
    }

    let loanId: number | null = null;
    if (loanTermsToWrite) {
      const loanInsert = tx
        .insert(loans)
        .values({
          ownedAircraftId,
          principal: loanTermsToWrite.principalCents,
          remainingBalance: loanTermsToWrite.principalCents,
          monthlyPayment: loanTermsToWrite.monthlyPaymentCents,
          interestRateBps: loanTermsToWrite.interestRateBps,
          nextPaymentDue: careerRow.simDateTime + 30 * SIM_DAY_MS,
          termMonths: loanTermsToWrite.termMonths,
          originalTermMonths: loanTermsToWrite.termMonths,
          paymentsMade: 0,
        })
        .run();
      loanId = Number(loanInsert.lastInsertRowid);
      tx.update(ownedAircraft)
        .set({ loanId })
        .where(eq(ownedAircraft.id, ownedAircraftId))
        .run();
    }

    tx.update(career)
      .set({ cash: careerRow.cash - cashOutlay })
      .where(eq(career.id, 1))
      .run();

    tx.update(aircraftListings)
      .set({ status: "sold" })
      .where(eq(aircraftListings.id, input.listingId))
      .run();

    return {
      ok: true,
      ownedAircraftId,
      tailNumber: listingRow.tailNumber,
      loanId,
    };
  });
}

export interface LoanPaymentResult {
  paymentsProcessed: number;
  totalDeductedCents: number;
}

// Hard ceiling on payments processed per loan per call, defending against a
// runaway loop if data is malformed. 600 months = 50 years, well above any
// realistic loan term.
const MAX_PAYMENTS_PER_CALL = 600;

export function processLoanPayments(): LoanPaymentResult {
  const careerRow = getCareerOrError();
  if (!careerRow) return { paymentsProcessed: 0, totalDeductedCents: 0 };
  const simNow = careerRow.simDateTime;

  const due = db
    .select()
    .from(loans)
    .where(
      and(
        gt(loans.remainingBalance, 0),
        lte(loans.nextPaymentDue, simNow),
      ),
    )
    .all();
  if (due.length === 0) return { paymentsProcessed: 0, totalDeductedCents: 0 };

  let processed = 0;
  let totalDeducted = 0;

  // For each due loan, keep applying monthly payments until next_payment_due
  // is in the future (or the balance is fully paid). Each individual payment
  // is its own transaction — the read-modify-write of {loan, career} is
  // atomic, and a long sim-time advance (e.g. a 90-day transfer that
  // triggers 3 payments) walks the loan forward one month at a time.
  for (const loan of due) {
    let guard = MAX_PAYMENTS_PER_CALL;
    while (guard-- > 0) {
      const result = db.transaction((tx): { paid: number } | null => {
        const fresh = tx
          .select()
          .from(loans)
          .where(eq(loans.id, loan.id))
          .get();
        if (!fresh || fresh.remainingBalance <= 0) return null;
        if (fresh.nextPaymentDue > simNow) return null;

        const monthlyRate = fresh.interestRateBps / 10_000 / 12;
        const interest = Math.round(fresh.remainingBalance * monthlyRate);
        let principalPortion = fresh.monthlyPayment - interest;
        if (principalPortion < 0) principalPortion = 0;
        let actualPayment = fresh.monthlyPayment;

        if (principalPortion >= fresh.remainingBalance) {
          // Final payment: just the remaining balance + this month's interest.
          principalPortion = fresh.remainingBalance;
          actualPayment = fresh.remainingBalance + interest;
        }

        const newBalance = Math.max(
          0,
          fresh.remainingBalance - principalPortion,
        );

        tx.update(loans)
          .set({
            remainingBalance: newBalance,
            paymentsMade: fresh.paymentsMade + 1,
            nextPaymentDue: fresh.nextPaymentDue + 30 * SIM_DAY_MS,
          })
          .where(eq(loans.id, fresh.id))
          .run();

        const careerNow = tx
          .select()
          .from(career)
          .where(eq(career.id, 1))
          .get();
        if (careerNow) {
          tx.update(career)
            .set({ cash: careerNow.cash - actualPayment })
            .where(eq(career.id, 1))
            .run();
        }

        return { paid: actualPayment };
      });
      if (result == null) break;
      processed += 1;
      totalDeducted += result.paid;
    }
  }

  return { paymentsProcessed: processed, totalDeductedCents: totalDeducted };
}
