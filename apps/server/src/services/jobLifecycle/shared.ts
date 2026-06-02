import {
  assessRisk,
  haversineNm,
  type EligibilityAirport,
  type JobRequirements,
  type PlayerState,
} from "@flightcareer/shared";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  reputation,
} from "../../db/schema.js";
import { fuelPriceCentsPerGal as livePriceCentsPerGal } from "../fuelDrift.js";

export type LifecycleResult =
  | { ok: true }
  | { ok: false; error: string };

export const REP_HIT_BY_STATE = {
  accepted: { role: -2, client: -3 },
  briefed: { role: -5, client: -8 },
} as const;

export const ABORT_REP_PENALTY = { role: -8, client: -12 } as const;

const BLOCK_TIME_RESERVE_FACTOR = 1.45;

export function loadPlayerState(): PlayerState | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  const ratingRows = db.select().from(ratings).all();
  const r: PlayerState["ratings"] = {
    SEP: false,
    MEP: false,
    SET: false,
    JET: false,
  };
  for (const row of ratingRows) {
    r[row.class] = row.earned;
  }
  return { ratings: r, currentLocationIcao: careerRow.currentLocationIcao };
}

export function jobToRequirements(
  jobRow: typeof jobs.$inferSelect,
  origin: typeof airports.$inferSelect,
  dest: typeof airports.$inferSelect,
): JobRequirements {
  let caps: string[] = [];
  try {
    caps = jobRow.requiredCapabilitiesJson
      ? JSON.parse(jobRow.requiredCapabilitiesJson)
      : [];
  } catch {
    caps = [];
  }
  return {
    originIcao: jobRow.originIcao,
    destinationIcao: jobRow.destinationIcao,
    distanceNm: haversineNm(
      { lat: origin.lat, lon: origin.lon },
      { lat: dest.lat, lon: dest.lon },
    ),
    payloadLbs: jobRow.payloadLbs,
    requiredClass: jobRow.requiredClass,
    requiredCapabilities: caps,
  };
}

export function loadAirportLite(
  icaos: string[],
): Map<string, EligibilityAirport> {
  if (icaos.length === 0) return new Map();
  const rows = db
    .select()
    .from(airports)
    .where(inArray(airports.icao, icaos))
    .all();
  return new Map(
    rows.map((a) => [
      a.icao,
      {
        icao: a.icao,
        hasPavedRunway: a.hasPavedRunway,
        longestRunwayFt: a.longestRunwayFt,
      },
    ]),
  );
}

// Hard-limit dispatch check against an already-loaded owned aircraft + type.
// Caller passes them in to avoid extra reads inside transactions.
export function dispatchVerdict(
  owned: typeof ownedAircraft.$inferSelect,
  tboHours: number,
  simNow: number,
): { canDispatch: boolean; reason?: string } {
  const daysSinceAnnual =
    365 + Math.max(0, (simNow - owned.annualDueAt) / (24 * 60 * 60 * 1000));
  const assessment = assessRisk({
    hoursSince100hr: owned.hoursSince100hr,
    hoursSinceAnnual: daysSinceAnnual,
    engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
    tboHours,
    airframeHours: owned.airframeHours,
  });
  return {
    canDispatch: !assessment.cannotDispatch,
    ...(assessment.cannotDispatchReason
      ? { reason: assessment.cannotDispatchReason }
      : {}),
  };
}

function clampRep(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

/**
 * Current per-client reputation score (0 if the client has no row yet). Reads
 * via the shared connection, so it is safe to call inside a transaction before
 * any reputation write in that same transaction.
 */
export function getClientReputationScore(clientId: string): number {
  const row = db
    .select()
    .from(reputation)
    .where(eq(reputation.scope, `client:${clientId}`))
    .get();
  return row?.score ?? 0;
}

export function adjustReputation(
  scope: string,
  delta: number,
  simNow: number,
): void {
  const existing = db
    .select()
    .from(reputation)
    .where(eq(reputation.scope, scope))
    .get();
  if (existing) {
    db.update(reputation)
      .set({ score: clampRep(existing.score + delta), updatedAt: simNow })
      .where(eq(reputation.scope, scope))
      .run();
  } else {
    db.insert(reputation)
      .values({ scope, score: clampRep(delta), updatedAt: simNow })
      .run();
  }
}

export function activeAircraftType(
  careerRow: typeof career.$inferSelect,
): string | null {
  if (
    careerRow.activeAircraftSource === "owned" &&
    careerRow.activeAircraftOwnedId != null
  ) {
    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
      .get();
    return ownedRow?.aircraftTypeId ?? null;
  }
  if (
    careerRow.activeAircraftSource === "rental" ||
    careerRow.activeAircraftSource === "ferry"
  ) {
    return careerRow.activeAircraftRentalTypeId ?? null;
  }
  return null;
}

export function fuelPriceCentsPerGal(
  fuelType: "avgas" | "jet-a",
  airportIcao: string,
  baseFuelMultiplier: number,
): number {
  return livePriceCentsPerGal(fuelType, airportIcao, baseFuelMultiplier);
}

export function recommendedFuelGallons(
  distanceNm: number,
  cruiseSpeedKts: number,
  fuelBurnGph: number,
): number {
  if (cruiseSpeedKts <= 0) return 0;
  return (
    Math.ceil(
      ((distanceNm / cruiseSpeedKts) * fuelBurnGph * BLOCK_TIME_RESERVE_FACTOR) /
        10,
    ) * 10
  );
}
