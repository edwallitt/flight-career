import type {
  AirportSize,
  CostLine,
  TransferEstimate,
  TransferInputs,
} from "./types.js";

const PILOT_CENTS_PER_NM = 80;
const PILOT_BASE_CENTS = 5_000;

const FERRY_PILOT_BASE_CENTS = 20_000;
const FERRY_PILOT_CENTS_PER_NM = 150;
const AIRCRAFT_ONLY_LOGISTICS_SURCHARGE_CENTS = 30_000;

const PILOT_MIN_DURATION_MINUTES = 180;
const PILOT_DURATION_MIN_PER_NM = 0.6;

function dollarsToCents(dollars: number): number {
  return Math.round(dollars) * 100;
}

function pilotTierMultiplier(
  origin?: AirportSize,
  destination?: AirportSize,
): number {
  if (origin === "major" && destination === "major") return 0.8;
  const small = (s?: AirportSize) => s === "small" || s === "remote";
  if (small(origin) || small(destination)) return 1.5;
  return 1.0;
}

function calculatePilot(input: TransferInputs): TransferEstimate {
  const baseCents = PILOT_CENTS_PER_NM * input.distanceNm + PILOT_BASE_CENTS;
  const adjustedCents =
    baseCents * pilotTierMultiplier(input.originSize, input.destinationSize);
  const costCents = dollarsToCents(adjustedCents / 100);
  const durationMinutes = Math.max(
    PILOT_MIN_DURATION_MINUTES,
    Math.round(input.distanceNm * PILOT_DURATION_MIN_PER_NM),
  );
  return {
    costCents,
    durationMinutes,
    costBreakdown: [{ label: "Commercial flight", amountCents: costCents }],
    aircraftHoursAccrued: 0,
    fuelGallonsBurned: 0,
  };
}

function calculateAircraftMove(
  input: TransferInputs,
  withSurcharge: boolean,
): TransferEstimate {
  const cruise = input.aircraftCruiseSpeedKts ?? 0;
  const burnGph = input.aircraftFuelBurnGph ?? 0;
  const fuelPriceCents = input.destinationFuelPriceCents ?? 0;
  const landingFeeCents = input.destinationLandingFeeCents ?? 0;

  if (cruise <= 0) {
    throw new Error(
      "calculateTransfer: aircraftCruiseSpeedKts is required for aircraft transfers",
    );
  }

  const blockTimeHoursRaw = input.distanceNm / cruise;
  const blockTimeHours = Math.round(blockTimeHoursRaw * 100) / 100;

  const fuelGallons = blockTimeHours * burnGph;
  const fuelGallonsRounded = Math.round(fuelGallons * 10) / 10;

  const ferryPilotCents = dollarsToCents(
    (FERRY_PILOT_BASE_CENTS + FERRY_PILOT_CENTS_PER_NM * input.distanceNm) / 100,
  );
  const fuelCents = dollarsToCents((fuelGallonsRounded * fuelPriceCents) / 100);
  const landingCents = dollarsToCents(landingFeeCents / 100);

  const breakdown: CostLine[] = [
    {
      label: withSurcharge ? "Ferry pilot (contract)" : "Ferry pilot",
      amountCents: ferryPilotCents,
    },
    {
      label: `Fuel (${fuelGallonsRounded.toFixed(1)} gal)`,
      amountCents: fuelCents,
    },
    { label: "Landing fee", amountCents: landingCents },
  ];

  let costCents = ferryPilotCents + fuelCents + landingCents;
  if (withSurcharge) {
    breakdown.push({
      label: "Logistics surcharge",
      amountCents: AIRCRAFT_ONLY_LOGISTICS_SURCHARGE_CENTS,
    });
    costCents += AIRCRAFT_ONLY_LOGISTICS_SURCHARGE_CENTS;
  }

  const durationMinutes = Math.max(1, Math.round(blockTimeHours * 60));

  return {
    costCents,
    durationMinutes,
    costBreakdown: breakdown,
    aircraftHoursAccrued: blockTimeHours,
    fuelGallonsBurned: fuelGallonsRounded,
  };
}

export function calculateTransfer(input: TransferInputs): TransferEstimate {
  switch (input.type) {
    case "pilot":
      return calculatePilot(input);
    case "pilot_aircraft":
      return calculateAircraftMove(input, false);
    case "aircraft":
      return calculateAircraftMove(input, true);
  }
}
