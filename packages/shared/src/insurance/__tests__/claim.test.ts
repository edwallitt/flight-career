import { describe, expect, it } from "vitest";
import { resolveClaim } from "../claim.js";
import { INSURANCE_TIERS } from "../tiers.js";

describe("resolveClaim", () => {
  it("uninsured: player pays everything", () => {
    const o = resolveClaim({
      policyTier: null,
      eventSeverity: "severe",
      eventCostCents: 4_200_00,
    });
    expect(o.covered).toBe(false);
    expect(o.policyTier).toBeNull();
    expect(o.insurerPaidCents).toBe(0);
    expect(o.playerPaidCents).toBe(4_200_00);
    expect(o.reason).toMatch(/uninsured/i);
  });

  it("severity not covered by the tier: player pays everything", () => {
    const o = resolveClaim({
      policyTier: "basic", // covers severe only
      eventSeverity: "light",
      eventCostCents: 120_00,
    });
    expect(o.covered).toBe(false);
    expect(o.policyTier).toBe("basic");
    expect(o.insurerPaidCents).toBe(0);
    expect(o.playerPaidCents).toBe(120_00);
    expect(o.reason).toMatch(/Basic cover does not include light failures/);
  });

  it("covered normal case: player pays deductible, insurer pays the rest", () => {
    const o = resolveClaim({
      policyTier: "standard", // $2,000 deductible
      eventSeverity: "moderate",
      eventCostCents: 420_000, // $4,200
    });
    expect(o.covered).toBe(true);
    expect(o.deductibleCents).toBe(200_000);
    expect(o.playerPaidCents).toBe(200_000);
    expect(o.insurerPaidCents).toBe(220_000);
    expect(o.fullEventCostCents).toBe(420_000);
    expect(o.playerPaidCents + o.insurerPaidCents).toBe(o.fullEventCostCents);
  });

  it("covered but exceeding the per-claim ceiling: player pays deductible + excess", () => {
    const spec = INSURANCE_TIERS.basic; // $5k deductible, $50k ceiling
    const fullCost = 8_000_000; // $80k
    const o = resolveClaim({
      policyTier: "basic",
      eventSeverity: "severe",
      eventCostCents: fullCost,
    });
    const aboveDeductible = fullCost - spec.deductibleCents; // $75k
    const excess = aboveDeductible - spec.perClaimCeilingCents; // $25k
    expect(o.covered).toBe(true);
    expect(o.insurerPaidCents).toBe(spec.perClaimCeilingCents);
    expect(o.playerPaidCents).toBe(spec.deductibleCents + excess);
    expect(o.playerPaidCents + o.insurerPaidCents).toBe(fullCost);
    expect(o.reason).toMatch(/excess/);
  });

  it("covered but cost fell under the deductible: player pays small full cost, insurer pays nothing", () => {
    const o = resolveClaim({
      policyTier: "standard", // $2,000 deductible
      eventSeverity: "moderate",
      eventCostCents: 150_00, // $150 < deductible
    });
    expect(o.covered).toBe(true);
    expect(o.insurerPaidCents).toBe(0);
    expect(o.playerPaidCents).toBe(150_00);
    expect(o.reason).toMatch(/under the \$2,000 deductible/);
  });

  it("comprehensive covers light events", () => {
    const o = resolveClaim({
      policyTier: "comprehensive",
      eventSeverity: "light",
      eventCostCents: 90_000, // $900, above the $500 deductible
    });
    expect(o.covered).toBe(true);
    expect(o.deductibleCents).toBe(50_000);
    expect(o.insurerPaidCents).toBe(40_000);
    expect(o.playerPaidCents).toBe(50_000);
  });
});
