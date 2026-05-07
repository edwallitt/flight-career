import { priceAircraft } from "./pricing.js";

// Broker takes 12% of fair market value when selling. Real-world dealer
// spreads on aircraft fall in the 10–15% band; we anchor at 12%.
export const BROKER_SPREAD_BPS = 1200;

export type SaleAircraftStatus =
  | "available"
  | "in_maintenance"
  | "in_flight"
  | "committed"
  | "sold";

export interface SaleEligibilityContext {
  aircraft: {
    status: SaleAircraftStatus;
    currentLocationIcao: string;
  };
  airport: {
    icao: string;
    hasMaintenance: boolean;
  };
  loan: { remainingBalanceCents: number } | null;
  cash: number;
}

export interface SaleEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface SaleEstimate {
  estimatedValueCents: number;
  brokerSpreadBps: number;
  brokerSpreadCents: number;
  grossSaleCents: number;
  loanPayoffCents: number;
  netToPlayerCents: number;
  underwater: boolean;
}

export interface EstimateSaleInputs {
  aircraftType: { basePurchasePriceCents: number; tboHours: number };
  aircraft: {
    airframeHours: number;
    engineHoursSinceOverhaul: number;
    hoursSince100hr: number;
    hoursSinceAnnual: number;
  };
  loan: { remainingBalanceCents: number } | null;
}

export function estimateSale(inputs: EstimateSaleInputs): SaleEstimate {
  const pricing = priceAircraft({
    basePurchasePriceCents: inputs.aircraftType.basePurchasePriceCents,
    airframeHours: inputs.aircraft.airframeHours,
    engineHoursSinceOverhaul: inputs.aircraft.engineHoursSinceOverhaul,
    tboHours: inputs.aircraftType.tboHours,
    hoursSinceAnnual: inputs.aircraft.hoursSinceAnnual,
    hoursSince100hr: inputs.aircraft.hoursSince100hr,
    conditionGrade: "good",
  });
  const estimatedValueCents = pricing.askingPriceCents;
  const brokerSpreadCents = Math.round(
    (estimatedValueCents * BROKER_SPREAD_BPS) / 10_000,
  );
  const grossSaleCents = Math.max(0, estimatedValueCents - brokerSpreadCents);
  const loanPayoffCents = Math.max(0, inputs.loan?.remainingBalanceCents ?? 0);
  const netToPlayerCents = grossSaleCents - loanPayoffCents;
  return {
    estimatedValueCents,
    brokerSpreadBps: BROKER_SPREAD_BPS,
    brokerSpreadCents,
    grossSaleCents,
    loanPayoffCents,
    netToPlayerCents,
    underwater: netToPlayerCents < 0,
  };
}

export function checkSaleEligibility(
  ctx: SaleEligibilityContext,
  estimate: SaleEstimate,
): SaleEligibility {
  const reasons: string[] = [];
  if (ctx.aircraft.status !== "available") {
    const label =
      ctx.aircraft.status === "in_flight"
        ? "in flight"
        : ctx.aircraft.status === "in_maintenance"
          ? "in maintenance"
          : ctx.aircraft.status === "committed"
            ? "committed to a job"
            : "already sold";
    reasons.push(`Aircraft unavailable: ${label}.`);
  }
  if (!ctx.airport.hasMaintenance) {
    reasons.push(
      "Selling requires a maintenance-capable airport for buyer inspection. Travel to a major airport first.",
    );
  }
  if (estimate.underwater) {
    const shortfall = Math.abs(estimate.netToPlayerCents);
    if (ctx.cash < shortfall) {
      const need = shortfall - ctx.cash;
      reasons.push(
        `Insufficient cash to cover loan shortfall. Need $${formatDollars(need)} more.`,
      );
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

function formatDollars(cents: number): string {
  const dollars = Math.ceil(cents / 100);
  return dollars.toLocaleString("en-US");
}
