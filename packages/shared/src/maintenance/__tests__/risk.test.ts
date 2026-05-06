import { describe, expect, it } from "vitest";
import { assessRisk, type RiskInputs } from "../risk.js";

function inputs(over: Partial<RiskInputs> = {}): RiskInputs {
  return {
    hoursSince100hr: 50,
    hoursSinceAnnual: 100,
    engineHoursSinceOverhaul: 500,
    tboHours: 2000,
    airframeHours: 1200,
    ...over,
  };
}

describe("assessRisk", () => {
  it("rates a fully fresh aircraft as healthy with no factors", () => {
    const r = assessRisk(inputs());
    expect(r.tier).toBe("healthy");
    expect(r.factors).toEqual([]);
    expect(r.cannotDispatch).toBe(false);
    expect(r.probabilityPerFlightHour).toBeCloseTo(0.005, 6);
  });

  it("flags 100hr overdue and escalates the tier", () => {
    const r = assessRisk(inputs({ hoursSince100hr: 115 }));
    expect(r.factors.find((f) => f.factor === "hours_since_100hr")).toBeTruthy();
    expect(r.factors[0]!.description).toMatch(/100-hour inspection overdue by 15 hours/);
    expect(r.tier === "elevated" || r.tier === "high").toBe(true);
    expect(r.cannotDispatch).toBe(false);
  });

  it("flags engine 5% past TBO without grounding", () => {
    const r = assessRisk(
      inputs({ engineHoursSinceOverhaul: 2100, tboHours: 2000 }),
    );
    const f = r.factors.find((x) => x.factor === "engine_tbo_ratio");
    expect(f).toBeTruthy();
    expect(f!.description).toMatch(/Engine at 105% of TBO/);
    expect(r.cannotDispatch).toBe(false);
  });

  it("hard-blocks when engine is 15% past TBO", () => {
    const r = assessRisk(
      inputs({ engineHoursSinceOverhaul: 2300, tboHours: 2000 }),
    );
    expect(r.cannotDispatch).toBe(true);
    expect(r.cannotDispatchReason).toMatch(/Engine over 10% past TBO/);
  });

  it("hard-blocks when annual is over 18 months overdue", () => {
    const r = assessRisk(inputs({ hoursSinceAnnual: 365 + 19 * 30 }));
    expect(r.cannotDispatch).toBe(true);
    expect(r.cannotDispatchReason).toMatch(/Annual inspection over 18 months overdue/);
  });

  it("compounds multiple factors into a higher tier", () => {
    const stacked = assessRisk(
      inputs({
        hoursSince100hr: 125,
        hoursSinceAnnual: 365 + 60,
        engineHoursSinceOverhaul: 1900,
        tboHours: 2000,
      }),
    );
    expect(stacked.factors.length).toBeGreaterThanOrEqual(3);
    const single = assessRisk(inputs({ hoursSince100hr: 125 }));
    expect(stacked.probabilityPerFlightHour).toBeGreaterThan(
      single.probabilityPerFlightHour,
    );
    expect(["high", "critical"]).toContain(stacked.tier);
  });

  it("caps probability at 50% even with extreme inputs", () => {
    const r = assessRisk(
      inputs({
        hoursSince100hr: 500,
        hoursSinceAnnual: 365 + 17 * 30,
        engineHoursSinceOverhaul: 2150,
        tboHours: 2000,
        airframeHours: 15000,
      }),
    );
    expect(r.probabilityPerFlightHour).toBeLessThanOrEqual(0.5);
    expect(r.tier).toBe("critical");
  });
});
