import type { AircraftClass } from "../clients/types.js";
import { haversineNm } from "./distance.js";

export interface ReachabilityContext {
  playerLocationIcao: string;
  playerRatings: Record<AircraftClass, boolean>;
  ownedAircraft: Array<{
    aircraftTypeId: string;
    currentLocationIcao: string;
    cls: AircraftClass;
    rangeNm: number;
    isAvailable: boolean;
  }>;
  rentalsAtPlayerLocation: Array<{
    aircraftTypeId: string;
    cls: AircraftClass;
    rangeNm: number;
  }>;
  airports: Map<string, { lat: number; lon: number }>;
}

export type ReachabilityStatus =
  | "at_origin"
  | "owned_at_origin"
  | "reposition_rental"
  | "unreachable";

export interface JobReachability {
  status: ReachabilityStatus;
  positioningDistanceNm?: number;
  positioningCandidateTypeId?: string;
}

const CLASS_RANK: Record<AircraftClass, number> = {
  SEP: 0,
  MEP: 1,
  SET: 2,
  JET: 3,
};

// Reserve buffer: rentals must have range >= positioning distance / 0.85 (i.e.
// distance ≤ range × 0.85). Mirrors the conservative reserve used for job
// eligibility, so we don't surface ferry options that would later be rejected.
const REPOSITION_RESERVE_FACTOR = 0.85;

export function computeReachability(
  job: {
    originIcao: string;
    requiredClass: AircraftClass;
    requiredCapabilities: string[];
  },
  ctx: ReachabilityContext,
): JobReachability {
  if (job.originIcao === ctx.playerLocationIcao) {
    return { status: "at_origin" };
  }

  for (const owned of ctx.ownedAircraft) {
    if (
      owned.currentLocationIcao === job.originIcao &&
      owned.isAvailable &&
      ctx.playerRatings[owned.cls] === true
    ) {
      return { status: "owned_at_origin" };
    }
  }

  const playerAp = ctx.airports.get(ctx.playerLocationIcao);
  const originAp = ctx.airports.get(job.originIcao);
  if (playerAp && originAp) {
    const repositionDistance = haversineNm(playerAp, originAp);

    const candidates = ctx.rentalsAtPlayerLocation.filter(
      (r) =>
        ctx.playerRatings[r.cls] === true &&
        repositionDistance <= r.rangeNm * REPOSITION_RESERVE_FACTOR,
    );

    if (candidates.length > 0) {
      const cheapest = [...candidates].sort(
        (a, b) => CLASS_RANK[a.cls] - CLASS_RANK[b.cls],
      )[0]!;
      return {
        status: "reposition_rental",
        positioningDistanceNm: Math.round(repositionDistance),
        positioningCandidateTypeId: cheapest.aircraftTypeId,
      };
    }
  }

  return { status: "unreachable" };
}
