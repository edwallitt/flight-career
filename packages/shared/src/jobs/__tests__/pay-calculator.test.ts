import { describe, expect, it } from "vitest";
import { calculatePay, type PayInputs } from "../pay-calculator.js";

function inputs(over: Partial<PayInputs> = {}): PayInputs {
  return {
    distanceNm: 100,
    requiredClass: "SEP",
    payloadLbs: 200, // exactly the SEP baseline → no payload bonus
    urgency: "standard",
    weatherSensitivity: "none",
    isUnpavedRequired: false,
    isRemoteDestination: false,
    basePayMultiplier: 1,
    familiarityDiscount: 0,
    ...over,
  };
}

describe("calculatePay", () => {
  it("returns whole-dollar pay in cents for the simplest SEP case", () => {
    // 100 nm * $3 SEP rate = $300 → 30000 cents
    expect(calculatePay(inputs())).toBe(30000);
  });

  it("scales by class rate per nm", () => {
    // 100 nm × $5 MEP = $500
    expect(
      calculatePay(
        inputs({ requiredClass: "MEP", payloadLbs: 400 }), // MEP baseline
      ),
    ).toBe(50000);

    // 100 nm × $8 SET = $800
    expect(
      calculatePay(inputs({ requiredClass: "SET", payloadLbs: 800 })),
    ).toBe(80000);

    // 100 nm × $22 JET = $2200
    expect(
      calculatePay(inputs({ requiredClass: "JET", payloadLbs: 600 })),
    ).toBe(220000);
  });

  it("clamps payload bonus at 0 when payload is below the class baseline", () => {
    const atBaseline = calculatePay(inputs({ payloadLbs: 200 }));
    const belowBaseline = calculatePay(inputs({ payloadLbs: 50 }));
    expect(belowBaseline).toBe(atBaseline);
  });

  it("adds $0.50 per pound above the class baseline", () => {
    // 100 nm × $3 = $300 base. +200 lbs over baseline × $0.50 = $100 → $400
    expect(calculatePay(inputs({ payloadLbs: 400 }))).toBe(40000);
  });

  it("applies urgency multipliers", () => {
    expect(calculatePay(inputs({ urgency: "flexible" }))).toBe(
      Math.round(300 * 0.95) * 100,
    );
    expect(calculatePay(inputs({ urgency: "urgent" }))).toBe(
      Math.round(300 * 1.25) * 100,
    );
    expect(calculatePay(inputs({ urgency: "critical" }))).toBe(
      Math.round(300 * 1.5) * 100,
    );
  });

  it("applies weather-sensitivity multipliers", () => {
    expect(calculatePay(inputs({ weatherSensitivity: "mild" }))).toBe(
      Math.round(300 * 1.05) * 100,
    );
    expect(calculatePay(inputs({ weatherSensitivity: "strict" }))).toBe(
      Math.round(300 * 1.15) * 100,
    );
  });

  it("applies a 15% bonus when unpaved capability is required", () => {
    expect(calculatePay(inputs({ isUnpavedRequired: true }))).toBe(
      Math.round(300 * 1.15) * 100,
    );
  });

  it("applies a 20% bonus for remote destinations", () => {
    expect(calculatePay(inputs({ isRemoteDestination: true }))).toBe(
      Math.round(300 * 1.2) * 100,
    );
  });

  it("stacks unpaved + remote multiplicatively", () => {
    expect(
      calculatePay(
        inputs({ isUnpavedRequired: true, isRemoteDestination: true }),
      ),
    ).toBe(Math.round(300 * 1.15 * 1.2) * 100);
  });

  it("multiplies by basePayMultiplier", () => {
    expect(calculatePay(inputs({ basePayMultiplier: 1.5 }))).toBe(
      Math.round(300 * 1.5) * 100,
    );
  });

  it("reduces pay by the familiarity discount", () => {
    expect(calculatePay(inputs({ familiarityDiscount: 0.1 }))).toBe(
      Math.round(300 * 0.9) * 100,
    );
  });

  it("rounds to whole dollars before converting to cents", () => {
    // Pick a multiplier that produces a fractional dollar amount.
    // 100 nm × $3 × 1.05 (mild weather) = $315 (already integer) — use a
    // base multiplier that breaks integer-ness.
    const result = calculatePay(inputs({ basePayMultiplier: 1.005 }));
    expect(result % 100).toBe(0); // never partial cents
  });

  it("returns 0 cents when familiarity discount is 1.0", () => {
    expect(calculatePay(inputs({ familiarityDiscount: 1 }))).toBe(0);
  });

  it("scales linearly with distance for a fixed class baseline payload", () => {
    const a = calculatePay(inputs({ distanceNm: 100 }));
    const b = calculatePay(inputs({ distanceNm: 200 }));
    expect(b).toBe(a * 2);
  });
});
