import { describe, expect, it } from "vitest";
import type { AircraftClass } from "../../clients/types.js";
import { computeReachability, type ReachabilityContext } from "../reachability.js";

const ALL_RATED: Record<AircraftClass, boolean> = {
  SEP: true,
  MEP: true,
  SET: true,
  JET: true,
};

const SEP_ONLY: Record<AircraftClass, boolean> = {
  SEP: true,
  MEP: false,
  SET: false,
  JET: false,
};

// CYHZ ↔ CYQM ≈ 142 nm; CYHZ ↔ CYYT ≈ 471 nm
const AIRPORTS = new Map<string, { lat: number; lon: number }>([
  ["CYHZ", { lat: 44.8808, lon: -63.5086 }],
  ["CYQM", { lat: 46.1122, lon: -64.6786 }],
  ["CYYT", { lat: 47.6186, lon: -52.7519 }],
]);

function ctx(over: Partial<ReachabilityContext> = {}): ReachabilityContext {
  return {
    playerLocationIcao: "CYHZ",
    playerRatings: ALL_RATED,
    ownedAircraft: [],
    rentalsAtPlayerLocation: [],
    airports: AIRPORTS,
    ...over,
  };
}

describe("computeReachability", () => {
  it("returns at_origin when origin matches player location", () => {
    const r = computeReachability(
      { originIcao: "CYHZ", requiredClass: "SEP", requiredCapabilities: [] },
      ctx(),
    );
    expect(r.status).toBe("at_origin");
  });

  it("returns owned_at_origin when player has an available rated aircraft at origin", () => {
    const r = computeReachability(
      { originIcao: "CYQM", requiredClass: "SEP", requiredCapabilities: [] },
      ctx({
        ownedAircraft: [
          {
            aircraftTypeId: "c172",
            currentLocationIcao: "CYQM",
            cls: "SEP",
            rangeNm: 600,
            isAvailable: true,
          },
        ],
      }),
    );
    expect(r.status).toBe("owned_at_origin");
  });

  it("skips owned_at_origin when player is not rated for that class", () => {
    const r = computeReachability(
      { originIcao: "CYQM", requiredClass: "MEP", requiredCapabilities: [] },
      ctx({
        playerRatings: SEP_ONLY,
        ownedAircraft: [
          {
            aircraftTypeId: "baron_g58",
            currentLocationIcao: "CYQM",
            cls: "MEP",
            rangeNm: 1400,
            isAvailable: true,
          },
        ],
      }),
    );
    expect(r.status).toBe("unreachable");
  });

  it("returns reposition_rental when a rental at current location can reach origin", () => {
    const r = computeReachability(
      { originIcao: "CYQM", requiredClass: "SEP", requiredCapabilities: [] },
      ctx({
        rentalsAtPlayerLocation: [
          { aircraftTypeId: "c172", cls: "SEP", rangeNm: 600 },
        ],
      }),
    );
    expect(r.status).toBe("reposition_rental");
    expect(r.positioningDistanceNm).toBeGreaterThan(60);
    expect(r.positioningDistanceNm).toBeLessThan(150);
    expect(r.positioningCandidateTypeId).toBe("c172");
  });

  it("returns the lowest-class option among reposition candidates", () => {
    const r = computeReachability(
      { originIcao: "CYQM", requiredClass: "SEP", requiredCapabilities: [] },
      ctx({
        rentalsAtPlayerLocation: [
          { aircraftTypeId: "tbm930", cls: "SET", rangeNm: 1500 },
          { aircraftTypeId: "baron_g58", cls: "MEP", rangeNm: 1400 },
          { aircraftTypeId: "c172", cls: "SEP", rangeNm: 600 },
        ],
      }),
    );
    expect(r.status).toBe("reposition_rental");
    expect(r.positioningCandidateTypeId).toBe("c172");
  });

  it("returns unreachable when no path exists", () => {
    const r = computeReachability(
      { originIcao: "CYYT", requiredClass: "SEP", requiredCapabilities: [] },
      ctx(),
    );
    expect(r.status).toBe("unreachable");
  });

  it("returns unreachable when rental exists but range is insufficient", () => {
    const r = computeReachability(
      { originIcao: "CYYT", requiredClass: "SEP", requiredCapabilities: [] },
      ctx({
        rentalsAtPlayerLocation: [
          { aircraftTypeId: "c172", cls: "SEP", rangeNm: 300 },
        ],
      }),
    );
    expect(r.status).toBe("unreachable");
  });
});
