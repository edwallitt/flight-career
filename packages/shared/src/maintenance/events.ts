// Unscheduled maintenance event generation.
//
// Pure logic: given a risk tier (from `assessRisk`) and an aircraft profile,
// rolls a severity, picks a plausible failure description, scales cost by
// class, and returns the event the server should apply.

import type { AircraftClass } from "../clients/types.js";
import type { RiskTier } from "./risk.js";

export type EventSeverity = "light" | "moderate" | "severe";

export interface UnscheduledEvent {
  severity: EventSeverity;
  costCents: number;
  groundedDays: number;
  description: string;
  causeFactors: string[];
}

export interface EventGenerationInputs {
  riskTier: RiskTier;
  factors: Array<{ factor: string; severity: string; description: string }>;
  aircraftType: {
    fuelType: "avgas" | "jet-a";
    aircraftClass: AircraftClass;
    overhaulCostCents: number;
    annualCostCents: number;
  };
  rng: () => number;
}

const SEVERITY_WEIGHTS: Record<RiskTier, Record<EventSeverity, number>> = {
  healthy: { light: 0.8, moderate: 0.18, severe: 0.02 },
  monitor: { light: 0.7, moderate: 0.25, severe: 0.05 },
  elevated: { light: 0.5, moderate: 0.35, severe: 0.15 },
  high: { light: 0.3, moderate: 0.4, severe: 0.3 },
  critical: { light: 0.15, moderate: 0.35, severe: 0.5 },
};

// Cost scalers by aircraft class — turbines are dramatically more expensive.
const CLASS_SCALERS: Record<AircraftClass, { light: number; moderate: number; severe: number }> = {
  SEP: { light: 0.5, moderate: 0.7, severe: 1.0 },
  MEP: { light: 0.5, moderate: 0.7, severe: 1.2 },
  SET: { light: 1.0, moderate: 1.0, severe: 1.5 },
  JET: { light: 2.0, moderate: 2.5, severe: 2.5 },
};

// Base cost ranges in cents. Severe is computed as a fraction of overhaul cost
// rather than a flat range, so heavier aircraft naturally see bigger numbers.
const LIGHT_BASE_RANGE_CENTS = { min: 30_000, max: 150_000 };
const MODERATE_BASE_RANGE_CENTS = { min: 200_000, max: 800_000 };
const SEVERE_OVERHAUL_FRACTION = { min: 0.05, max: 0.2 };

const GROUNDED_DAYS_BY_SEVERITY: Record<
  EventSeverity,
  { min: number; max: number }
> = {
  light: { min: 0, max: 0 },
  moderate: { min: 1, max: 2 },
  severe: { min: 3, max: 7 },
};

interface DescriptionPool {
  piston: string[];
  turbine: string[];
}

const DESCRIPTIONS: Record<EventSeverity, DescriptionPool> = {
  light: {
    piston: [
      "Brake pad replacement",
      "Fuel filter clogged",
      "Pitot tube needs cleaning",
      "Static port obstruction",
      "Avionics calibration",
      "Tire replacement after hard landing",
      "Battery weak — replaced",
    ],
    turbine: [
      "Avionics calibration",
      "Pitot heat element replaced",
      "Brake pad replacement",
      "Static port obstruction",
      "Igniter inspection",
      "Tire replacement after hard landing",
    ],
  },
  moderate: {
    piston: [
      "Magneto failure during run-up",
      "Vacuum pump failure",
      "Alternator replacement",
      "Cylinder compression below limits",
      "Hydraulic seal leak",
      "Starter motor seized",
      "Oil cooler replacement",
    ],
    turbine: [
      "Hydraulic seal leak",
      "Bleed-air valve failure",
      "Generator replacement",
      "FCU adjustment required",
      "Engine chip light — magnetic plug inspection",
      "Pressurization controller replacement",
    ],
  },
  severe: {
    piston: [
      "Cylinder requires removal and overhaul",
      "Crankshaft showing wear pattern requiring teardown",
      "Camshaft pitting found at inspection",
      "Avionics fire — wiring rebuild required",
      "Catastrophic prop strike — engine teardown",
    ],
    turbine: [
      "Hot section inspection — turbine erosion found",
      "Compressor stall damage requires teardown",
      "Avionics fire — wiring rebuild required",
      "Bearing failure — engine sent for off-wing rebuild",
      "FOD damage to first-stage turbine",
    ],
  },
};

function pickSeverity(tier: RiskTier, rng: () => number): EventSeverity {
  const w = SEVERITY_WEIGHTS[tier];
  const r = rng();
  if (r < w.light) return "light";
  if (r < w.light + w.moderate) return "moderate";
  return "severe";
}

function pickInRange(
  range: { min: number; max: number },
  rng: () => number,
): number {
  return range.min + rng() * (range.max - range.min);
}

function pickIntInRange(
  range: { min: number; max: number },
  rng: () => number,
): number {
  return Math.floor(range.min + rng() * (range.max - range.min + 1));
}

function pickDescription(
  severity: EventSeverity,
  fuelType: "avgas" | "jet-a",
  rng: () => number,
): string {
  const pool = DESCRIPTIONS[severity];
  const list = fuelType === "jet-a" ? pool.turbine : pool.piston;
  const idx = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[idx]!;
}

function severeCostCents(
  overhaulCostCents: number,
  rng: () => number,
): number {
  const fraction = pickInRange(SEVERE_OVERHAUL_FRACTION, rng);
  return Math.max(50_000, Math.round(overhaulCostCents * fraction));
}

export function generateEvent(inputs: EventGenerationInputs): UnscheduledEvent {
  const { riskTier, factors, aircraftType, rng } = inputs;

  const severity = pickSeverity(riskTier, rng);
  const scaler = CLASS_SCALERS[aircraftType.aircraftClass][severity];

  let baseCost: number;
  switch (severity) {
    case "light":
      baseCost = pickInRange(LIGHT_BASE_RANGE_CENTS, rng);
      break;
    case "moderate":
      baseCost = pickInRange(MODERATE_BASE_RANGE_CENTS, rng);
      break;
    case "severe":
      baseCost = severeCostCents(aircraftType.overhaulCostCents, rng);
      break;
  }

  // Floor at $10 — light/moderate ranges already have meaningful minima;
  // severe has its own floor inside `severeCostCents`. This is a defensive
  // backstop for pathological scaler values, not a primary clamp.
  const costCents = Math.max(1_000, Math.round(baseCost * scaler));

  const groundedDays = pickIntInRange(GROUNDED_DAYS_BY_SEVERITY[severity], rng);

  const description = pickDescription(severity, aircraftType.fuelType, rng);

  const causeFactors = factors.map((f) => f.description);

  return {
    severity,
    costCents,
    groundedDays,
    description,
    causeFactors,
  };
}
