import { MAINTENANCE_SPECS, type MaintenanceType } from "./types.js";

export interface MaintenanceCostLine {
  label: string;
  amountCents: number;
}

export interface MaintenanceCost {
  baseCostCents: number;
  durationDays: number;
  estimateBreakdown: MaintenanceCostLine[];
}

const VARIANCE = 0.1;

const BREAKDOWN_WEIGHTS: Record<MaintenanceType, Array<{ label: string; weight: number }>> = {
  "100hr": [
    { label: "Inspection labor", weight: 0.6 },
    { label: "Parts and consumables", weight: 0.4 },
  ],
  annual: [
    { label: "Inspection labor", weight: 0.5 },
    { label: "Parts and consumables", weight: 0.35 },
    { label: "Compliance documentation", weight: 0.15 },
  ],
  overhaul: [
    { label: "Engine teardown labor", weight: 0.25 },
    { label: "New parts", weight: 0.5 },
    { label: "Reassembly and test", weight: 0.2 },
    { label: "Logbook compliance", weight: 0.05 },
  ],
};

function baseCostFor(
  type: MaintenanceType,
  costs: {
    hundredHourCostCents: number;
    annualCostCents: number;
    overhaulCostCents: number;
  },
): number {
  switch (type) {
    case "100hr":
      return costs.hundredHourCostCents;
    case "annual":
      return costs.annualCostCents;
    case "overhaul":
      return costs.overhaulCostCents;
  }
}

export function estimateMaintenance(
  type: MaintenanceType,
  aircraftType: {
    hundredHourCostCents: number;
    annualCostCents: number;
    overhaulCostCents: number;
  },
  rng: () => number,
): MaintenanceCost {
  const spec = MAINTENANCE_SPECS[type];
  const base = baseCostFor(type, aircraftType);
  const factor = 1 + (rng() * 2 - 1) * VARIANCE;
  const baseCostCents = Math.max(0, Math.round(base * factor));

  // Duration: integer in [min, max].
  const range = spec.duration.max - spec.duration.min + 1;
  const durationDays = spec.duration.min + Math.floor(rng() * range);

  // Breakdown: round each line, fix the last line so they reconcile.
  const weights = BREAKDOWN_WEIGHTS[type];
  const lines: MaintenanceCostLine[] = weights.map((w) => ({
    label: w.label,
    amountCents: Math.round(baseCostCents * w.weight),
  }));
  const sum = lines.reduce((acc, l) => acc + l.amountCents, 0);
  const drift = baseCostCents - sum;
  if (lines.length > 0 && drift !== 0) {
    const last = lines[lines.length - 1]!;
    last.amountCents += drift;
  }

  return {
    baseCostCents,
    durationDays,
    estimateBreakdown: lines,
  };
}
