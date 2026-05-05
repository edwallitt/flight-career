import type {
  AircraftClass,
  Role,
  Urgency,
  WeatherSensitivity,
} from "../clients/types.js";

export type FlightRole = Role | "open";

export interface CompleteFlightInput {
  // Job context
  jobId: number;
  clientId: string | null;
  role: FlightRole;
  jobOriginIcao: string;
  jobDestinationIcao: string;
  jobPay: number;
  jobLatestDeparture: number | null;
  jobUrgency: Urgency;
  weatherSensitivity: WeatherSensitivity;

  // Aircraft context
  aircraftSource: "owned" | "rental";
  aircraftTypeId: string;
  aircraftClass: AircraftClass;
  ownedAircraftId: number | null;
  rentalRatePerHourCents: number;
  fuelBurnGph: number;
  cruiseSpeedKts: number;

  // Flight outcome
  actualOriginIcao: string;
  actualDestinationIcao: string;
  startedAt: number;
  endedAt: number;
  blockTimeMinutes: number;
  fuelBurnedGal: number | null;
  briefedFuelCostCents: number;
  refuelAtDestination: boolean;
  destinationFuelPriceCents: number;

  // Airport context
  destinationLandingFeeCents: number;
  isDiversion: boolean;
  divertedDistanceFromTargetNm: number;
}

export interface ReputationDelta {
  scope: string;
  delta: number;
}

export interface AircraftUpdates {
  blockHoursAdded: number;
  fuelBurnedGalDelta: number;
  fuelRefilledGalDelta: number;
  newLocationIcao: string;
}

export interface FlightLogEntry {
  originIcao: string;
  destinationIcao: string;
  blockTimeMinutes: number;
  fuelBurnedGal: number;
  totalCost: number;
  totalRevenue: number;
  notes: string | null;
}

export interface CompleteFlightOutput {
  finalPay: number;
  diversionAdjustment: number;

  destinationLandingFee: number;
  rentalCost: number;
  destinationRefuelCost: number;

  grossRevenue: number;
  totalCosts: number;
  netCashDelta: number;

  reputationDeltas: ReputationDelta[];
  aircraftUpdates: AircraftUpdates | null;
  newLocationIcao: string;

  flightLogEntry: FlightLogEntry;
  summaryLines: string[];
}

type DiversionTier = "none" | "near" | "far" | "failed";

const NEAR_DIVERSION_THRESHOLD_NM = 50;
const FAR_DIVERSION_THRESHOLD_NM = 150;
const NEAR_DIVERSION_PAY_FACTOR = 0.9; // 10% diversion fee
const FAR_DIVERSION_PAY_FACTOR = 0.5;
const STRICT_WEATHER_DIVERSION_CLIENT_PENALTY = -2;

const REP_DELTAS: Record<
  DiversionTier,
  Record<Urgency, { role: number; client: number }>
> = {
  none: {
    flexible: { role: 1, client: 2 },
    standard: { role: 2, client: 3 },
    urgent: { role: 3, client: 5 },
    critical: { role: 4, client: 6 },
  },
  near: {
    flexible: { role: 0, client: 0 },
    standard: { role: 1, client: 1 },
    urgent: { role: 1, client: 0 },
    critical: { role: 1, client: -1 },
  },
  far: {
    flexible: { role: 0, client: -1 },
    standard: { role: 0, client: -2 },
    urgent: { role: 0, client: -4 },
    critical: { role: 0, client: -6 },
  },
  failed: {
    flexible: { role: -2, client: -4 },
    standard: { role: -3, client: -8 },
    urgent: { role: -3, client: -12 },
    critical: { role: -3, client: -15 },
  },
};

interface DiversionOutcome {
  tier: DiversionTier;
  finalPay: number;
}

function classifyDiversion(
  isDiversion: boolean,
  distanceFromTargetNm: number,
  jobPay: number,
): DiversionOutcome {
  if (!isDiversion) {
    return { tier: "none", finalPay: jobPay };
  }
  if (distanceFromTargetNm <= NEAR_DIVERSION_THRESHOLD_NM) {
    return { tier: "near", finalPay: Math.round(jobPay * NEAR_DIVERSION_PAY_FACTOR) };
  }
  if (distanceFromTargetNm <= FAR_DIVERSION_THRESHOLD_NM) {
    return { tier: "far", finalPay: Math.round(jobPay * FAR_DIVERSION_PAY_FACTOR) };
  }
  return { tier: "failed", finalPay: 0 };
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${sign}$${dollars.toLocaleString("en-US")}`;
}

function formatBlockTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatHours(hours: number): string {
  return `${hours.toFixed(2)} hrs`;
}

function roleLabel(role: Role): string {
  switch (role) {
    case "bush":
      return "Bush";
    case "air_taxi":
      return "Air Taxi";
    case "light_jet":
      return "Light Jet";
  }
}

export function completeFlight(input: CompleteFlightInput): CompleteFlightOutput {
  const blockHours = input.blockTimeMinutes / 60;

  // 1. Pay
  const diversion = classifyDiversion(
    input.isDiversion,
    input.divertedDistanceFromTargetNm,
    input.jobPay,
  );
  const finalPay = diversion.finalPay;
  const diversionAdjustment = finalPay - input.jobPay;

  // 2. Costs
  const fuelBurnedGal =
    input.fuelBurnedGal != null ? input.fuelBurnedGal : blockHours * input.fuelBurnGph;

  const destinationLandingFee = input.destinationLandingFeeCents;
  const rentalCost =
    input.aircraftSource === "rental"
      ? Math.round(blockHours * input.rentalRatePerHourCents)
      : 0;

  // MVP refuel model: refill exactly what was burned at destination price.
  // This is an approximation — assumes pre-flight tanks were full and player
  // tops up to that same level. Per-gallon and partial-tank refueling come later.
  const destinationRefuelCost =
    input.aircraftSource === "owned" && input.refuelAtDestination
      ? Math.round(fuelBurnedGal * input.destinationFuelPriceCents)
      : 0;

  // 3. Reputation
  const reputationDeltas: ReputationDelta[] = [];
  if (input.role !== "open") {
    const base = REP_DELTAS[diversion.tier][input.jobUrgency];
    const isStrictDiversion =
      input.weatherSensitivity === "strict" && diversion.tier !== "none";
    const clientDelta =
      base.client + (isStrictDiversion ? STRICT_WEATHER_DIVERSION_CLIENT_PENALTY : 0);

    if (base.role !== 0) {
      reputationDeltas.push({ scope: input.role, delta: base.role });
    }
    if (clientDelta !== 0 && input.clientId) {
      reputationDeltas.push({
        scope: `client:${input.clientId}`,
        delta: clientDelta,
      });
    }
  }

  // 4. Net cash (briefed fuel was already deducted at briefing time)
  const grossRevenue = finalPay;
  const totalCostsForLog =
    input.briefedFuelCostCents + destinationLandingFee + rentalCost + destinationRefuelCost;
  const netCashDelta =
    grossRevenue - destinationLandingFee - rentalCost - destinationRefuelCost;

  // 5. Aircraft updates (owned only)
  const aircraftUpdates: AircraftUpdates | null =
    input.aircraftSource === "owned"
      ? {
          blockHoursAdded: blockHours,
          fuelBurnedGalDelta: fuelBurnedGal,
          fuelRefilledGalDelta: input.refuelAtDestination ? fuelBurnedGal : 0,
          newLocationIcao: input.actualDestinationIcao,
        }
      : null;

  // 6. Flight log
  const notes =
    diversion.tier === "none"
      ? null
      : `Diversion to ${input.actualDestinationIcao} - ${Math.round(
          input.divertedDistanceFromTargetNm,
        )}nm from target`;

  const flightLogEntry: FlightLogEntry = {
    originIcao: input.actualOriginIcao,
    destinationIcao: input.actualDestinationIcao,
    blockTimeMinutes: input.blockTimeMinutes,
    fuelBurnedGal,
    totalCost: totalCostsForLog,
    totalRevenue: grossRevenue,
    notes,
  };

  // 7. Summary lines
  const summaryLines: string[] = [];
  if (diversion.tier === "none") {
    summaryLines.push(`Delivered on time at ${input.actualDestinationIcao}`);
  } else if (diversion.tier === "near") {
    summaryLines.push(
      `Diverted to ${input.actualDestinationIcao} (${Math.round(
        input.divertedDistanceFromTargetNm,
      )}nm from ${input.jobDestinationIcao}) — diversion fee applied`,
    );
  } else if (diversion.tier === "far") {
    summaryLines.push(
      `Diverted to ${input.actualDestinationIcao} (${Math.round(
        input.divertedDistanceFromTargetNm,
      )}nm from ${input.jobDestinationIcao}) — half pay`,
    );
  } else {
    summaryLines.push(
      `Failed delivery — diverted ${Math.round(
        input.divertedDistanceFromTargetNm,
      )}nm from ${input.jobDestinationIcao}`,
    );
  }

  if (diversion.tier !== "failed") {
    summaryLines.push(`Earned ${formatDollars(grossRevenue)}`);
  }
  summaryLines.push(`Fuel: ${formatDollars(input.briefedFuelCostCents)} (paid pre-flight)`);
  if (destinationLandingFee > 0) {
    summaryLines.push(`Landing fee: ${formatDollars(destinationLandingFee)}`);
  }
  if (rentalCost > 0) {
    summaryLines.push(
      `Rental: ${formatDollars(rentalCost)} (${formatHours(blockHours)} × ${formatDollars(
        input.rentalRatePerHourCents,
      )}/hr)`,
    );
  }
  if (destinationRefuelCost > 0) {
    summaryLines.push(`Refuel at destination: ${formatDollars(destinationRefuelCost)}`);
  }
  summaryLines.push(
    `Net: ${netCashDelta >= 0 ? "+" : ""}${formatDollars(netCashDelta)}`,
  );

  if (reputationDeltas.length > 0) {
    const repPieces = reputationDeltas.map((d) => {
      const sign = d.delta >= 0 ? "+" : "";
      if (d.scope.startsWith("client:")) {
        return `${d.scope.slice("client:".length)} ${sign}${d.delta}`;
      }
      return `${roleLabel(d.scope as Role)} ${sign}${d.delta}`;
    });
    summaryLines.push(`Reputation: ${repPieces.join(", ")}`);
  }

  if (aircraftUpdates) {
    summaryLines.push(
      `Block time: ${formatBlockTime(input.blockTimeMinutes)} → ${formatHours(
        blockHours,
      )} added to aircraft`,
    );
  }

  return {
    finalPay,
    diversionAdjustment,
    destinationLandingFee,
    rentalCost,
    destinationRefuelCost,
    grossRevenue,
    totalCosts: totalCostsForLog,
    netCashDelta,
    reputationDeltas,
    aircraftUpdates,
    newLocationIcao: input.actualDestinationIcao,
    flightLogEntry,
    summaryLines,
  };
}
