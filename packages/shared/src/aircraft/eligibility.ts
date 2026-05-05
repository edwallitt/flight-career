import type { AircraftClass } from "../clients/types.js";

export type EligibilityReason =
  | "OK"
  | "NOT_RATED"
  | "CLASS_TOO_LOW"
  | "INSUFFICIENT_RANGE"
  | "INSUFFICIENT_PAYLOAD"
  | "UNPAVED_INCAPABLE"
  | "WRONG_LOCATION"
  | "AIRCRAFT_UNAVAILABLE"
  | "RUNWAY_TOO_SHORT"
  | "CAPABILITY_MISSING";

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

export interface JobRequirements {
  originIcao: string;
  destinationIcao: string;
  distanceNm: number;
  payloadLbs: number;
  requiredClass: AircraftClass;
  requiredCapabilities: string[];
}

export interface AircraftCandidate {
  source: "owned" | "rental";
  ownedAircraftId: number | null;
  aircraftTypeId: string;
  tailNumber: string | null;
  currentLocationIcao: string;
  cls: AircraftClass;
  rangeNm: number;
  maxPayloadLbs: number;
  unpavedCapable: boolean;
  isAvailable: boolean;
}

export interface PlayerState {
  ratings: Record<AircraftClass, boolean>;
  currentLocationIcao: string;
}

export interface EligibilityAirport {
  icao: string;
  hasPavedRunway: boolean;
  longestRunwayFt: number;
}

const CLASS_RANK: Record<AircraftClass, number> = {
  SEP: 0,
  MEP: 1,
  SET: 2,
  JET: 3,
};

// 15% reserve buffer over straight-line distance — placeholder for fuel
// reserves, weather diversion, taxi/climb. Tune as the economy is balanced.
const RANGE_RESERVE_FACTOR = 1.15;

export function checkEligibility(
  candidate: AircraftCandidate,
  job: JobRequirements,
  player: PlayerState,
  airports: Map<string, EligibilityAirport>,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  if (!player.ratings[candidate.cls]) {
    reasons.push("NOT_RATED");
  }

  if (CLASS_RANK[candidate.cls] < CLASS_RANK[job.requiredClass]) {
    reasons.push("CLASS_TOO_LOW");
  }

  if (candidate.rangeNm < job.distanceNm * RANGE_RESERVE_FACTOR) {
    reasons.push("INSUFFICIENT_RANGE");
  }

  if (candidate.maxPayloadLbs < job.payloadLbs) {
    reasons.push("INSUFFICIENT_PAYLOAD");
  }

  const origin = airports.get(job.originIcao);
  const dest = airports.get(job.destinationIcao);
  const eitherUnpaved =
    (origin && !origin.hasPavedRunway) || (dest && !dest.hasPavedRunway);
  if (eitherUnpaved && !candidate.unpavedCapable) {
    reasons.push("UNPAVED_INCAPABLE");
  }

  if (candidate.source === "owned") {
    if (candidate.currentLocationIcao !== job.originIcao) {
      reasons.push("WRONG_LOCATION");
    }
  } else {
    // Rentals: must be at the player's current airport (you can only rent
    // where you physically are) AND the player must be at the job origin
    // (otherwise you have a rental but can't depart for the job).
    if (
      candidate.currentLocationIcao !== player.currentLocationIcao ||
      player.currentLocationIcao !== job.originIcao
    ) {
      reasons.push("WRONG_LOCATION");
    }
  }

  if (!candidate.isAvailable) {
    reasons.push("AIRCRAFT_UNAVAILABLE");
  }

  return { eligible: reasons.length === 0, reasons };
}

export interface RankedCandidate {
  candidate: AircraftCandidate;
  eligibility: EligibilityResult;
  preferenceScore: number;
}

export function rankCandidates(
  candidates: AircraftCandidate[],
  job: JobRequirements,
  player: PlayerState,
  airports: Map<string, EligibilityAirport>,
): RankedCandidate[] {
  const ranked = candidates.map<RankedCandidate>((candidate) => {
    const eligibility = checkEligibility(candidate, job, player, airports);
    let score = 0;
    if (!eligibility.eligible) {
      score = -1000;
    } else {
      score += 1; // baseline positive for any eligible candidate
      if (candidate.source === "owned") score += 50;
      if (candidate.currentLocationIcao === job.originIcao) score += 30;
      // Reward smaller class — closer to job's requiredClass is better.
      const classGap = CLASS_RANK[candidate.cls] - CLASS_RANK[job.requiredClass];
      score += Math.max(0, 10 - classGap * 5);
    }
    return { candidate, eligibility, preferenceScore: score };
  });
  ranked.sort((a, b) => b.preferenceScore - a.preferenceScore);
  return ranked;
}
