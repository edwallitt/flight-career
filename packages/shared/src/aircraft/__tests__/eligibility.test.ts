import { describe, expect, it } from "vitest";
import type { AircraftClass } from "../../clients/types.js";
import {
  checkEligibility,
  rankCandidates,
  type AircraftCandidate,
  type EligibilityAirport,
  type JobRequirements,
  type PlayerState,
} from "../eligibility.js";

const AIRPORTS: EligibilityAirport[] = [
  { icao: "CYHZ", hasPavedRunway: true, longestRunwayFt: 10500 },
  { icao: "CYYT", hasPavedRunway: true, longestRunwayFt: 8500 },
  { icao: "CDIRT", hasPavedRunway: false, longestRunwayFt: 2400 },
];
const AIRPORT_MAP = new Map(AIRPORTS.map((a) => [a.icao, a]));

const ALL_RATED: Record<AircraftClass, boolean> = {
  SEP: true,
  MEP: true,
  SET: true,
  JET: true,
};

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    ratings: { ...ALL_RATED },
    currentLocationIcao: "CYHZ",
    ...overrides,
  };
}

function job(overrides: Partial<JobRequirements> = {}): JobRequirements {
  return {
    originIcao: "CYHZ",
    destinationIcao: "CYYT",
    distanceNm: 500,
    payloadLbs: 800,
    requiredClass: "SEP",
    requiredCapabilities: [],
    ...overrides,
  };
}

function rentalCandidate(
  overrides: Partial<AircraftCandidate> = {},
): AircraftCandidate {
  return {
    source: "rental",
    ownedAircraftId: null,
    aircraftTypeId: "c172",
    tailNumber: null,
    currentLocationIcao: "CYHZ",
    cls: "SEP",
    rangeNm: 640,
    maxPayloadLbs: 880,
    unpavedCapable: false,
    isAvailable: true,
    ...overrides,
  };
}

function ownedCandidate(
  overrides: Partial<AircraftCandidate> = {},
): AircraftCandidate {
  return rentalCandidate({
    source: "owned",
    ownedAircraftId: 1,
    tailNumber: "C-FABC",
    ...overrides,
  });
}

describe("checkEligibility", () => {
  it("happy path returns eligible with no reasons", () => {
    const result = checkEligibility(rentalCandidate(), job(), player(), AIRPORT_MAP);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("flags NOT_RATED when player lacks rating for the candidate's class", () => {
    const p = player({ ratings: { ...ALL_RATED, SEP: false } });
    const result = checkEligibility(rentalCandidate(), job(), p, AIRPORT_MAP);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("NOT_RATED");
  });

  it("flags CLASS_TOO_LOW when candidate class is below job's requiredClass", () => {
    const result = checkEligibility(
      rentalCandidate({ cls: "SEP" }),
      job({ requiredClass: "SET", distanceNm: 100, payloadLbs: 100 }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("CLASS_TOO_LOW");
    expect(result.eligible).toBe(false);
  });

  it("does NOT flag CLASS_TOO_LOW when candidate class is at or above requiredClass", () => {
    const result = checkEligibility(
      rentalCandidate({ cls: "SET", rangeNm: 1000, maxPayloadLbs: 2000 }),
      job({ requiredClass: "SEP" }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).not.toContain("CLASS_TOO_LOW");
  });

  it("flags INSUFFICIENT_RANGE when range < distance * 1.15", () => {
    const result = checkEligibility(
      rentalCandidate({ rangeNm: 500 }),
      job({ distanceNm: 500 }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("INSUFFICIENT_RANGE");
  });

  it("respects the 15% reserve buffer at the boundary", () => {
    const distance = 500;
    const tooShort = checkEligibility(
      rentalCandidate({ rangeNm: 574 }),
      job({ distanceNm: distance }),
      player(),
      AIRPORT_MAP,
    );
    const justEnough = checkEligibility(
      rentalCandidate({ rangeNm: 575 }),
      job({ distanceNm: distance }),
      player(),
      AIRPORT_MAP,
    );
    expect(tooShort.reasons).toContain("INSUFFICIENT_RANGE");
    expect(justEnough.reasons).not.toContain("INSUFFICIENT_RANGE");
  });

  it("flags INSUFFICIENT_PAYLOAD", () => {
    const result = checkEligibility(
      rentalCandidate({ maxPayloadLbs: 500 }),
      job({ payloadLbs: 800 }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("INSUFFICIENT_PAYLOAD");
  });

  it("flags UNPAVED_INCAPABLE when an endpoint is unpaved and candidate is not unpaved-capable", () => {
    const result = checkEligibility(
      rentalCandidate({ unpavedCapable: false }),
      job({ destinationIcao: "CDIRT", distanceNm: 200 }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("UNPAVED_INCAPABLE");
  });

  it("does NOT flag UNPAVED_INCAPABLE for unpaved-capable aircraft", () => {
    const result = checkEligibility(
      rentalCandidate({ unpavedCapable: true }),
      job({ destinationIcao: "CDIRT", distanceNm: 200 }),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).not.toContain("UNPAVED_INCAPABLE");
  });

  it("flags WRONG_LOCATION when an owned aircraft is not at job origin", () => {
    const result = checkEligibility(
      ownedCandidate({ currentLocationIcao: "CYYT" }),
      job({ originIcao: "CYHZ" }),
      player({ currentLocationIcao: "CYHZ" }),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("WRONG_LOCATION");
  });

  it("flags WRONG_LOCATION when a rental is not at the player's current location", () => {
    const result = checkEligibility(
      rentalCandidate({ currentLocationIcao: "CYYT" }),
      job(),
      player({ currentLocationIcao: "CYHZ" }),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("WRONG_LOCATION");
  });

  it("flags WRONG_LOCATION for a rental when the player is not at the job origin", () => {
    // Player + rental are co-located, but neither is at the job origin —
    // the player can't depart from origin without first repositioning.
    const result = checkEligibility(
      rentalCandidate({ currentLocationIcao: "CYYT" }),
      job({ originIcao: "CYHZ" }),
      player({ currentLocationIcao: "CYYT" }),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("WRONG_LOCATION");
    expect(result.eligible).toBe(false);
  });

  it("does NOT flag WRONG_LOCATION when an owned aircraft is at the job origin (even if the player isn't there yet)", () => {
    const result = checkEligibility(
      ownedCandidate({ currentLocationIcao: "CYHZ" }),
      job({ originIcao: "CYHZ" }),
      player({ currentLocationIcao: "CYYT" }),
      AIRPORT_MAP,
    );
    expect(result.reasons).not.toContain("WRONG_LOCATION");
  });

  it("flags AIRCRAFT_UNAVAILABLE when isAvailable is false", () => {
    const result = checkEligibility(
      ownedCandidate({ isAvailable: false }),
      job(),
      player(),
      AIRPORT_MAP,
    );
    expect(result.reasons).toContain("AIRCRAFT_UNAVAILABLE");
  });

  it("accumulates multiple failures", () => {
    const p = player({ ratings: { ...ALL_RATED, SEP: false } });
    const result = checkEligibility(
      rentalCandidate({ rangeNm: 100, maxPayloadLbs: 100 }),
      job({ distanceNm: 1000, payloadLbs: 1500 }),
      p,
      AIRPORT_MAP,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["NOT_RATED", "INSUFFICIENT_RANGE", "INSUFFICIENT_PAYLOAD"]),
    );
  });
});

describe("rankCandidates", () => {
  it("places eligible owned-at-origin first, then eligible others, then ineligible last", () => {
    const ownedAtOrigin = ownedCandidate({
      ownedAircraftId: 1,
      tailNumber: "C-FONE",
      currentLocationIcao: "CYHZ",
    });
    const rentalAtOrigin = rentalCandidate({ aircraftTypeId: "bonanza_g36" });
    const ineligibleByPayload = rentalCandidate({
      aircraftTypeId: "c152",
      maxPayloadLbs: 100,
    });

    const ranked = rankCandidates(
      [ineligibleByPayload, rentalAtOrigin, ownedAtOrigin],
      job(),
      player(),
      AIRPORT_MAP,
    );

    expect(ranked[0]?.candidate.tailNumber).toBe("C-FONE");
    expect(ranked[0]?.eligibility.eligible).toBe(true);
    expect(ranked[1]?.candidate.aircraftTypeId).toBe("bonanza_g36");
    expect(ranked[1]?.eligibility.eligible).toBe(true);
    expect(ranked[2]?.candidate.aircraftTypeId).toBe("c152");
    expect(ranked[2]?.eligibility.eligible).toBe(false);
  });

  it("prefers smaller class when both are eligible", () => {
    const sep = rentalCandidate({
      aircraftTypeId: "c172",
      cls: "SEP",
      rangeNm: 1000,
      maxPayloadLbs: 800,
    });
    const jet = rentalCandidate({
      aircraftTypeId: "cj4",
      cls: "JET",
      rangeNm: 2000,
      maxPayloadLbs: 2000,
    });

    const ranked = rankCandidates(
      [jet, sep],
      job({ requiredClass: "SEP" }),
      player(),
      AIRPORT_MAP,
    );

    expect(ranked[0]?.candidate.aircraftTypeId).toBe("c172");
  });
});
