import { describe, expect, it } from "vitest";
import { generateEvent, type EventGenerationInputs } from "../events.js";

function rngFromSequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i += 1;
    return v;
  };
}

function inputs(
  over: Partial<EventGenerationInputs> = {},
): EventGenerationInputs {
  return {
    riskTier: "healthy",
    factors: [],
    aircraftType: {
      fuelType: "avgas",
      aircraftClass: "SEP",
      overhaulCostCents: 4_000_000,
      annualCostCents: 200_000,
    },
    rng: () => 0.5,
    ...over,
  };
}

describe("generateEvent", () => {
  it("produces a light event for a healthy aircraft on a low roll", () => {
    // First rng value < 0.8 -> light. 0.1 picks light + somewhere in cost range.
    const ev = generateEvent(
      inputs({ rng: rngFromSequence([0.1, 0.5, 0.5, 0.5]) }),
    );
    expect(ev.severity).toBe("light");
    expect(ev.groundedDays).toBe(0);
    expect(ev.costCents).toBeGreaterThan(0);
  });

  it("produces a severe event for a critical aircraft on a high roll", () => {
    // critical: light 0.15, moderate 0.35, severe 0.5 — value 0.95 -> severe.
    const ev = generateEvent(
      inputs({
        riskTier: "critical",
        rng: rngFromSequence([0.95, 0.5, 0.5, 0.5]),
      }),
    );
    expect(ev.severity).toBe("severe");
    expect(ev.groundedDays).toBeGreaterThanOrEqual(3);
    expect(ev.groundedDays).toBeLessThanOrEqual(7);
  });

  it("scales SEP costs lower than JET costs for the same roll", () => {
    const sep = generateEvent(
      inputs({
        riskTier: "monitor",
        aircraftType: {
          fuelType: "avgas",
          aircraftClass: "SEP",
          overhaulCostCents: 4_000_000,
          annualCostCents: 200_000,
        },
        rng: rngFromSequence([0.05, 0.5, 0.5, 0.5]),
      }),
    );
    const jet = generateEvent(
      inputs({
        riskTier: "monitor",
        aircraftType: {
          fuelType: "jet-a",
          aircraftClass: "JET",
          overhaulCostCents: 4_000_000,
          annualCostCents: 200_000,
        },
        rng: rngFromSequence([0.05, 0.5, 0.5, 0.5]),
      }),
    );
    expect(sep.severity).toBe("light");
    expect(jet.severity).toBe("light");
    expect(jet.costCents).toBeGreaterThan(sep.costCents);
  });

  it("draws turbine-flavored descriptions for jet-a aircraft", () => {
    const ev = generateEvent(
      inputs({
        aircraftType: {
          fuelType: "jet-a",
          aircraftClass: "JET",
          overhaulCostCents: 5_000_000,
          annualCostCents: 200_000,
        },
        rng: rngFromSequence([0.5, 0.5, 0.5, 0.5]),
      }),
    );
    expect(ev.description).not.toMatch(/magneto/i);
  });

  it("propagates contributing factors as causeFactors", () => {
    const ev = generateEvent(
      inputs({
        factors: [
          {
            factor: "hours_since_100hr",
            severity: "moderate",
            description: "100-hour inspection overdue by 18 hours",
          },
          {
            factor: "engine_tbo_ratio",
            severity: "minor",
            description: "Engine at 89% of TBO",
          },
        ],
      }),
    );
    expect(ev.causeFactors).toEqual([
      "100-hour inspection overdue by 18 hours",
      "Engine at 89% of TBO",
    ]);
  });
});
