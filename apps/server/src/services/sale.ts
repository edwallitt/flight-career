import {
  checkSaleEligibility,
  estimateSale,
  type SaleEligibility,
  type SaleEstimate,
} from "@flightcareer/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  insurancePolicies,
  loans,
  ownedAircraft,
} from "../db/schema.js";
import {
  daysSinceAnnualForPricing,
  getOwnedAircraftById,
  type OwnedAircraftDetail,
} from "./hangar.js";

export interface SalePreview {
  aircraft: OwnedAircraftDetail;
  estimate: SaleEstimate;
  eligibility: SaleEligibility;
}

export type SalePreviewResult =
  | { ok: true; preview: SalePreview }
  | { ok: false; error: string };

function loadAirportFor(icao: string): typeof airports.$inferSelect | null {
  return db.select().from(airports).where(eq(airports.icao, icao)).get() ?? null;
}

export function getSalePreview(input: {
  ownedAircraftId: number;
}): SalePreviewResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { ok: false, error: "Career not found" };

  const aircraft = getOwnedAircraftById(input.ownedAircraftId);
  if (!aircraft) return { ok: false, error: "Aircraft not found" };

  const typeRow = db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, aircraft.aircraftTypeId))
    .get();
  if (!typeRow) return { ok: false, error: "Aircraft type not found" };

  const airport = loadAirportFor(aircraft.currentLocationIcao);
  if (!airport) return { ok: false, error: "Aircraft location not found" };

  // Use the loan from the OwnedAircraftDetail — it already filters fully-paid
  // loans (remainingBalance=0) for sale-payoff purposes.
  const loanForSale =
    aircraft.loan && aircraft.loan.remainingBalanceCents > 0
      ? { remainingBalanceCents: aircraft.loan.remainingBalanceCents }
      : null;

  const estimate = estimateSale({
    aircraftType: {
      basePurchasePriceCents: typeRow.basePurchasePrice,
      tboHours: typeRow.tboHours,
    },
    aircraft: {
      airframeHours: aircraft.airframeHours,
      engineHoursSinceOverhaul: aircraft.engineHoursSinceOverhaul,
      hoursSince100hr: aircraft.hoursSince100hr,
      hoursSinceAnnual: daysSinceAnnualForPricing(
        aircraft.annualDueAt,
        careerRow.simDateTime,
      ),
    },
    loan: loanForSale,
  });

  const eligibility = checkSaleEligibility(
    {
      aircraft: {
        status: aircraft.status,
        currentLocationIcao: aircraft.currentLocationIcao,
      },
      airport: { icao: airport.icao, hasMaintenance: airport.hasMaintenance },
      loan: loanForSale,
      cash: careerRow.cash,
    },
    estimate,
  );

  return { ok: true, preview: { aircraft, estimate, eligibility } };
}

export interface ExecuteSaleResult {
  ok: true;
  netReceivedCents: number;
  loanRetiredCents: number;
  saleProceedsCents: number;
  estimatedValueCents: number;
  cashAfterCents: number;
}

export type SaleExecuteOutcome = ExecuteSaleResult | { ok: false; error: string };

export function executeSale(input: {
  ownedAircraftId: number;
}): SaleExecuteOutcome {
  return db.transaction((tx): SaleExecuteOutcome => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };

    const owned = tx
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, input.ownedAircraftId))
      .get();
    if (!owned) return { ok: false, error: "Aircraft not found" };
    if (owned.status === "sold") {
      return { ok: false, error: "Aircraft has already been sold" };
    }

    const typeRow = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, owned.aircraftTypeId))
      .get();
    if (!typeRow) return { ok: false, error: "Aircraft type not found" };

    const airport = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, owned.currentLocationIcao))
      .get();
    if (!airport) return { ok: false, error: "Aircraft location not found" };

    const loanRow =
      tx
        .select()
        .from(loans)
        .where(eq(loans.ownedAircraftId, owned.id))
        .get() ?? null;
    const loanForSale =
      loanRow && loanRow.remainingBalance > 0
        ? { remainingBalanceCents: loanRow.remainingBalance }
        : null;

    const estimate = estimateSale({
      aircraftType: {
        basePurchasePriceCents: typeRow.basePurchasePrice,
        tboHours: typeRow.tboHours,
      },
      aircraft: {
        airframeHours: owned.airframeHours,
        engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
        hoursSince100hr: owned.hoursSince100hr,
        hoursSinceAnnual: daysSinceAnnualForPricing(
          owned.annualDueAt,
          careerRow.simDateTime,
        ),
      },
      loan: loanForSale,
    });

    const eligibility = checkSaleEligibility(
      {
        aircraft: {
          status: owned.status,
          currentLocationIcao: owned.currentLocationIcao,
        },
        airport: {
          icao: airport.icao,
          hasMaintenance: airport.hasMaintenance,
        },
        loan: loanForSale,
        cash: careerRow.cash,
      },
      estimate,
    );

    if (!eligibility.eligible) {
      return {
        ok: false,
        error: eligibility.reasons[0] ?? "Aircraft not eligible for sale",
      };
    }

    const simNow = careerRow.simDateTime;

    // Retire the loan if any balance remains. We zero it out and mark all
    // payments made — the loan row stays for historical accounting but the
    // monthly debit walker won't touch it again (gt 0 filter on remaining).
    if (loanRow && loanRow.remainingBalance > 0) {
      tx.update(loans)
        .set({
          remainingBalance: 0,
          paymentsMade:
            loanRow.originalTermMonths > 0
              ? loanRow.originalTermMonths
              : loanRow.termMonths,
        })
        .where(eq(loans.id, loanRow.id))
        .run();
    }

    // Apply net to cash. Underwater nets are negative — eligibility above
    // ensured the player has the cash to cover it.
    tx.update(career)
      .set({ cash: careerRow.cash + estimate.netToPlayerCents })
      .where(eq(career.id, 1))
      .run();

    // Mark the aircraft sold. We retain the row for historical reporting in
    // the Past Aircraft section and Finances tab.
    tx.update(ownedAircraft)
      .set({
        status: "sold",
        soldAt: simNow,
        salePriceCents: estimate.grossSaleCents,
      })
      .where(eq(ownedAircraft.id, owned.id))
      .run();

    // Cancel any active insurance policy — otherwise processInsurancePremiums
    // (which filters only on status='active') would keep charging premiums in
    // perpetuity against an aircraft the player no longer owns. No refund of
    // the current month, consistent with manual cancellation.
    tx.update(insurancePolicies)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(insurancePolicies.ownedAircraftId, owned.id),
          eq(insurancePolicies.status, "active"),
        ),
      )
      .run();

    return {
      ok: true,
      netReceivedCents: estimate.netToPlayerCents,
      loanRetiredCents: estimate.loanPayoffCents,
      saleProceedsCents: estimate.grossSaleCents,
      estimatedValueCents: estimate.estimatedValueCents,
      cashAfterCents: careerRow.cash + estimate.netToPlayerCents,
    };
  });
}

// =============================================================================
// Past aircraft history
// =============================================================================

export interface PastAircraft {
  id: number;
  tailNumber: string;
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  aircraftClass: "SEP" | "MEP" | "SET" | "JET";
  purchasedAt: number;
  purchasePriceCents: number;
  soldAt: number;
  salePriceCents: number;
  netCents: number; // sale - purchase, ignoring loan interest paid (a rough P&L)
}

export function getPastAircraft(): PastAircraft[] {
  const rows = db
    .select({ owned: ownedAircraft, type: aircraftTypes })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .where(
      and(eq(ownedAircraft.status, "sold"), isNotNull(ownedAircraft.soldAt)),
    )
    .orderBy(desc(ownedAircraft.soldAt))
    .all();

  return rows.map(({ owned, type }) => {
    const sale = owned.salePriceCents ?? 0;
    return {
      id: owned.id,
      tailNumber: owned.tailNumber,
      aircraftTypeId: type.id,
      manufacturer: type.manufacturer,
      model: type.model,
      aircraftClass: type.class,
      purchasedAt: owned.purchasedAt,
      purchasePriceCents: owned.purchasePrice,
      soldAt: owned.soldAt ?? 0,
      salePriceCents: sale,
      netCents: sale - owned.purchasePrice,
    };
  });
}

export function getAircraftSalesTotal(): number {
  const rows = db
    .select({ sale: ownedAircraft.salePriceCents })
    .from(ownedAircraft)
    .where(eq(ownedAircraft.status, "sold"))
    .all();
  let total = 0;
  for (const r of rows) total += r.sale ?? 0;
  return total;
}

