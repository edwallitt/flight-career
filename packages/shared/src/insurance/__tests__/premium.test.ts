import { describe, expect, it } from "vitest";
import type { RiskTier } from "../../maintenance/risk.js";
import { quotePremium, quoteAllTiers } from "../premium.js";
import { INSURANCE_TIERS } from "../tiers.js";

describe("quotePremium", () => {
  it("scales linearly with insured value", () => {
    const a = quotePremium({
      tier: "standard",
      insuredValueCents: 10_000_000, // $100k
      riskTier: "healthy",
      cannotDispatch: false,
    });
    const b = quotePremium({
      tier: "standard",
      insuredValueCents: 20_000_000, // $200k
      riskTier: "healthy",
      cannotDispatch: false,
    });
    // 0.42% of $100k = $420/mo; doubling value doubles the premium.
    expect(a.monthlyPremiumCents).toBe(42_000);
    expect(b.monthlyPremiumCents).toBe(84_000);
  });

  it("applies the additive risk surcharge per risk tier", () => {
    const insuredValueCents = 100_000_000; // $1M — keeps rounding exact
    const expectedSurcharge: Record<RiskTier, number> = {
      healthy: 0,
      monitor: 10,
      elevated: 30,
      high: 70,
      critical: 150,
    };
    for (const [riskTier, surcharge] of Object.entries(expectedSurcharge)) {
      const q = quotePremium({
        tier: "standard",
        insuredValueCents,
        riskTier: riskTier as RiskTier,
        cannotDispatch: false,
      });
      expect(q.riskSurchargeBps).toBe(surcharge);
      expect(q.baseRateBps).toBe(INSURANCE_TIERS.standard.premiumRateBps);
      const effective = INSURANCE_TIERS.standard.premiumRateBps + surcharge;
      expect(q.monthlyPremiumCents).toBe(
        (insuredValueCents * effective) / 10_000,
      );
    }
  });

  it("makes Comprehensive unavailable for an aircraft past hard limits", () => {
    const q = quotePremium({
      tier: "comprehensive",
      insuredValueCents: 50_000_000,
      riskTier: "critical",
      cannotDispatch: true,
    });
    expect(q.available).toBe(false);
    expect(q.unavailableReason).toMatch(/airworthy/i);
  });

  it("keeps Comprehensive available for an airworthy aircraft", () => {
    const q = quotePremium({
      tier: "comprehensive",
      insuredValueCents: 50_000_000,
      riskTier: "high",
      cannotDispatch: false,
    });
    expect(q.available).toBe(true);
    expect(q.unavailableReason).toBeNull();
  });

  it("leaves Basic and Standard always available even past hard limits", () => {
    for (const tier of ["basic", "standard"] as const) {
      const q = quotePremium({
        tier,
        insuredValueCents: 50_000_000,
        riskTier: "critical",
        cannotDispatch: true,
      });
      expect(q.available).toBe(true);
    }
  });

  it("prices a high-value jet dramatically above a light single", () => {
    const c152 = quotePremium({
      tier: "comprehensive",
      insuredValueCents: 4_000_000, // $40k
      riskTier: "healthy",
      cannotDispatch: false,
    });
    const jet = quotePremium({
      tier: "comprehensive",
      insuredValueCents: 350_000_000, // $3.5M
      riskTier: "healthy",
      cannotDispatch: false,
    });
    expect(jet.monthlyPremiumCents).toBeGreaterThan(
      c152.monthlyPremiumCents * 50,
    );
  });

  it("quoteAllTiers returns one quote per tier", () => {
    const quotes = quoteAllTiers({
      insuredValueCents: 10_000_000,
      riskTier: "monitor",
      cannotDispatch: false,
    });
    expect(quotes.map((q) => q.tier).sort()).toEqual([
      "basic",
      "comprehensive",
      "standard",
    ]);
  });
});
