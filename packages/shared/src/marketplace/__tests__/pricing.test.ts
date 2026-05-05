import { describe, expect, it } from "vitest";
import { priceAircraft } from "../pricing.js";

const BASE = 50_000_000; // $500,000 in cents

describe("priceAircraft", () => {
  it("prices a near-new aircraft close to base price", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 0,
      engineHoursSinceOverhaul: 0,
      tboHours: 2000,
      hoursSinceAnnual: 30,
      hoursSince100hr: 5,
      conditionGrade: "excellent",
    });
    // 0% airframe, 0% engine, +3% inspection, 0% condition → 1.03×.
    // Rounded down to nearest $1k.
    expect(result.askingPriceCents).toBe(51_500_000);
    expect(result.depreciationFactor).toBeCloseTo(1.03, 2);
  });

  it("floors at 25% of base for severely depreciated airframes", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 12000,
      engineHoursSinceOverhaul: 1900,
      tboHours: 2000,
      hoursSinceAnnual: 350,
      hoursSince100hr: 99,
      conditionGrade: "project",
    });
    // -50% age + -25% engine + (-5 + -3)% inspection + -20% condition
    // = -103% raw, floored to 25%.
    expect(result.askingPriceCents).toBe(BASE * 0.25);
  });

  it("subtracts ~25% when engine is past TBO threshold", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 200,
      engineHoursSinceOverhaul: 1900,
      tboHours: 2000,
      hoursSinceAnnual: 30, // recent annual: +0.03
      hoursSince100hr: 10, // no penalty
      conditionGrade: "excellent",
    });
    // airframe: ~ -3.2% @ 200/500 of -8% = -0.032
    // engine: -25%, inspection: +3%, condition: 0
    // total ~ -25.2%, minus airframe age ~ -3.2% = -28.4%
    expect(result.factorBreakdown.engineRemaining).toBe(-0.25);
    expect(result.depreciationFactor).toBeLessThan(0.75);
    expect(result.depreciationFactor).toBeGreaterThan(0.65);
  });

  it("adds 5% for pristine condition", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 0,
      engineHoursSinceOverhaul: 0,
      tboHours: 2000,
      hoursSinceAnnual: 200,
      hoursSince100hr: 50,
      conditionGrade: "pristine",
    });
    expect(result.factorBreakdown.conditionAdjustment).toBe(0.05);
    // No other adjustments → 1.05× base.
    expect(result.askingPriceCents).toBe(52_500_000);
  });

  it("subtracts 20% for project condition", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 0,
      engineHoursSinceOverhaul: 0,
      tboHours: 2000,
      hoursSinceAnnual: 200,
      hoursSince100hr: 50,
      conditionGrade: "project",
    });
    expect(result.factorBreakdown.conditionAdjustment).toBe(-0.2);
    expect(result.askingPriceCents).toBe(40_000_000);
  });

  it("rewards a recent annual with +3%", () => {
    const result = priceAircraft({
      basePurchasePriceCents: BASE,
      airframeHours: 0,
      engineHoursSinceOverhaul: 0,
      tboHours: 2000,
      hoursSinceAnnual: 60,
      hoursSince100hr: 50,
      conditionGrade: "excellent",
    });
    expect(result.factorBreakdown.inspectionState).toBe(0.03);
  });
});
