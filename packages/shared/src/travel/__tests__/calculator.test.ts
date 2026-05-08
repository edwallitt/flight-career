import { describe, expect, it } from "vitest";
import { calculateTransfer } from "../calculator.js";

describe("calculateTransfer — pilot", () => {
  it("is cheaper between two majors than between two regionals", () => {
    const major = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 500,
      originSize: "major",
      destinationSize: "major",
    });
    const regional = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 500,
      originSize: "regional",
      destinationSize: "regional",
    });
    expect(major.costCents).toBeLessThan(regional.costCents);
  });

  it("applies a 50% premium to a remote destination", () => {
    const baseline = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      distanceNm: 200,
      originSize: "regional",
      destinationSize: "regional",
    });
    const remote = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      distanceNm: 200,
      originSize: "regional",
      destinationSize: "remote",
    });
    expect(remote.costCents).toBe(Math.round(baseline.costCents * 1.5 / 100) * 100);
  });

  it("enforces a 180-minute floor at the 50nm short-hop boundary", () => {
    const short = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      distanceNm: 50,
      originSize: "regional",
      destinationSize: "regional",
    });
    expect(short.durationMinutes).toBe(180);
  });

  it("uses a 30-minute floor for sub-50nm taxis", () => {
    const taxi = calculateTransfer({
      type: "pilot",
      originIcao: "CYAW",
      destinationIcao: "CYHZ",
      distanceNm: 14,
      originSize: "small",
      destinationSize: "regional",
    });
    expect(taxi.durationMinutes).toBe(30);
  });

  it("halves the small-field surcharge on sub-50nm hops", () => {
    const taxi = calculateTransfer({
      type: "pilot",
      originIcao: "CYAW",
      destinationIcao: "CYHZ",
      distanceNm: 14,
      originSize: "small",
      destinationSize: "regional",
    });
    const longHop = calculateTransfer({
      type: "pilot",
      originIcao: "CYAW",
      destinationIcao: "CYQM",
      distanceNm: 80,
      originSize: "small",
      destinationSize: "regional",
    });
    // Same baseline structure but distance differs; verify the 1.25× vs 1.5×
    // multiplier shows up by reconstructing the unmultiplied base and
    // checking the implied multiplier on each.
    const taxiBase = 80 * 14 + 5_000; // cents per nm + base
    const longBase = 80 * 80 + 5_000;
    expect(taxi.costCents / taxiBase).toBeCloseTo(1.25, 1);
    expect(longHop.costCents / longBase).toBeCloseTo(1.5, 1);
  });

  it("scales duration with distance once over the floor", () => {
    const long = calculateTransfer({
      type: "pilot",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 800,
      originSize: "regional",
      destinationSize: "regional",
    });
    expect(long.durationMinutes).toBe(Math.round(800 * 0.6));
  });
});

describe("calculateTransfer — pilot_aircraft", () => {
  it("computes block time correctly: 400nm at 268kts ≈ 1.49 hours", () => {
    const r = calculateTransfer({
      type: "pilot_aircraft",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 400,
      aircraftCruiseSpeedKts: 268,
      aircraftFuelBurnGph: 65,
      aircraftClass: "SET",
      destinationFuelPriceCents: 550,
      destinationLandingFeeCents: 5000,
    });
    expect(r.aircraftHoursAccrued).toBeCloseTo(1.49, 2);
    expect(r.durationMinutes).toBe(Math.round(1.49 * 60));
  });

  it("returns a reasonable cost for a TBM 930 over 400nm ($1500–$2500 range)", () => {
    const r = calculateTransfer({
      type: "pilot_aircraft",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 400,
      aircraftCruiseSpeedKts: 268,
      aircraftFuelBurnGph: 65,
      aircraftClass: "SET",
      destinationFuelPriceCents: 600,
      destinationLandingFeeCents: 8000,
    });
    expect(r.costCents).toBeGreaterThanOrEqual(140_000);
    expect(r.costCents).toBeLessThanOrEqual(250_000);
  });

  it("uses destinationFuelPriceCents to compute fuel cost", () => {
    const cheap = calculateTransfer({
      type: "pilot_aircraft",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 400,
      aircraftCruiseSpeedKts: 268,
      aircraftFuelBurnGph: 65,
      aircraftClass: "SET",
      destinationFuelPriceCents: 400,
      destinationLandingFeeCents: 5000,
    });
    const expensive = calculateTransfer({
      type: "pilot_aircraft",
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 400,
      aircraftCruiseSpeedKts: 268,
      aircraftFuelBurnGph: 65,
      aircraftClass: "SET",
      destinationFuelPriceCents: 800,
      destinationLandingFeeCents: 5000,
    });
    expect(expensive.costCents).toBeGreaterThan(cheap.costCents);
  });
});

describe("calculateTransfer — aircraft", () => {
  it("includes a $300 surcharge over the equivalent pilot_aircraft transfer", () => {
    const params = {
      originIcao: "CYHZ",
      destinationIcao: "CYYZ",
      distanceNm: 400,
      aircraftCruiseSpeedKts: 268,
      aircraftFuelBurnGph: 65,
      aircraftClass: "SET" as const,
      destinationFuelPriceCents: 550,
      destinationLandingFeeCents: 5000,
    };
    const both = calculateTransfer({ type: "pilot_aircraft", ...params });
    const aircraftOnly = calculateTransfer({ type: "aircraft", ...params });
    expect(aircraftOnly.costCents - both.costCents).toBe(30_000);
  });
});
