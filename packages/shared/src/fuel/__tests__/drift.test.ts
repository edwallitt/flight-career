import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import {
  computeNextPrice,
  maybeSpawnShock,
} from "../drift.js";

function rngFromSeed(seed: string): () => number {
  return seedrandom(seed);
}

describe("computeNextPrice", () => {
  it("rounds to integer cents", () => {
    const rng = rngFromSeed("round-1");
    const next = computeNextPrice({
      currentPriceCents: 700,
      basePriceCents: 700,
      rng,
      ticksSinceLastDrift: 1,
      shockMultiplier: 1,
    });
    expect(Number.isInteger(next)).toBe(true);
  });

  it("mean-reverts toward base over many ticks (no shock)", () => {
    const base = 700;
    // Run 20 independent walks for 200 ticks each, starting well above base.
    // The average final price should sit very close to base.
    let sum = 0;
    const runs = 20;
    const ticksPerRun = 200;
    for (let r = 0; r < runs; r++) {
      const rng = rngFromSeed(`reversion-${r}`);
      let price = base * 1.3;
      for (let t = 0; t < ticksPerRun; t++) {
        price = computeNextPrice({
          currentPriceCents: price,
          basePriceCents: base,
          rng,
          ticksSinceLastDrift: 1,
          shockMultiplier: 1,
        });
      }
      sum += price;
    }
    const mean = sum / runs;
    // Expect the mean of long runs to land within a few % of base.
    expect(Math.abs(mean - base) / base).toBeLessThan(0.05);
  });

  it("random walk produces non-zero variance", () => {
    const base = 700;
    const samples: number[] = [];
    for (let r = 0; r < 50; r++) {
      const rng = rngFromSeed(`variance-${r}`);
      let price = base;
      // Single tick is enough — the per-tick walk amplitude is non-zero.
      price = computeNextPrice({
        currentPriceCents: price,
        basePriceCents: base,
        rng,
        ticksSinceLastDrift: 1,
        shockMultiplier: 1,
      });
      samples.push(price);
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance =
      samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    expect(variance).toBeGreaterThan(0);
  });

  it("clamps within normal bounds (±35%) without a shock", () => {
    const base = 700;
    // Even a long run with biased rng can't escape the bounds.
    const rng = rngFromSeed("bounds");
    let price = base;
    let min = price;
    let max = price;
    for (let t = 0; t < 1000; t++) {
      price = computeNextPrice({
        currentPriceCents: price,
        basePriceCents: base,
        rng,
        ticksSinceLastDrift: 1,
        shockMultiplier: 1,
      });
      if (price < min) min = price;
      if (price > max) max = price;
    }
    expect(min).toBeGreaterThanOrEqual(Math.round(base * 0.65));
    expect(max).toBeLessThanOrEqual(Math.round(base * 1.35));
  });

  it("clamps within shock bounds (±65%) when a shock is active", () => {
    const base = 700;
    const rng = rngFromSeed("shock-bounds");
    let price = base * 1.3;
    let max = price;
    for (let t = 0; t < 200; t++) {
      price = computeNextPrice({
        currentPriceCents: price,
        basePriceCents: base,
        rng,
        ticksSinceLastDrift: 1,
        shockMultiplier: 1.3,
      });
      if (price > max) max = price;
    }
    expect(max).toBeLessThanOrEqual(Math.round(base * 1.65));
  });

  it("shock multiplier shifts the long-run mean upward", () => {
    const base = 700;
    function meanFor(shockMultiplier: number, seed: string): number {
      const rng = rngFromSeed(seed);
      let price = base;
      let sum = 0;
      const ticks = 400;
      for (let t = 0; t < ticks; t++) {
        price = computeNextPrice({
          currentPriceCents: price,
          basePriceCents: base,
          rng,
          ticksSinceLastDrift: 1,
          shockMultiplier,
        });
        sum += price;
      }
      return sum / ticks;
    }
    const normal = meanFor(1, "shock-mean-normal");
    const shocked = meanFor(1.25, "shock-mean-up");
    expect(shocked).toBeGreaterThan(normal * 1.1);
  });
});

describe("maybeSpawnShock", () => {
  it("returns null on most calls", () => {
    let count = 0;
    const rng = rngFromSeed("spawn-rate");
    for (let i = 0; i < 1000; i++) {
      const ev = maybeSpawnShock(rng, 1_700_000_000_000 + i * 1000);
      if (ev) count++;
    }
    // SHOCK_SPAWN_PROB = 1/300 → expected ~3 in 1000 trials. Allow generous
    // bounds so the test isn't flaky across rng implementations.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it("produces shocks with parameters in their defined ranges", () => {
    // Force-spawn by chaining many calls with a forgiving rng — collect a
    // sample, validate every one falls in spec.
    const rng = rngFromSeed("spawn-validate");
    const events = [];
    for (let i = 0; i < 5000 && events.length < 30; i++) {
      const ev = maybeSpawnShock(rng, 1_700_000_000_000);
      if (ev) events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      // Multiplier must lie within the union of all template ranges.
      expect(ev.multiplier).toBeGreaterThanOrEqual(0.85);
      expect(ev.multiplier).toBeLessThanOrEqual(1.35);
      expect(ev.durationTicks).toBeGreaterThanOrEqual(4);
      expect(ev.durationTicks).toBeLessThanOrEqual(24);
      expect(["mild", "moderate", "severe"]).toContain(ev.severity);
      expect(ev.headline.length).toBeGreaterThan(0);
      expect(ev.description.length).toBeGreaterThan(0);
    }
  });
});
