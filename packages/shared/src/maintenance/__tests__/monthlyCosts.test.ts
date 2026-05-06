import { describe, expect, it } from "vitest";
import { calculateMonthlyOwnership } from "../monthlyCosts.js";

describe("calculateMonthlyOwnership", () => {
  it("sums hangarage and insurance", () => {
    const out = calculateMonthlyOwnership({
      hangarageMonthlyCents: 25_000,
      insuranceMonthlyCents: 75_000,
    });
    expect(out.hangarageCents).toBe(25_000);
    expect(out.insuranceCents).toBe(75_000);
    expect(out.totalCents).toBe(100_000);
  });

  it("handles zero hangarage", () => {
    const out = calculateMonthlyOwnership({
      hangarageMonthlyCents: 0,
      insuranceMonthlyCents: 50_000,
    });
    expect(out.totalCents).toBe(50_000);
  });
});
