import {
  checkEligibility,
  haversineNm,
  type AircraftCandidate,
  type EligibilityAirport,
  type JobRequirements,
  type PlayerState,
} from "@flightcareer/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
  reputation,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Placeholder fuel pricing until the price simulation lands. Cents per gallon,
// before the airport's baseFuelMultiplier is applied.
const BASE_PRICE_CENTS_PER_GAL: Record<"avgas" | "jet-a", number> = {
  avgas: 700,
  "jet-a": 550,
};

export const REP_HIT_BY_STATE = {
  accepted: { role: -2, client: -3 },
  briefed: { role: -5, client: -8 },
} as const;

// Floor on briefed fuel — at least 60% of the recommendation, and at least
// 1 gallon. Prevents trivial-fuel bypass of the brief commitment.
const FUEL_FLOOR_FRACTION = 0.6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPlayerState(): PlayerState | null {
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

function jobToRequirements(
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

function loadAirportLite(icaos: string[]): Map<string, EligibilityAirport> {
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

function clampRep(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

function adjustReputation(scope: string, delta: number, simNow: number): void {
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

// ---------------------------------------------------------------------------
// acceptJob
// ---------------------------------------------------------------------------

export interface AcceptJobInput {
  jobId: number;
  aircraftSource: "owned" | "rental";
  ownedAircraftId?: number;
  rentalAircraftTypeId?: string;
}

export type LifecycleResult =
  | { ok: true }
  | { ok: false; error: string };

export function acceptJob(input: AcceptJobInput): LifecycleResult {
  return db.transaction((tx): LifecycleResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeJobId != null) {
      return { ok: false, error: "Already on an active job" };
    }

    const jobRow = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
    if (!jobRow) return { ok: false, error: "Job not found" };
    if (jobRow.status !== "open") {
      return { ok: false, error: `Job is not open (status: ${jobRow.status})` };
    }
    // Match the open-job sweep semantics: job is expired when expiresAt is
    // strictly less than simNow (sweep uses `lt`).
    if (jobRow.expiresAt < careerRow.simDateTime) {
      return { ok: false, error: "Job has expired" };
    }

    // Resolve the chosen aircraft to an AircraftCandidate.
    let candidate: AircraftCandidate;
    if (input.aircraftSource === "owned") {
      if (input.ownedAircraftId == null) {
        return { ok: false, error: "Missing ownedAircraftId" };
      }
      const ownedRow = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, input.ownedAircraftId))
        .get();
      if (!ownedRow) return { ok: false, error: "Owned aircraft not found" };
      const typeRow = tx
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, ownedRow.aircraftTypeId))
        .get();
      if (!typeRow) return { ok: false, error: "Aircraft type not found" };
      candidate = {
        source: "owned",
        ownedAircraftId: ownedRow.id,
        aircraftTypeId: typeRow.id,
        tailNumber: ownedRow.tailNumber,
        currentLocationIcao: ownedRow.currentLocationIcao,
        cls: typeRow.class,
        rangeNm: typeRow.rangeNm,
        maxPayloadLbs: typeRow.maxPayloadLbs,
        unpavedCapable: typeRow.unpavedCapable,
        isAvailable: ownedRow.status === "available",
      };
    } else {
      if (!input.rentalAircraftTypeId) {
        return { ok: false, error: "Missing rentalAircraftTypeId" };
      }
      const typeRow = tx
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, input.rentalAircraftTypeId))
        .get();
      if (!typeRow) return { ok: false, error: "Aircraft type not found" };

      // Verify the player's current airport actually offers this rental
      // type. Without this, a client could supply any typeId and the WRONG
      // _LOCATION check would trivially pass since rentals get assigned to
      // the player's location by construction.
      const fleetRow = tx
        .select()
        .from(rentalFleet)
        .where(
          and(
            eq(rentalFleet.airportIcao, careerRow.currentLocationIcao),
            eq(rentalFleet.aircraftTypeId, typeRow.id),
          ),
        )
        .get();
      if (!fleetRow) {
        return {
          ok: false,
          error: `${typeRow.manufacturer} ${typeRow.model} is not available for rental at ${careerRow.currentLocationIcao}`,
        };
      }

      candidate = {
        source: "rental",
        ownedAircraftId: null,
        aircraftTypeId: typeRow.id,
        tailNumber: null,
        // Rentals are taken at the player's current location.
        currentLocationIcao: careerRow.currentLocationIcao,
        cls: typeRow.class,
        rangeNm: typeRow.rangeNm,
        maxPayloadLbs: typeRow.maxPayloadLbs,
        unpavedCapable: typeRow.unpavedCapable,
        isAvailable: true,
      };
    }

    const origin = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.originIcao))
      .get();
    const dest = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.destinationIcao))
      .get();
    if (!origin || !dest) {
      return { ok: false, error: "Airport endpoints not found" };
    }
    const requirements = jobToRequirements(jobRow, origin, dest);
    const player = loadPlayerState();
    if (!player) return { ok: false, error: "Player state not loaded" };
    const airportMap = loadAirportLite([
      jobRow.originIcao,
      jobRow.destinationIcao,
    ]);

    const eligibility = checkEligibility(
      candidate,
      requirements,
      player,
      airportMap,
    );
    if (!eligibility.eligible) {
      return {
        ok: false,
        error: `Aircraft not eligible: ${eligibility.reasons.join(", ")}`,
      };
    }

    // Persist.
    tx.update(jobs)
      .set({ status: "accepted", acceptedAt: careerRow.simDateTime })
      .where(eq(jobs.id, input.jobId))
      .run();

    tx.update(career)
      .set({
        activeJobId: input.jobId,
        activeAircraftSource: input.aircraftSource,
        activeAircraftOwnedId:
          input.aircraftSource === "owned" ? input.ownedAircraftId! : null,
        activeAircraftRentalTypeId:
          input.aircraftSource === "rental" ? candidate.aircraftTypeId : null,
        activeFlightState: "accepted",
        briefedFuelGallons: null,
        briefedFuelCostCents: null,
      })
      .where(eq(career.id, 1))
      .run();

    if (input.aircraftSource === "owned" && input.ownedAircraftId != null) {
      tx.update(ownedAircraft)
        .set({ status: "committed" })
        .where(eq(ownedAircraft.id, input.ownedAircraftId))
        .run();
    }

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// cancelAcceptedJob
// ---------------------------------------------------------------------------

export function cancelAcceptedJob(): LifecycleResult {
  return db.transaction((tx): LifecycleResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    const state = careerRow.activeFlightState;
    if (state !== "accepted" && state !== "briefed") {
      return { ok: false, error: "No cancellable active job" };
    }
    if (careerRow.activeJobId == null) {
      return { ok: false, error: "No active job id" };
    }

    const jobRow = tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, careerRow.activeJobId))
      .get();
    if (!jobRow) return { ok: false, error: "Active job not found" };

    const hits = REP_HIT_BY_STATE[state];
    adjustReputation(jobRow.role, hits.role, careerRow.simDateTime);
    if (jobRow.clientId) {
      adjustReputation(
        `client:${jobRow.clientId}`,
        hits.client,
        careerRow.simDateTime,
      );
    }

    // Briefed fuel is NOT refunded on cancel — the fuel was bought, it's gone.
    // (The brief warning makes this clear.)

    tx.update(jobs)
      .set({ status: "cancelled" })
      .where(eq(jobs.id, careerRow.activeJobId))
      .run();

    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      // Only release aircraft we actually committed. If a status transition
      // landed it elsewhere (in_maintenance, in_flight) since accept, leave
      // it alone — overwriting would silently destroy that state.
      tx.update(ownedAircraft)
        .set({ status: "available" })
        .where(
          and(
            eq(ownedAircraft.id, careerRow.activeAircraftOwnedId),
            eq(ownedAircraft.status, "committed"),
          ),
        )
        .run();
    }

    tx.update(career)
      .set({
        activeJobId: null,
        activeAircraftSource: null,
        activeAircraftOwnedId: null,
        activeAircraftRentalTypeId: null,
        activeFlightState: null,
        briefedFuelGallons: null,
        briefedFuelCostCents: null,
      })
      .where(eq(career.id, 1))
      .run();

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// briefJob
// ---------------------------------------------------------------------------

export interface BriefJobInput {
  fuelGallons: number;
}

export type BriefResult =
  | { ok: true; fuelCostCents: number }
  | { ok: false; error: string };

export function activeAircraftType(
  careerRow: typeof career.$inferSelect,
): string | null {
  if (careerRow.activeAircraftSource === "owned" && careerRow.activeAircraftOwnedId != null) {
    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
      .get();
    return ownedRow?.aircraftTypeId ?? null;
  }
  if (careerRow.activeAircraftSource === "rental") {
    return careerRow.activeAircraftRentalTypeId ?? null;
  }
  return null;
}

export function fuelPriceCentsPerGal(
  fuelType: "avgas" | "jet-a",
  baseFuelMultiplier: number,
): number {
  // Round to nearest cent — matches "round to 2 decimals" in dollar terms.
  return Math.round(BASE_PRICE_CENTS_PER_GAL[fuelType] * baseFuelMultiplier);
}

const BLOCK_TIME_RESERVE_FACTOR = 1.45;

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

export function briefJob(input: BriefJobInput): BriefResult {
  if (!Number.isFinite(input.fuelGallons) || input.fuelGallons <= 0) {
    return { ok: false, error: "Fuel gallons must be positive" };
  }

  return db.transaction((tx): BriefResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "accepted") {
      return {
        ok: false,
        error: `Cannot brief in state ${careerRow.activeFlightState ?? "(none)"}`,
      };
    }
    if (careerRow.activeJobId == null) {
      return { ok: false, error: "No active job id" };
    }

    const jobRow = tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, careerRow.activeJobId))
      .get();
    if (!jobRow) return { ok: false, error: "Active job not found" };

    const originRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.originIcao))
      .get();
    if (!originRow) return { ok: false, error: "Origin airport not found" };

    const aircraftTypeId = activeAircraftType(careerRow);
    if (!aircraftTypeId) {
      return { ok: false, error: "Active aircraft type not resolved" };
    }
    const typeRow = tx
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, aircraftTypeId))
      .get();
    if (!typeRow) return { ok: false, error: "Aircraft type not found" };

    const destRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.destinationIcao))
      .get();
    if (!destRow) return { ok: false, error: "Destination airport not found" };

    // Enforce a sensible fuel floor: at least 60% of the recommendation, and
    // at least 1 gallon. Without this, a player could brief at trivial fuel
    // (1¢ cost) and trivialize the briefing commitment.
    const distanceNm = haversineNm(
      { lat: originRow.lat, lon: originRow.lon },
      { lat: destRow.lat, lon: destRow.lon },
    );
    const recommended = recommendedFuelGallons(
      distanceNm,
      typeRow.cruiseSpeedKts,
      typeRow.fuelBurnGph,
    );
    const minGallons = Math.max(1, Math.ceil(recommended * FUEL_FLOOR_FRACTION));
    if (input.fuelGallons < minGallons) {
      return {
        ok: false,
        error: `Fuel below operational minimum (${minGallons} gal · ~${Math.round(
          FUEL_FLOOR_FRACTION * 100,
        )}% of ${recommended})`,
      };
    }

    const pricePerGal = fuelPriceCentsPerGal(
      typeRow.fuelType,
      originRow.baseFuelMultiplier,
    );
    const fuelCostCents = Math.round(input.fuelGallons * pricePerGal);

    if (careerRow.cash < fuelCostCents) {
      return { ok: false, error: "Insufficient cash for fuel" };
    }

    tx.update(career)
      .set({
        cash: careerRow.cash - fuelCostCents,
        activeFlightState: "briefed",
        briefedFuelGallons: input.fuelGallons,
        briefedFuelCostCents: fuelCostCents,
      })
      .where(eq(career.id, 1))
      .run();

    return { ok: true, fuelCostCents };
  });
}

// ---------------------------------------------------------------------------
// getActiveJob — for the lifecycle.getActiveJob query
// ---------------------------------------------------------------------------

export interface ActiveAircraftInfo {
  source: "owned" | "rental";
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: "SEP" | "MEP" | "SET" | "JET";
  cruiseSpeedKts: number;
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
  rangeNm: number;
  maxPayloadLbs: number;
  rentalRatePerHour: number;
  ownedAircraftId: number | null;
  tailNumber: string | null;
  currentLocationIcao: string;
}

export interface ActiveJobSnapshot {
  state: "accepted" | "briefed" | "in_progress";
  job: {
    id: number;
    clientId: string | null;
    role: "bush" | "air_taxi" | "light_jet" | "open";
    originIcao: string;
    originName: string;
    destinationIcao: string;
    destinationName: string;
    distanceNm: number;
    payloadLbs: number;
    payloadType: "cargo" | "pax" | "medical" | "survey" | "mixed";
    paxCount: number | null;
    requiredClass: "SEP" | "MEP" | "SET" | "JET";
    pay: number;
    description: string;
    urgency: "flexible" | "standard" | "urgent" | "critical";
    expiresAt: number;
    earliestDeparture: number | null;
    latestDeparture: number | null;
    acceptedAt: number | null;
  };
  aircraft: ActiveAircraftInfo;
  briefedFuelGallons: number | null;
  briefedFuelCostCents: number | null;
  fuelPriceCentsPerGal: number;
  recommendedFuelGallons: number;
  // Reputation deltas the player will pay if they cancel from this state.
  // Server is the single source of truth — UI reads this rather than
  // hardcoding the numbers.
  cancelPenalty: { role: number; client: number };
}

export function getActiveJob(): ActiveJobSnapshot | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  if (
    careerRow.activeJobId == null ||
    careerRow.activeFlightState == null ||
    careerRow.activeAircraftSource == null
  ) {
    return null;
  }

  const jobRow = db
    .select()
    .from(jobs)
    .where(eq(jobs.id, careerRow.activeJobId))
    .get();
  if (!jobRow) return null;

  const origin = db
    .select()
    .from(airports)
    .where(eq(airports.icao, jobRow.originIcao))
    .get();
  const dest = db
    .select()
    .from(airports)
    .where(eq(airports.icao, jobRow.destinationIcao))
    .get();
  if (!origin || !dest) return null;

  const typeId = activeAircraftType(careerRow);
  if (!typeId) return null;
  const typeRow = db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, typeId))
    .get();
  if (!typeRow) return null;

  let ownedAircraftId: number | null = null;
  let tailNumber: string | null = null;
  let aircraftLocation = careerRow.currentLocationIcao;
  if (
    careerRow.activeAircraftSource === "owned" &&
    careerRow.activeAircraftOwnedId != null
  ) {
    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
      .get();
    if (ownedRow) {
      ownedAircraftId = ownedRow.id;
      tailNumber = ownedRow.tailNumber;
      aircraftLocation = ownedRow.currentLocationIcao;
    }
  }

  const distanceNm = haversineNm(
    { lat: origin.lat, lon: origin.lon },
    { lat: dest.lat, lon: dest.lon },
  );

  const recommended = recommendedFuelGallons(
    distanceNm,
    typeRow.cruiseSpeedKts,
    typeRow.fuelBurnGph,
  );

  // The cancel penalty depends on the current lifecycle state. in_progress
  // is a placeholder for the next prompt; reuse "briefed" magnitudes for now.
  const penaltyKey =
    careerRow.activeFlightState === "in_progress"
      ? "briefed"
      : careerRow.activeFlightState;
  const penalty = REP_HIT_BY_STATE[penaltyKey];

  return {
    state: careerRow.activeFlightState,
    job: {
      id: jobRow.id,
      clientId: jobRow.clientId,
      role: jobRow.role,
      originIcao: jobRow.originIcao,
      originName: origin.name,
      destinationIcao: jobRow.destinationIcao,
      destinationName: dest.name,
      distanceNm,
      payloadLbs: jobRow.payloadLbs,
      payloadType: jobRow.payloadType,
      paxCount: jobRow.paxCount,
      requiredClass: jobRow.requiredClass,
      pay: jobRow.pay,
      description: jobRow.description,
      urgency: jobRow.urgency,
      expiresAt: jobRow.expiresAt,
      earliestDeparture: jobRow.earliestDeparture,
      latestDeparture: jobRow.latestDeparture,
      acceptedAt: jobRow.acceptedAt,
    },
    aircraft: {
      source: careerRow.activeAircraftSource,
      aircraftTypeId: typeRow.id,
      manufacturer: typeRow.manufacturer,
      model: typeRow.model,
      cls: typeRow.class,
      cruiseSpeedKts: typeRow.cruiseSpeedKts,
      fuelBurnGph: typeRow.fuelBurnGph,
      fuelType: typeRow.fuelType,
      rangeNm: typeRow.rangeNm,
      maxPayloadLbs: typeRow.maxPayloadLbs,
      rentalRatePerHour: typeRow.rentalRatePerHour,
      ownedAircraftId,
      tailNumber,
      currentLocationIcao: aircraftLocation,
    },
    briefedFuelGallons: careerRow.briefedFuelGallons ?? null,
    briefedFuelCostCents: careerRow.briefedFuelCostCents ?? null,
    fuelPriceCentsPerGal: fuelPriceCentsPerGal(
      typeRow.fuelType,
      origin.baseFuelMultiplier,
    ),
    recommendedFuelGallons: recommended,
    cancelPenalty: { role: penalty.role, client: penalty.client },
  };
}
