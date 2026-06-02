import { describe, expect, it } from "vitest";
import {
  applyCancellationPerk,
  cancellationPenaltyFactorForScore,
  jobFrequencyMultiplierForScore,
  loyaltyBonusForScore,
  reputationPerksForTier,
  reputationTier,
} from "../reputation.js";

describe("reputationTier", () => {
  it("maps scores to tiers at the 25/60/85 thresholds", () => {
    expect(reputationTier(0)).toBe("novice");
    expect(reputationTier(24)).toBe("novice");
    expect(reputationTier(25)).toBe("mid");
    expect(reputationTier(59)).toBe("mid");
    expect(reputationTier(60)).toBe("high");
    expect(reputationTier(84)).toBe("high");
    expect(reputationTier(85)).toBe("top");
    expect(reputationTier(100)).toBe("top");
  });
});

describe("loyaltyBonusForScore", () => {
  it("grants +0 / +10% / +20% / +30% by tier", () => {
    expect(loyaltyBonusForScore(10)).toBe(0);
    expect(loyaltyBonusForScore(25)).toBe(0.1);
    expect(loyaltyBonusForScore(60)).toBe(0.2);
    expect(loyaltyBonusForScore(85)).toBe(0.3);
  });
});

describe("jobFrequencyMultiplierForScore", () => {
  it("boosts frequency only at High+ standing", () => {
    expect(jobFrequencyMultiplierForScore(24)).toBe(1);
    expect(jobFrequencyMultiplierForScore(25)).toBe(1);
    expect(jobFrequencyMultiplierForScore(60)).toBe(1.5);
    expect(jobFrequencyMultiplierForScore(85)).toBe(1.5);
  });
});

describe("cancellation forgiveness", () => {
  it("halves the factor only at High+ standing", () => {
    expect(cancellationPenaltyFactorForScore(59)).toBe(1);
    expect(cancellationPenaltyFactorForScore(60)).toBe(0.5);
    expect(cancellationPenaltyFactorForScore(85)).toBe(0.5);
  });

  it("halves the client penalty but never the role penalty", () => {
    // Novice: untouched.
    expect(applyCancellationPerk({ role: -5, client: -8 }, 10)).toEqual({
      role: -5,
      client: -8,
    });
    // High: client halved, role intact.
    expect(applyCancellationPerk({ role: -5, client: -8 }, 60)).toEqual({
      role: -5,
      client: -4,
    });
    // Top: client halved (rounded), role intact.
    expect(applyCancellationPerk({ role: -8, client: -12 }, 85)).toEqual({
      role: -8,
      client: -6,
    });
  });
});

describe("reputationPerksForTier", () => {
  it("lists the perks each tier unlocks", () => {
    expect(reputationPerksForTier("novice")).toEqual([]);
    expect(reputationPerksForTier("mid")).toEqual(["+10% pay"]);
    expect(reputationPerksForTier("high")).toEqual([
      "+20% pay",
      "priority work",
      "lighter cancel penalty",
    ]);
    expect(reputationPerksForTier("top")).toEqual([
      "+30% pay",
      "priority work",
      "lighter cancel penalty",
    ]);
  });
});
