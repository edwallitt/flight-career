import { describe, expect, it } from "vitest";
import {
  BROKER_SPREAD_BPS,
  checkSaleEligibility,
  estimateSale,
} from "../sale.js";

const TYPE = { basePurchasePriceCents: 50_000_000, tboHours: 2000 };
const HEALTHY = {
  airframeHours: 200,
  engineHoursSinceOverhaul: 200,
  hoursSince100hr: 10,
  hoursSinceAnnual: 30,
};

describe("estimateSale", () => {
  it("nets ~88% of value when there is no loan", () => {
    const e = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: null,
    });
    expect(e.brokerSpreadBps).toBe(BROKER_SPREAD_BPS);
    expect(e.grossSaleCents).toBe(
      e.estimatedValueCents - e.brokerSpreadCents,
    );
    expect(e.loanPayoffCents).toBe(0);
    expect(e.netToPlayerCents).toBe(e.grossSaleCents);
    expect(e.underwater).toBe(false);
    // Spread is 12% so net is roughly 88% of value.
    expect(e.netToPlayerCents).toBeGreaterThan(
      Math.round(e.estimatedValueCents * 0.86),
    );
    expect(e.netToPlayerCents).toBeLessThan(
      Math.round(e.estimatedValueCents * 0.9),
    );
  });

  it("treats a paid-off loan the same as no loan", () => {
    const e = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: { remainingBalanceCents: 0 },
    });
    expect(e.loanPayoffCents).toBe(0);
    expect(e.netToPlayerCents).toBe(e.grossSaleCents);
    expect(e.underwater).toBe(false);
  });

  it("subtracts loan payoff from gross when loan is small", () => {
    const e = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: { remainingBalanceCents: 5_000_000 },
    });
    expect(e.loanPayoffCents).toBe(5_000_000);
    expect(e.netToPlayerCents).toBe(e.grossSaleCents - 5_000_000);
    expect(e.netToPlayerCents).toBeGreaterThan(0);
    expect(e.underwater).toBe(false);
  });

  it("flags underwater when loan exceeds gross sale", () => {
    const e = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: { remainingBalanceCents: 90_000_000 },
    });
    expect(e.netToPlayerCents).toBeLessThan(0);
    expect(e.underwater).toBe(true);
  });

  it("never produces negative gross or broker spread", () => {
    const e = estimateSale({
      aircraftType: { basePurchasePriceCents: 100_000, tboHours: 2000 },
      aircraft: HEALTHY,
      loan: null,
    });
    expect(e.brokerSpreadCents).toBeGreaterThanOrEqual(0);
    expect(e.grossSaleCents).toBeGreaterThanOrEqual(0);
  });
});

describe("checkSaleEligibility", () => {
  const baseEstimate = estimateSale({
    aircraftType: TYPE,
    aircraft: HEALTHY,
    loan: null,
  });

  it("passes for available aircraft at maintenance-capable airport", () => {
    const r = checkSaleEligibility(
      {
        aircraft: { status: "available", currentLocationIcao: "EGLL" },
        airport: { icao: "EGLL", hasMaintenance: true },
        loan: null,
        cash: 1_000_000,
      },
      baseEstimate,
    );
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("rejects when aircraft is in flight", () => {
    const r = checkSaleEligibility(
      {
        aircraft: { status: "in_flight", currentLocationIcao: "EGLL" },
        airport: { icao: "EGLL", hasMaintenance: true },
        loan: null,
        cash: 1_000_000,
      },
      baseEstimate,
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/in flight/);
  });

  it("rejects when airport lacks maintenance", () => {
    const r = checkSaleEligibility(
      {
        aircraft: { status: "available", currentLocationIcao: "X07" },
        airport: { icao: "X07", hasMaintenance: false },
        loan: null,
        cash: 1_000_000,
      },
      baseEstimate,
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/maintenance-capable/i);
  });

  it("rejects underwater sale when cash can't cover shortfall", () => {
    const underwater = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: { remainingBalanceCents: 90_000_000 },
    });
    const r = checkSaleEligibility(
      {
        aircraft: { status: "available", currentLocationIcao: "EGLL" },
        airport: { icao: "EGLL", hasMaintenance: true },
        loan: { remainingBalanceCents: 90_000_000 },
        cash: 100,
      },
      underwater,
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((m) => /Insufficient cash/.test(m))).toBe(true);
  });

  it("permits underwater sale when cash can cover shortfall", () => {
    const underwater = estimateSale({
      aircraftType: TYPE,
      aircraft: HEALTHY,
      loan: { remainingBalanceCents: 90_000_000 },
    });
    const r = checkSaleEligibility(
      {
        aircraft: { status: "available", currentLocationIcao: "EGLL" },
        airport: { icao: "EGLL", hasMaintenance: true },
        loan: { remainingBalanceCents: 90_000_000 },
        cash: 100_000_000,
      },
      underwater,
    );
    expect(r.eligible).toBe(true);
  });
});
