import { describe, expect, it } from "vitest";
import type { AircraftClass } from "../../clients/types.js";
import {
  computeJobFit,
  pickRecommendedJobId,
  type FitAirport,
  type FitOwnedAircraft,
  type FitRentalAircraft,
  type JobFit,
  type JobFitContext,
  type RecommendInput,
} from "../fit.js";

const SEP_ONLY: Record<AircraftClass, boolean> = {
  SEP: true,
  MEP: false,
  SET: false,
  JET: false,
};

// CYHZ ↔ CYAW ≈ 8 nm, CYHZ ↔ CYQM ≈ 142 nm, CYHZ ↔ CYYT ≈ 471 nm.
const AIRPORTS = new Map<string, FitAirport>([
  ["CYHZ", { lat: 44.8808, lon: -63.5086, hasPavedRunway: true }],
  ["CYAW", { lat: 44.6336, lon: -63.4994, hasPavedRunway: true }],
  ["CYQM", { lat: 46.1122, lon: -64.6786, hasPavedRunway: true }],
  ["CYYT", { lat: 47.6186, lon: -52.7519, hasPavedRunway: true }],
  ["DIRT", { lat: 45.0, lon: -65.0, hasPavedRunway: false }],
]);

const C172: FitOwnedAircraft = {
  aircraftTypeId: "c172",
  currentLocationIcao: "CYHZ",
  cls: "SEP",
  rangeNm: 640,
  cruiseSpeedKts: 122,
  maxPayloadLbs: 880,
  unpavedCapable: false,
  isAvailable: true,
};

const BONANZA_RENTAL: FitRentalAircraft = {
  aircraftTypeId: "bonanza_g36",
  cls: "SEP",
  rangeNm: 900,
  cruiseSpeedKts: 165,
  maxPayloadLbs: 1100,
  unpavedCapable: false,
};

function ctx(over: Partial<JobFitContext> = {}): JobFitContext {
  return {
    playerLocationIcao: "CYHZ",
    playerRatings: SEP_ONLY,
    ownedAircraft: [],
    rentalsAtPlayerLocation: [],
    airports: AIRPORTS,
    ...over,
  };
}

const JOB_SHORTHOP = {
  originIcao: "CYHZ",
  destinationIcao: "CYAW",
  distanceNm: 8,
  payloadLbs: 140,
  requiredClass: "SEP" as AircraftClass,
  requiredCapabilities: [] as string[],
  pay: 64000, // $640
};

describe("computeJobFit", () => {
  it("ready when owned aircraft is at origin and fits everything", () => {
    const r = computeJobFit(JOB_SHORTHOP, ctx({ ownedAircraft: [C172] }));
    expect(r.status).toBe("ready");
    expect(r.bestAircraftTypeId).toBe("c172");
    expect(r.payHourCents).toBeGreaterThan(0);
    expect(r.positioningDistanceNm).toBeNull();
  });

  it("ready when rental at player location can cover the job", () => {
    const r = computeJobFit(
      JOB_SHORTHOP,
      ctx({ rentalsAtPlayerLocation: [BONANZA_RENTAL] }),
    );
    expect(r.status).toBe("ready");
    expect(r.bestAircraftTypeId).toBe("bonanza_g36");
  });

  it("wont_fit when payload exceeds the only available aircraft", () => {
    const heavy = { ...JOB_SHORTHOP, payloadLbs: 1100 };
    const r = computeJobFit(heavy, ctx({ ownedAircraft: [C172] }));
    expect(r.status).toBe("wont_fit");
    expect(r.reason).toMatch(/Payload \+220 lb/);
  });

  it("wont_fit when range is short", () => {
    const long = { ...JOB_SHORTHOP, destinationIcao: "CYYT", distanceNm: 471 };
    const tiny = { ...C172, rangeNm: 300 };
    const r = computeJobFit(long, ctx({ ownedAircraft: [tiny] }));
    expect(r.status).toBe("wont_fit");
    expect(r.reason).toMatch(/Range short/);
  });

  it("locked when player has no rating for required class", () => {
    const setJob = { ...JOB_SHORTHOP, requiredClass: "SET" as AircraftClass };
    const r = computeJobFit(setJob, ctx({ ownedAircraft: [C172] }));
    expect(r.status).toBe("locked");
    expect(r.reason).toMatch(/SET rating/);
  });

  it("reposition when player must ferry to origin in their owned aircraft", () => {
    const remote = { ...JOB_SHORTHOP, originIcao: "CYQM", destinationIcao: "CYHZ", distanceNm: 142 };
    const r = computeJobFit(remote, ctx({ ownedAircraft: [C172] }));
    expect(r.status).toBe("reposition");
    expect(r.positioningDistanceNm).toBeGreaterThan(50);
    expect(r.positioningDistanceNm).toBeLessThan(200);
  });

  it("requires unpaved-capable when an endpoint is unpaved", () => {
    const dirty = { ...JOB_SHORTHOP, destinationIcao: "DIRT", distanceNm: 90 };
    const r = computeJobFit(dirty, ctx({ ownedAircraft: [C172] }));
    expect(r.status).toBe("wont_fit");
    expect(r.reason).toMatch(/unpaved/);
  });

  it("uses cruise speed to compute pay/hour", () => {
    // 8 nm at 122 kts = ~3.9 minutes = ~0.065 hr. Floor is 0.1 hr in the
    // implementation, so payHour = 64000 / 0.1 = 640000 cents.
    const r = computeJobFit(JOB_SHORTHOP, ctx({ ownedAircraft: [C172] }));
    expect(r.payHourCents).toBe(640000);
  });
});

describe("pickRecommendedJobId", () => {
  const simNow = Date.UTC(2026, 0, 1);
  const safeExpiry = simNow + 4 * 60 * 60 * 1000;

  function readyAt(id: number, origin: string, payHour: number): RecommendInput {
    return {
      id,
      originIcao: origin,
      expiresAt: safeExpiry,
      weatherSensitivity: "none",
      fit: {
        status: "ready",
        reason: "ok",
        bestAircraftTypeId: "c172",
        bestCruiseSpeedKts: 122,
        positioningDistanceNm: null,
        payHourCents: payHour,
      } as JobFit,
    };
  }

  it("returns the highest pay/hour ready job at player location", () => {
    const id = pickRecommendedJobId(
      [readyAt(1, "CYHZ", 300_000), readyAt(2, "CYHZ", 600_000), readyAt(3, "CYHZ", 450_000)],
      { playerLocationIcao: "CYHZ", simNow },
    );
    expect(id).toBe(2);
  });

  it("skips ready jobs whose origin isn't the player's location", () => {
    const id = pickRecommendedJobId(
      [readyAt(1, "CYQM", 900_000), readyAt(2, "CYHZ", 500_000)],
      { playerLocationIcao: "CYHZ", simNow },
    );
    expect(id).toBe(2);
  });

  it("skips ready jobs expiring within an hour", () => {
    const aboutToExpire = { ...readyAt(1, "CYHZ", 999_999), expiresAt: simNow + 30 * 60 * 1000 };
    const id = pickRecommendedJobId([aboutToExpire, readyAt(2, "CYHZ", 100_000)], {
      playerLocationIcao: "CYHZ",
      simNow,
    });
    expect(id).toBe(2);
  });

  it("returns null when nothing qualifies", () => {
    const id = pickRecommendedJobId([], { playerLocationIcao: "CYHZ", simNow });
    expect(id).toBeNull();
  });
});
