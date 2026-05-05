import {
  checkEligibility,
  completeFlight,
  haversineNm,
  type AircraftCandidate,
  type CompleteFlightInput,
  type CompleteFlightOutput,
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
  flights,
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

  // Cancel penalty surfaced to the UI depends on lifecycle state. accepted/
  // briefed use the cancel magnitudes; in_progress uses the abort magnitudes
  // (a different code path, but the player sees one "back out" cost).
  const penalty =
    careerRow.activeFlightState === "in_progress"
      ? ABORT_REP_PENALTY
      : REP_HIT_BY_STATE[careerRow.activeFlightState];

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

// ---------------------------------------------------------------------------
// beginFlight — briefed → in_progress
// ---------------------------------------------------------------------------

export type BeginFlightResult =
  | { ok: true; startedAt: number }
  | { ok: false; error: string };

export function beginFlight(): BeginFlightResult {
  return db.transaction((tx): BeginFlightResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "briefed") {
      return {
        ok: false,
        error: `Cannot begin flight in state ${careerRow.activeFlightState ?? "(none)"}`,
      };
    }

    const startedAt = careerRow.simDateTime;
    tx.update(career)
      .set({ activeFlightState: "in_progress", flightStartedAt: startedAt })
      .where(eq(career.id, 1))
      .run();

    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      tx.update(ownedAircraft)
        .set({ status: "in_flight" })
        .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
        .run();
    }

    if (careerRow.activeJobId != null) {
      tx.update(jobs)
        .set({ status: "in_progress" })
        .where(eq(jobs.id, careerRow.activeJobId))
        .run();
    }

    return { ok: true, startedAt };
  });
}

// ---------------------------------------------------------------------------
// completeFlightAction — in_progress → completed
// ---------------------------------------------------------------------------

const HUNDRED_HR_INSPECTION_THRESHOLD = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CompleteFlightActionInput {
  actualDestinationIcao: string;
  blockTimeMinutes: number;
  fuelBurnedGal?: number;
}

export interface CompletionSummaryPayload extends CompleteFlightOutput {
  inspectionAlerts: string[];
  cashAppliedNow: number;
}

export type CompleteFlightActionResult =
  | { ok: true; summary: CompletionSummaryPayload }
  | { ok: false; error: string };

function flightOutcome(
  summary: CompleteFlightOutput,
): "completed" | "diverted" | "failed" {
  if (summary.finalPay === 0) return "failed";
  if (summary.diversionAdjustment < 0) return "diverted";
  return "completed";
}

export function completeFlightAction(
  input: CompleteFlightActionInput,
): CompleteFlightActionResult {
  if (!Number.isFinite(input.blockTimeMinutes) || input.blockTimeMinutes <= 0) {
    return { ok: false, error: "Block time must be positive" };
  }
  if (!input.actualDestinationIcao || input.actualDestinationIcao.length < 3) {
    return { ok: false, error: "Destination ICAO is required" };
  }

  return db.transaction((tx): CompleteFlightActionResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "in_progress") {
      return {
        ok: false,
        error: `Cannot complete in state ${careerRow.activeFlightState ?? "(none)"}`,
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

    const actualDest = input.actualDestinationIcao.trim().toUpperCase();
    const destRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, actualDest))
      .get();
    if (!destRow) {
      return { ok: false, error: `Unknown destination ICAO: ${actualDest}` };
    }
    const jobDestRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.destinationIcao))
      .get();
    const jobOriginRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.originIcao))
      .get();
    if (!jobDestRow || !jobOriginRow) {
      return { ok: false, error: "Job airport endpoints not found" };
    }

    const isDiversion = actualDest !== jobRow.destinationIcao;
    const divertedDistanceFromTargetNm = isDiversion
      ? haversineNm(
          { lat: destRow.lat, lon: destRow.lon },
          { lat: jobDestRow.lat, lon: jobDestRow.lon },
        )
      : 0;

    let ownedAircraftRow: typeof ownedAircraft.$inferSelect | null = null;
    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      ownedAircraftRow =
        tx
          .select()
          .from(ownedAircraft)
          .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
          .get() ?? null;
    }

    // Owned aircraft refuel at destination if the airport sells the right fuel.
    // For now we always refuel owned aircraft so they can fly home; rentals
    // never get refueled here (the rental house handles that).
    const refuelAtDestination =
      careerRow.activeAircraftSource === "owned" &&
      (typeRow.fuelType === "jet-a" ? destRow.hasJetA : destRow.hasAvgas);
    const destFuelPrice = refuelAtDestination
      ? fuelPriceCentsPerGal(typeRow.fuelType, destRow.baseFuelMultiplier)
      : 0;

    const completionInput: CompleteFlightInput = {
      jobId: jobRow.id,
      clientId: jobRow.clientId,
      role: jobRow.role,
      jobOriginIcao: jobRow.originIcao,
      jobDestinationIcao: jobRow.destinationIcao,
      jobPay: jobRow.pay,
      jobLatestDeparture: jobRow.latestDeparture,
      jobUrgency: jobRow.urgency,
      weatherSensitivity: jobRow.weatherSensitivity,

      aircraftSource: careerRow.activeAircraftSource ?? "rental",
      aircraftTypeId: typeRow.id,
      aircraftClass: typeRow.class,
      ownedAircraftId: ownedAircraftRow?.id ?? null,
      rentalRatePerHourCents:
        careerRow.activeAircraftSource === "rental"
          ? typeRow.rentalRatePerHour
          : 0,
      fuelBurnGph: typeRow.fuelBurnGph,
      cruiseSpeedKts: typeRow.cruiseSpeedKts,

      actualOriginIcao: jobRow.originIcao,
      actualDestinationIcao: actualDest,
      startedAt: careerRow.flightStartedAt ?? careerRow.simDateTime,
      endedAt: careerRow.simDateTime,
      blockTimeMinutes: input.blockTimeMinutes,
      fuelBurnedGal:
        input.fuelBurnedGal != null && Number.isFinite(input.fuelBurnedGal)
          ? input.fuelBurnedGal
          : null,
      briefedFuelCostCents: careerRow.briefedFuelCostCents ?? 0,
      refuelAtDestination,
      destinationFuelPriceCents: destFuelPrice,

      destinationLandingFeeCents: destRow.baseLandingFee,
      isDiversion,
      divertedDistanceFromTargetNm,
    };

    const summary = completeFlight(completionInput);

    // Apply outputs ----------------------------------------------------------
    const simNow = careerRow.simDateTime;

    // Career: cash, location, clear active state
    tx.update(career)
      .set({
        cash: careerRow.cash + summary.netCashDelta,
        currentLocationIcao: actualDest,
        activeJobId: null,
        activeAircraftSource: null,
        activeAircraftOwnedId: null,
        activeAircraftRentalTypeId: null,
        activeFlightState: null,
        flightStartedAt: null,
        briefedFuelGallons: null,
        briefedFuelCostCents: null,
      })
      .where(eq(career.id, 1))
      .run();

    // Reputation deltas (clamped 0–100, upsert)
    for (const delta of summary.reputationDeltas) {
      adjustReputation(delta.scope, delta.delta, simNow);
    }

    // Owned aircraft updates
    const inspectionLines: string[] = [];
    if (ownedAircraftRow && summary.aircraftUpdates) {
      const upd = summary.aircraftUpdates;
      const newAirframe = ownedAircraftRow.airframeHours + upd.blockHoursAdded;
      const newEngineSinceOH =
        ownedAircraftRow.engineHoursSinceOverhaul + upd.blockHoursAdded;
      const newSince100 = ownedAircraftRow.hoursSince100hr + upd.blockHoursAdded;
      const newSinceAnnual =
        ownedAircraftRow.hoursSinceAnnual + upd.blockHoursAdded;
      const newFuel = Math.max(
        0,
        ownedAircraftRow.fuelOnBoardGal -
          upd.fuelBurnedGalDelta +
          upd.fuelRefilledGalDelta,
      );

      tx.update(ownedAircraft)
        .set({
          airframeHours: newAirframe,
          engineHoursSinceOverhaul: newEngineSinceOH,
          hoursSince100hr: newSince100,
          hoursSinceAnnual: newSinceAnnual,
          fuelOnBoardGal: newFuel,
          currentLocationIcao: actualDest,
          status: "available",
        })
        .where(eq(ownedAircraft.id, ownedAircraftRow.id))
        .run();

      // Inspection alerts (informational — auto-scheduling is a future feature)
      if (newSince100 >= HUNDRED_HR_INSPECTION_THRESHOLD) {
        inspectionLines.push(
          `100-hour inspection due (${newSince100.toFixed(1)} hrs since last)`,
        );
      }
      if (simNow >= ownedAircraftRow.annualDueAt) {
        const daysOver = Math.floor(
          (simNow - ownedAircraftRow.annualDueAt) / MS_PER_DAY,
        );
        inspectionLines.push(
          daysOver > 0
            ? `Annual inspection overdue by ${daysOver} day${daysOver === 1 ? "" : "s"}`
            : "Annual inspection due now",
        );
      }
    }

    // Flight log entry. endedAt is derived from startedAt + block time so the
    // pair stays internally consistent — sim time advances in 30-min ticks
    // which would otherwise create gaps between (endedAt - startedAt) and the
    // user-entered block time.
    const flightStartedAt = completionInput.startedAt;
    const flightEndedAt =
      flightStartedAt + summary.flightLogEntry.blockTimeMinutes * 60_000;
    const outcome = flightOutcome(summary);
    tx.insert(flights)
      .values({
        jobId: jobRow.id,
        ownedAircraftId: ownedAircraftRow?.id ?? null,
        rentalAircraftTypeId:
          careerRow.activeAircraftSource === "rental" ? typeRow.id : null,
        originIcao: summary.flightLogEntry.originIcao,
        destinationIcao: summary.flightLogEntry.destinationIcao,
        startedAt: flightStartedAt,
        endedAt: flightEndedAt,
        blockTimeMinutes: summary.flightLogEntry.blockTimeMinutes,
        fuelBurnedGal: summary.flightLogEntry.fuelBurnedGal,
        totalCost: summary.flightLogEntry.totalCost,
        totalRevenue: summary.flightLogEntry.totalRevenue,
        outcome,
        notes: summary.flightLogEntry.notes,
      })
      .run();

    // Job: mark completed, store rep deltas
    tx.update(jobs)
      .set({
        status: "completed",
        completedAt: simNow,
        reputationDeltasJson: JSON.stringify(summary.reputationDeltas),
      })
      .where(eq(jobs.id, jobRow.id))
      .run();

    const finalSummary: CompletionSummaryPayload = {
      ...summary,
      inspectionAlerts: inspectionLines,
      cashAppliedNow: summary.netCashDelta,
    };

    return { ok: true, summary: finalSummary };
  });
}

// ---------------------------------------------------------------------------
// abortFlight — in_progress → cancelled (rep penalty, no pay)
// ---------------------------------------------------------------------------

const ABORT_REP_PENALTY = { role: -8, client: -12 } as const;

export function abortFlight(): LifecycleResult {
  return db.transaction((tx): LifecycleResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "in_progress") {
      return { ok: false, error: "No flight in progress" };
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

    if (jobRow.role !== "open") {
      adjustReputation(jobRow.role, ABORT_REP_PENALTY.role, careerRow.simDateTime);
      if (jobRow.clientId) {
        adjustReputation(
          `client:${jobRow.clientId}`,
          ABORT_REP_PENALTY.client,
          careerRow.simDateTime,
        );
      }
    }

    tx.update(jobs)
      .set({ status: "cancelled" })
      .where(eq(jobs.id, careerRow.activeJobId))
      .run();

    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      tx.update(ownedAircraft)
        .set({ status: "available" })
        .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
        .run();
    }

    tx.update(career)
      .set({
        activeJobId: null,
        activeAircraftSource: null,
        activeAircraftOwnedId: null,
        activeAircraftRentalTypeId: null,
        activeFlightState: null,
        flightStartedAt: null,
        briefedFuelGallons: null,
        briefedFuelCostCents: null,
      })
      .where(eq(career.id, 1))
      .run();

    return { ok: true };
  });
}
