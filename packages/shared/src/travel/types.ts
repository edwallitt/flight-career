import type { AircraftClass } from "../clients/types.js";

export type TransferType = "pilot" | "pilot_aircraft" | "aircraft";

export type AirportSize = "major" | "regional" | "small" | "remote";

export interface TransferInputs {
  type: TransferType;
  originIcao: string;
  destinationIcao: string;
  distanceNm: number;
  aircraftCruiseSpeedKts?: number;
  aircraftFuelBurnGph?: number;
  aircraftClass?: AircraftClass;
  destinationFuelPriceCents?: number;
  destinationLandingFeeCents?: number;
  originSize?: AirportSize;
  destinationSize?: AirportSize;
}

export interface CostLine {
  label: string;
  amountCents: number;
}

export interface TransferEstimate {
  costCents: number;
  durationMinutes: number;
  costBreakdown: CostLine[];
  aircraftHoursAccrued: number;
  fuelGallonsBurned: number;
}
