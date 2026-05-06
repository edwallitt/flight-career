import { describe, expect, it } from "vitest";
import {
  recommendedFuelUplift,
  requiredTotalFuelGallons,
} from "../fuel.js";

describe("requiredTotalFuelGallons", () => {
  it("computes trip burn + 45min reserve + 5% contingency", () => {
    // 200nm at 100kts = 2 hr block. 10 gph → 20 gal trip + 7.5 gal reserve =
    // 27.5 × 1.05 = 28.875 → ceil = 29.
    expect(requiredTotalFuelGallons(200, 100, 10)).toBe(29);
  });

  it("returns 0 for zero/negative inputs", () => {
    expect(requiredTotalFuelGallons(0, 100, 10)).toBe(8); // 0 + reserve
    expect(requiredTotalFuelGallons(100, 0, 10)).toBe(0);
    expect(requiredTotalFuelGallons(100, 100, 0)).toBe(0);
  });
});

describe("recommendedFuelUplift", () => {
  it("returns positive uplift when current fuel is below required", () => {
    // Required ≈ 29 gal (above), starting at 10 gal → need 19 → ceil to 20.
    const uplift = recommendedFuelUplift({
      distanceNm: 200,
      cruiseSpeedKts: 100,
      fuelBurnGph: 10,
      fuelCapacityGal: 60,
      currentFuelGal: 10,
    });
    expect(uplift).toBe(20);
  });

  it("returns 0 when current fuel is already sufficient", () => {
    // Required ≈ 29 gal, current 50 gal → no uplift needed.
    const uplift = recommendedFuelUplift({
      distanceNm: 200,
      cruiseSpeedKts: 100,
      fuelBurnGph: 10,
      fuelCapacityGal: 60,
      currentFuelGal: 50,
    });
    expect(uplift).toBe(0);
  });

  it("clamps to remaining tank capacity when headroom is the binding constraint", () => {
    // Required ≈ 29 gal at current 10, would round to 20. But capacity 18
    // gives headroom 8 — uplift must be capped there, not extrapolated up.
    const uplift = recommendedFuelUplift({
      distanceNm: 200,
      cruiseSpeedKts: 100,
      fuelBurnGph: 10,
      fuelCapacityGal: 18,
      currentFuelGal: 10,
    });
    expect(uplift).toBe(8);
  });

  it("rounds up to the nearest 5 gallons", () => {
    // Need 11 gal of uplift → rounds to 15.
    const uplift = recommendedFuelUplift({
      distanceNm: 100,
      cruiseSpeedKts: 100,
      fuelBurnGph: 10, // trip 10 gal + reserve 7.5 → 17.5 × 1.05 → 19 ceil
      fuelCapacityGal: 60,
      currentFuelGal: 8,
    });
    // required = 19, need = 11 → ceil(11/5)*5 = 15.
    expect(uplift).toBe(15);
  });

  it("returns 0 when tanks are already full", () => {
    const uplift = recommendedFuelUplift({
      distanceNm: 1000,
      cruiseSpeedKts: 100,
      fuelBurnGph: 10,
      fuelCapacityGal: 60,
      currentFuelGal: 60,
    });
    expect(uplift).toBe(0);
  });
});
