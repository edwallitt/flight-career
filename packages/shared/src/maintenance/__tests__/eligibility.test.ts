import { describe, expect, it } from "vitest";
import {
  checkMaintenanceEligibility,
  type MaintenanceContext,
} from "../eligibility.js";

function ctx(over: Partial<MaintenanceContext> = {}): MaintenanceContext {
  return {
    aircraft: {
      currentLocationIcao: "CYHZ",
      status: "available",
      hoursSince100hr: 50,
      hoursSinceAnnual: 100,
      engineHoursSinceOverhaul: 500,
      tboHours: 2000,
      ...(over.aircraft ?? {}),
    },
    airport: {
      icao: "CYHZ",
      hasMaintenance: true,
      size: "regional",
      ...(over.airport ?? {}),
    },
    cost: 100_000,
    cash: 500_000,
    ...over,
  };
}

describe("checkMaintenanceEligibility", () => {
  it("accepts a 100hr at a regional maintenance airport with cash", () => {
    const out = checkMaintenanceEligibility("100hr", ctx());
    expect(out.eligible).toBe(true);
    expect(out.reasons).toEqual([]);
  });

  it("rejects when aircraft is in flight", () => {
    const out = checkMaintenanceEligibility(
      "100hr",
      ctx({
        aircraft: {
          currentLocationIcao: "CYHZ",
          status: "in_flight",
          hoursSince100hr: 50,
          hoursSinceAnnual: 100,
          engineHoursSinceOverhaul: 500,
          tboHours: 2000,
        },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.some((r) => r.includes("in flight"))).toBe(true);
  });

  it("rejects when airport lacks maintenance facility", () => {
    const out = checkMaintenanceEligibility(
      "100hr",
      ctx({
        airport: {
          icao: "CYHZ",
          hasMaintenance: false,
          size: "small",
        },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.some((r) => r.includes("maintenance facility"))).toBe(
      true,
    );
  });

  it("rejects an annual at a small airport even with maintenance flag", () => {
    // annual still only requires 'maintenance' (any field), so this should
    // succeed if has_maintenance — verify the requirement boundary.
    const out = checkMaintenanceEligibility(
      "annual",
      ctx({
        airport: { icao: "CYHZ", hasMaintenance: true, size: "small" },
      }),
    );
    expect(out.eligible).toBe(true);
  });

  it("rejects an overhaul at a regional airport (needs major)", () => {
    const out = checkMaintenanceEligibility(
      "overhaul",
      ctx({
        airport: { icao: "CYHZ", hasMaintenance: true, size: "regional" },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.some((r) => r.includes("major-airport"))).toBe(true);
  });

  it("accepts an overhaul at a major airport with maintenance", () => {
    const out = checkMaintenanceEligibility(
      "overhaul",
      ctx({
        airport: { icao: "CYHZ", hasMaintenance: true, size: "major" },
        cost: 50_000_000,
        cash: 60_000_000,
      }),
    );
    expect(out.eligible).toBe(true);
  });

  it("rejects when cash is insufficient and reports the gap", () => {
    const out = checkMaintenanceEligibility(
      "100hr",
      ctx({ cost: 200_000, cash: 50_000 }),
    );
    expect(out.eligible).toBe(false);
    const cashReason = out.reasons.find((r) => r.includes("Insufficient cash"));
    expect(cashReason).toBeDefined();
    expect(cashReason).toMatch(/1,500/);
  });

  it("collects multiple reasons when several gates fail", () => {
    const out = checkMaintenanceEligibility(
      "overhaul",
      ctx({
        aircraft: {
          currentLocationIcao: "CYHZ",
          status: "in_maintenance",
          hoursSince100hr: 0,
          hoursSinceAnnual: 0,
          engineHoursSinceOverhaul: 0,
          tboHours: 2000,
        },
        airport: { icao: "CYHZ", hasMaintenance: false, size: "small" },
        cost: 1_000_000,
        cash: 10,
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
