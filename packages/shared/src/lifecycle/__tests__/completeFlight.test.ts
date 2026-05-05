import { describe, expect, it } from "vitest";
import {
  completeFlight,
  type CompleteFlightInput,
} from "../completeFlight.js";

function baseInput(overrides: Partial<CompleteFlightInput> = {}): CompleteFlightInput {
  return {
    jobId: 1,
    clientId: "northern_outfitters",
    role: "bush",
    jobOriginIcao: "CYHZ",
    jobDestinationIcao: "CYYR",
    jobPay: 500_000, // $5,000
    jobLatestDeparture: null,
    jobUrgency: "standard",
    weatherSensitivity: "none",

    aircraftSource: "rental",
    aircraftTypeId: "c208",
    aircraftClass: "SET",
    ownedAircraftId: null,
    rentalRatePerHourCents: 75_000, // $750/hr
    fuelBurnGph: 40,
    cruiseSpeedKts: 180,

    actualOriginIcao: "CYHZ",
    actualDestinationIcao: "CYYR",
    startedAt: 0,
    endedAt: 90 * 60 * 1000,
    blockTimeMinutes: 90,
    fuelBurnedGal: 60,
    briefedFuelCostCents: 81_200, // $812
    refuelAtDestination: false,
    destinationFuelPriceCents: 0,

    destinationLandingFeeCents: 8_000, // $80
    isDiversion: false,
    divertedDistanceFromTargetNm: 0,
    ...overrides,
  };
}

describe("completeFlight", () => {
  it("successful on-time client delivery (rental)", () => {
    const out = completeFlight(baseInput());

    expect(out.finalPay).toBe(500_000);
    expect(out.diversionAdjustment).toBe(0);

    expect(out.destinationLandingFee).toBe(8_000);
    expect(out.rentalCost).toBe(112_500); // 1.5 × 75_000
    expect(out.destinationRefuelCost).toBe(0);

    expect(out.netCashDelta).toBe(500_000 - 8_000 - 112_500);
    expect(out.totalCosts).toBe(81_200 + 8_000 + 112_500);
    expect(out.grossRevenue).toBe(500_000);

    // Standard urgency, on-time → role bush +2, client +3 (bare role scope)
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 2 },
      { scope: "client:northern_outfitters", delta: 3 },
    ]);

    expect(out.aircraftUpdates).toBeNull();
    expect(out.newLocationIcao).toBe("CYYR");

    expect(out.flightLogEntry.notes).toBeNull();
    expect(out.flightLogEntry.fuelBurnedGal).toBe(60);
    expect(out.flightLogEntry.originIcao).toBe("CYHZ");
    expect(out.flightLogEntry.destinationIcao).toBe("CYYR");

    expect(out.summaryLines.some((s) => s.includes("Delivered on time"))).toBe(true);
    expect(out.summaryLines.some((s) => s.includes("Rental:"))).toBe(true);
    expect(out.summaryLines.some((s) => s.includes("Bush +2"))).toBe(true);
  });

  it("urgent on-time delivery yields larger reputation gains", () => {
    const out = completeFlight(baseInput({ jobUrgency: "urgent" }));
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 3 },
      { scope: "client:northern_outfitters", delta: 5 },
    ]);
  });

  it("critical on-time delivery yields max reputation gains", () => {
    const out = completeFlight(baseInput({ jobUrgency: "critical" }));
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 4 },
      { scope: "client:northern_outfitters", delta: 6 },
    ]);
  });

  it("flexible on-time delivery yields smaller reputation gains", () => {
    const out = completeFlight(baseInput({ jobUrgency: "flexible" }));
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 1 },
      { scope: "client:northern_outfitters", delta: 2 },
    ]);
  });

  it("open-market job: no reputation deltas at all", () => {
    const out = completeFlight(
      baseInput({ role: "open", clientId: null }),
    );
    expect(out.reputationDeltas).toEqual([]);
  });

  it("open-market job, even on diversion failure: still no reputation deltas", () => {
    const out = completeFlight(
      baseInput({
        role: "open",
        clientId: null,
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 200,
      }),
    );
    expect(out.reputationDeltas).toEqual([]);
    expect(out.finalPay).toBe(0);
  });

  it("diversion within 50nm: 90% pay, slight rep adjustment", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 30,
      }),
    );

    expect(out.finalPay).toBe(450_000);
    expect(out.diversionAdjustment).toBe(-50_000);

    // Standard urgency, near diversion: role +1, client +1
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 1 },
      { scope: "client:northern_outfitters", delta: 1 },
    ]);

    expect(out.flightLogEntry.notes).toContain("Diversion");
    expect(out.flightLogEntry.notes).toContain("30nm");
    expect(out.newLocationIcao).toBe("CYDF");
  });

  it("diversion 100nm: half pay, negative client rep, no role delta emitted", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 100,
      }),
    );

    expect(out.finalPay).toBe(250_000);
    expect(out.diversionAdjustment).toBe(-250_000);

    // Far diversion, standard: role 0 (suppressed), client -2
    expect(out.reputationDeltas).toEqual([
      { scope: "client:northern_outfitters", delta: -2 },
    ]);
  });

  it("diversion >150nm: zero pay, big negative rep, no Earned line", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 200,
      }),
    );

    expect(out.finalPay).toBe(0);
    expect(out.diversionAdjustment).toBe(-500_000);

    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: -3 },
      { scope: "client:northern_outfitters", delta: -8 },
    ]);

    expect(out.summaryLines.some((s) => s.includes("Failed delivery"))).toBe(true);
    expect(out.summaryLines.some((s) => s.startsWith("Earned "))).toBe(false);
  });

  it("critical urgency >150nm diversion yields the largest negative rep", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 200,
        jobUrgency: "critical",
      }),
    );
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: -3 },
      { scope: "client:northern_outfitters", delta: -15 },
    ]);
  });

  it("critical urgency near diversion: client rep goes negative", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 30,
        jobUrgency: "critical",
      }),
    );
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 1 },
      { scope: "client:northern_outfitters", delta: -1 },
    ]);
  });

  it("flexible near diversion: no rep change at all", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 30,
        jobUrgency: "flexible",
      }),
    );
    expect(out.reputationDeltas).toEqual([]);
  });

  it("flexible failed delivery: softer rep penalty than standard", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 200,
        jobUrgency: "flexible",
      }),
    );
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: -2 },
      { scope: "client:northern_outfitters", delta: -4 },
    ]);
  });

  it("strict weather + diversion: extra -2 client rep penalty", () => {
    const out = completeFlight(
      baseInput({
        isDiversion: true,
        actualDestinationIcao: "CYDF",
        divertedDistanceFromTargetNm: 100,
        weatherSensitivity: "strict",
      }),
    );
    // far diversion standard: client -2; strict adds -2 → -4
    expect(out.reputationDeltas).toEqual([
      { scope: "client:northern_outfitters", delta: -4 },
    ]);
  });

  it("strict weather + on-time landing: no extra penalty", () => {
    const out = completeFlight(
      baseInput({ weatherSensitivity: "strict" }),
    );
    expect(out.reputationDeltas).toEqual([
      { scope: "bush", delta: 2 },
      { scope: "client:northern_outfitters", delta: 3 },
    ]);
  });

  it("owned aircraft without refuel: aircraftUpdates burns fuel down", () => {
    const out = completeFlight(
      baseInput({
        aircraftSource: "owned",
        ownedAircraftId: 42,
        rentalRatePerHourCents: 0,
        refuelAtDestination: false,
        destinationFuelPriceCents: 0,
      }),
    );

    expect(out.rentalCost).toBe(0);
    expect(out.destinationRefuelCost).toBe(0);
    expect(out.aircraftUpdates).not.toBeNull();
    expect(out.aircraftUpdates!.blockHoursAdded).toBe(1.5);
    expect(out.aircraftUpdates!.fuelBurnedGalDelta).toBe(60);
    expect(out.aircraftUpdates!.fuelRefilledGalDelta).toBe(0);
    expect(out.aircraftUpdates!.newLocationIcao).toBe("CYYR");

    expect(out.netCashDelta).toBe(500_000 - 8_000);
  });

  it("owned aircraft with destination refuel: refill matches burn, cost included", () => {
    const out = completeFlight(
      baseInput({
        aircraftSource: "owned",
        ownedAircraftId: 42,
        rentalRatePerHourCents: 0,
        refuelAtDestination: true,
        destinationFuelPriceCents: 700, // $7/gal
      }),
    );

    expect(out.destinationRefuelCost).toBe(42_000); // 60 × 700
    expect(out.aircraftUpdates!.fuelBurnedGalDelta).toBe(60);
    expect(out.aircraftUpdates!.fuelRefilledGalDelta).toBe(60);

    expect(out.netCashDelta).toBe(500_000 - 8_000 - 42_000);
    expect(out.totalCosts).toBe(81_200 + 8_000 + 42_000);
  });

  it("owned aircraft with stray rental rate: rental cost stays zero", () => {
    const out = completeFlight(
      baseInput({
        aircraftSource: "owned",
        ownedAircraftId: 42,
        rentalRatePerHourCents: 75_000, // should be ignored
        refuelAtDestination: false,
        destinationFuelPriceCents: 0,
      }),
    );
    expect(out.rentalCost).toBe(0);
  });

  it("estimates fuel burned from time × gph when not provided", () => {
    const out = completeFlight(
      baseInput({
        fuelBurnedGal: null,
        // 1.5 hrs × 40 gph = 60
      }),
    );
    expect(out.flightLogEntry.fuelBurnedGal).toBe(60);
  });

  it("summary lines reflect outcome details", () => {
    const out = completeFlight(baseInput());
    const text = out.summaryLines.join("\n");
    expect(text).toContain("Delivered on time at CYYR");
    expect(text).toContain("Earned $5,000");
    expect(text).toContain("Fuel: $812 (paid pre-flight)");
    expect(text).toContain("Landing fee: $80");
    expect(text).toContain("Rental: $1,125");
    expect(text).toContain("Net: +$3,795");
    expect(text).toContain("Bush +2");
    expect(text).toContain("northern_outfitters +3");
  });

  it("is deterministic (same input → same output)", () => {
    const a = completeFlight(baseInput());
    const b = completeFlight(baseInput());
    expect(a).toEqual(b);
  });
});
