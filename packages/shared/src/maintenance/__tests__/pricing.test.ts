import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import { estimateMaintenance } from "../pricing.js";
import { MAINTENANCE_SPECS } from "../types.js";

const TYPE_COSTS = {
  hundredHourCostCents: 80_000,
  annualCostCents: 1_500_000,
  overhaulCostCents: 60_000_000,
};

describe("estimateMaintenance", () => {
  it("returns base cost within ±10% of the type's stored cost", () => {
    const rng = seedrandom("seed-1");
    for (let i = 0; i < 200; i++) {
      const out = estimateMaintenance("100hr", TYPE_COSTS, rng);
      expect(out.baseCostCents).toBeGreaterThanOrEqual(
        Math.floor(TYPE_COSTS.hundredHourCostCents * 0.9),
      );
      expect(out.baseCostCents).toBeLessThanOrEqual(
        Math.ceil(TYPE_COSTS.hundredHourCostCents * 1.1),
      );
    }
  });

  it("breakdown line amounts sum exactly to baseCostCents", () => {
    const rng = seedrandom("seed-2");
    for (let i = 0; i < 100; i++) {
      const out = estimateMaintenance("annual", TYPE_COSTS, rng);
      const sum = out.estimateBreakdown.reduce((a, l) => a + l.amountCents, 0);
      expect(sum).toBe(out.baseCostCents);
    }
  });

  it("duration falls within the spec's range, inclusive", () => {
    const rng = seedrandom("seed-3");
    for (const t of ["100hr", "annual", "overhaul"] as const) {
      const spec = MAINTENANCE_SPECS[t];
      for (let i = 0; i < 50; i++) {
        const out = estimateMaintenance(t, TYPE_COSTS, rng);
        expect(out.durationDays).toBeGreaterThanOrEqual(spec.duration.min);
        expect(out.durationDays).toBeLessThanOrEqual(spec.duration.max);
      }
    }
  });

  it("100hr has 2 breakdown lines, annual has 3, overhaul has 4", () => {
    const rng = seedrandom("seed-4");
    expect(estimateMaintenance("100hr", TYPE_COSTS, rng).estimateBreakdown).toHaveLength(2);
    expect(estimateMaintenance("annual", TYPE_COSTS, rng).estimateBreakdown).toHaveLength(3);
    expect(estimateMaintenance("overhaul", TYPE_COSTS, rng).estimateBreakdown).toHaveLength(4);
  });

  it("is deterministic with a seeded RNG", () => {
    const a = estimateMaintenance("annual", TYPE_COSTS, seedrandom("same"));
    const b = estimateMaintenance("annual", TYPE_COSTS, seedrandom("same"));
    expect(a).toEqual(b);
  });
});
