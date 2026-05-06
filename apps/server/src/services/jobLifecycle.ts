import {
  assessRisk,
  checkEligibility,
  completeFlight,
  generateEvent,
  haversineNm,
  recommendedFuelUplift,
  type AircraftCandidate,
  type CompleteFlightInput,
  type CompleteFlightOutput,
  type EligibilityAirport,
  type JobRequirements,
  type PlayerState,
  type RiskAssessment,
  type RiskTier,
  type UnscheduledEvent,
} from "@flightcareer/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  flights,
  jobs,
  maintenanceEvents,
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

// Hard-limit dispatch check against an already-loaded owned aircraft + type.
// Caller passes them in to avoid extra reads inside transactions.
function dispatchVerdict(
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

    // Soft-block: refuse to accept a job with an owned aircraft past hard
    // maintenance limits. Defense in depth — the UI also disables the chip.
    if (input.aircraftSource === "owned") {
      const ownedForCheck = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, input.ownedAircraftId!))
        .get();
      const typeForCheck = tx
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, candidate.aircraftTypeId))
        .get();
      if (ownedForCheck && typeForCheck) {
        const verdict = dispatchVerdict(
          ownedForCheck,
          typeForCheck.tboHours,
          careerRow.simDateTime,
        );
        if (!verdict.canDispatch) {
          return {
            ok: false,
            error: `Cannot dispatch: ${verdict.reason ?? "aircraft past hard limits"}`,
          };
        }
      }
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

    // If the active aircraft has crossed a hard maintenance limit since
    // accept, the player can't dispatch. Cancelling under that condition
    // is forced — waive the reputation penalty.
    let waiveRepPenalty = false;
    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      const ownedForCheck = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
        .get();
      if (ownedForCheck) {
        const typeForCheck = tx
          .select()
          .from(aircraftTypes)
          .where(eq(aircraftTypes.id, ownedForCheck.aircraftTypeId))
          .get();
        if (typeForCheck) {
          const verdict = dispatchVerdict(
            ownedForCheck,
            typeForCheck.tboHours,
            careerRow.simDateTime,
          );
          waiveRepPenalty = !verdict.canDispatch;
        }
      }
    }

    if (!waiveRepPenalty) {
      const hits = REP_HIT_BY_STATE[state];
      adjustReputation(jobRow.role, hits.role, careerRow.simDateTime);
      if (jobRow.clientId) {
        adjustReputation(
          `client:${jobRow.clientId}`,
          hits.client,
          careerRow.simDateTime,
        );
      }
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
  | { ok: true; fuelCostCents: number; fuelGallons: number }
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
  // Rentals skip the fuel-uplift step entirely (wet rate includes fuel), so
  // a non-positive fuel input is OK for them. Owned aircraft still require
  // a positive uplift.
  if (!Number.isFinite(input.fuelGallons) || input.fuelGallons < 0) {
    return { ok: false, error: "Fuel gallons must be non-negative" };
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

    // Rental path: wet rate includes fuel — no uplift, no separate cost.
    // Aircraft is conceptually delivered fueled and ready.
    if (careerRow.activeAircraftSource === "rental") {
      tx.update(career)
        .set({
          activeFlightState: "briefed",
          briefedFuelGallons: 0,
          briefedFuelCostCents: 0,
        })
        .where(eq(career.id, 1))
        .run();
      return { ok: true, fuelCostCents: 0, fuelGallons: 0 };
    }

    // Soft-block: defense-in-depth check at brief time. An aircraft could
    // have crossed a hard limit between accept and brief if maintenance was
    // delayed across calendar boundaries.
    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      const ownedForCheck = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
        .get();
      if (ownedForCheck) {
        const verdict = dispatchVerdict(
          ownedForCheck,
          typeRow.tboHours,
          careerRow.simDateTime,
        );
        if (!verdict.canDispatch) {
          return {
            ok: false,
            error: `Cannot dispatch: ${verdict.reason ?? "aircraft past hard limits"}`,
          };
        }
      }
    }

    const destRow = tx
      .select()
      .from(airports)
      .where(eq(airports.icao, jobRow.destinationIcao))
      .get();
    if (!destRow) return { ok: false, error: "Destination airport not found" };

    // Owned-aircraft fuel uplift. Floor is the larger of: 60% of total
    // recommended fuel for the trip (above current on-board), or 1 gallon.
    // Without a floor a player could brief at trivial fuel (1¢ cost) and
    // trivialize the briefing commitment.
    if (careerRow.activeAircraftOwnedId == null) {
      return { ok: false, error: "Owned aircraft id missing" };
    }
    const ownedRow = tx
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
      .get();
    if (!ownedRow) return { ok: false, error: "Owned aircraft not found" };

    const headroomGal = Math.max(
      0,
      typeRow.fuelCapacityGal - ownedRow.fuelOnBoardGal,
    );
    if (input.fuelGallons > headroomGal + 1e-6) {
      return {
        ok: false,
        error: `Uplift exceeds tank capacity (${headroomGal.toFixed(0)} gal headroom)`,
      };
    }

    const distanceNm = haversineNm(
      { lat: originRow.lat, lon: originRow.lon },
      { lat: destRow.lat, lon: destRow.lon },
    );
    const recommended = recommendedFuelGallons(
      distanceNm,
      typeRow.cruiseSpeedKts,
      typeRow.fuelBurnGph,
    );
    // Total fuel available for the leg = current on-board + uplift. The floor
    // applies to the *total*, not the uplift — if the player is already well-
    // fueled, a small (or zero) uplift is fine.
    const totalAfterUplift = ownedRow.fuelOnBoardGal + input.fuelGallons;
    const minTotal = Math.max(1, Math.ceil(recommended * FUEL_FLOOR_FRACTION));
    if (totalAfterUplift < minTotal) {
      return {
        ok: false,
        error: `Total fuel below operational minimum (${minTotal} gal · ~${Math.round(
          FUEL_FLOOR_FRACTION * 100,
        )}% of ${recommended} recommended)`,
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

    // Actually load the uplift into the aircraft's tanks so the fuel state
    // shown in the hangar / next briefing reflects what the player paid for.
    if (input.fuelGallons > 0) {
      tx.update(ownedAircraft)
        .set({
          fuelOnBoardGal: Math.min(
            typeRow.fuelCapacityGal,
            ownedRow.fuelOnBoardGal + input.fuelGallons,
          ),
        })
        .where(eq(ownedAircraft.id, ownedRow.id))
        .run();
    }

    return { ok: true, fuelCostCents, fuelGallons: input.fuelGallons };
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
  fuelCapacityGal: number;
  // For owned aircraft this is what's actually in the tanks. For rentals the
  // wet rate covers fuel and the aircraft is conceptually delivered full —
  // we surface fuelCapacityGal here so the UI can show "starts full".
  currentFuelGal: number;
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
  // Recommended uplift (gallons) given current fuel state and the trip — the
  // UI seeds the input from this. Always 0 for rentals (no uplift step).
  recommendedFuelUpliftGallons: number;
  // Reputation deltas the player will pay if they cancel from this state.
  // Server is the single source of truth — UI reads this rather than
  // hardcoding the numbers.
  cancelPenalty: { role: number; client: number };
  // Maintenance risk for owned aircraft. Null for rentals.
  risk: ActiveJobRiskInfo | null;
}

export interface ActiveJobRiskInfo {
  tier: RiskTier;
  factors: Array<{ description: string; severity: string }>;
  cannotDispatch: boolean;
  cannotDispatchReason: string | null;
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
  let risk: ActiveJobRiskInfo | null = null;
  // Owned aircraft: show actual on-board fuel. Rental: conceptually full at
  // delivery, so we report capacity for the briefing's range/reserves math.
  let currentFuelGal = typeRow.fuelCapacityGal;
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
      currentFuelGal = ownedRow.fuelOnBoardGal;
      // Risk assessment is only meaningful pre-flight. Once the flight is
      // in_progress the hours haven't been added yet, so the figures here
      // would be stale by the time anything renders them.
      if (careerRow.activeFlightState !== "in_progress") {
        const daysSinceAnnual =
          365 +
          Math.max(
            0,
            (careerRow.simDateTime - ownedRow.annualDueAt) /
              (24 * 60 * 60 * 1000),
          );
        const assessment = assessRisk({
          hoursSince100hr: ownedRow.hoursSince100hr,
          hoursSinceAnnual: daysSinceAnnual,
          engineHoursSinceOverhaul: ownedRow.engineHoursSinceOverhaul,
          tboHours: typeRow.tboHours,
          airframeHours: ownedRow.airframeHours,
        });
        risk = {
          tier: assessment.tier,
          factors: assessment.factors.map((f) => ({
            description: f.description,
            severity: f.severity,
          })),
          cannotDispatch: assessment.cannotDispatch,
          cannotDispatchReason: assessment.cannotDispatchReason ?? null,
        };
      }
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
  const recommendedUplift =
    careerRow.activeAircraftSource === "rental"
      ? 0
      : recommendedFuelUplift({
          distanceNm,
          cruiseSpeedKts: typeRow.cruiseSpeedKts,
          fuelBurnGph: typeRow.fuelBurnGph,
          fuelCapacityGal: typeRow.fuelCapacityGal,
          currentFuelGal,
        });

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
      fuelCapacityGal: typeRow.fuelCapacityGal,
      currentFuelGal,
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
    recommendedFuelUpliftGallons: recommendedUplift,
    cancelPenalty: { role: penalty.role, client: penalty.client },
    risk,
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

    // Final defense before the wheels move.
    if (
      careerRow.activeAircraftSource === "owned" &&
      careerRow.activeAircraftOwnedId != null
    ) {
      const ownedForCheck = tx
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
        .get();
      if (ownedForCheck) {
        const typeRow = tx
          .select()
          .from(aircraftTypes)
          .where(eq(aircraftTypes.id, ownedForCheck.aircraftTypeId))
          .get();
        if (typeRow) {
          const verdict = dispatchVerdict(
            ownedForCheck,
            typeRow.tboHours,
            careerRow.simDateTime,
          );
          if (!verdict.canDispatch) {
            return {
              ok: false,
              error: `Cannot dispatch: ${verdict.reason ?? "aircraft past hard limits"}`,
            };
          }
        }
      }
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

// Cheap LCG seeded by mixing a job id and a sim-time stamp. Same input pair
// always yields the same outcome — so a re-played flight produces the same
// unscheduled-event roll. Mixing high and low halves of simNow keeps the seed
// distinguishable across long time horizons (the lower 32 bits of a unix-ms
// timestamp wrap every ~50 days; without mixing, distant flights with the
// same job id could collide).
function seededRngFor(jobId: number, simNow: number): () => number {
  const hi = Math.floor(simNow / 0x1_0000_0000) >>> 0;
  const lo = (simNow >>> 0) ^ Math.imul(jobId | 0, 2654435761);
  let s = ((hi ^ lo) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export interface CompleteFlightActionInput {
  actualDestinationIcao: string;
  blockTimeMinutes: number;
  fuelBurnedGal?: number;
}

export interface PostFlightUnscheduledEvent extends UnscheduledEvent {
  eventId: number;
  riskTier: RiskTier;
  scheduledCompletionAt: number | null;
}

export interface CompletionSummaryPayload extends CompleteFlightOutput {
  inspectionAlerts: string[];
  cashAppliedNow: number;
  unscheduledEvent: PostFlightUnscheduledEvent | null;
  // Geographic route data so the summary modal can render an actual chart.
  // `planned*` differs from actual when the pilot diverted.
  route: {
    originIcao: string;
    originName: string;
    originLat: number;
    originLon: number;
    actualIcao: string;
    actualName: string;
    actualLat: number;
    actualLon: number;
    plannedIcao: string;
    plannedName: string;
    plannedLat: number;
    plannedLon: number;
    isDiversion: boolean;
  };
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

    // Accumulate hours toward this class's rating requirements.
    const blockHours = input.blockTimeMinutes / 60;
    const ratingRow = tx
      .select()
      .from(ratings)
      .where(eq(ratings.class, typeRow.class))
      .get();
    if (ratingRow) {
      tx.update(ratings)
        .set({ hoursInClass: ratingRow.hoursInClass + blockHours })
        .where(eq(ratings.class, typeRow.class))
        .run();
    }

    // Owned aircraft updates
    const inspectionLines: string[] = [];
    let postFlightOwned: typeof ownedAircraft.$inferSelect | null = null;
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

      // Snapshot the just-updated owned aircraft state for risk assessment.
      postFlightOwned = {
        ...ownedAircraftRow,
        airframeHours: newAirframe,
        engineHoursSinceOverhaul: newEngineSinceOH,
        hoursSince100hr: newSince100,
        hoursSinceAnnual: newSinceAnnual,
        fuelOnBoardGal: newFuel,
        currentLocationIcao: actualDest,
        status: "available",
      };
    }

    // -----------------------------------------------------------------
    // Unscheduled-event risk roll. Owned aircraft only — rentals are
    // someone else's maintenance problem.
    //
    // Note: an unscheduled event grounds the aircraft wherever it just
    // landed, regardless of whether the airport has maintenance. Treat
    // this as fly-out mechanics — the work happens where the aircraft is.
    // -----------------------------------------------------------------
    let unscheduledOut: PostFlightUnscheduledEvent | null = null;
    if (postFlightOwned && summary.aircraftUpdates) {
      // Translate days-since-last-annual from the annualDueAt anchor so it
      // matches the pure logic's expectations (>365 = overdue).
      const daysSinceAnnual =
        365 + Math.max(0, (simNow - postFlightOwned.annualDueAt) / MS_PER_DAY);

      const assessment: RiskAssessment = assessRisk({
        hoursSince100hr: postFlightOwned.hoursSince100hr,
        hoursSinceAnnual: daysSinceAnnual,
        engineHoursSinceOverhaul: postFlightOwned.engineHoursSinceOverhaul,
        tboHours: typeRow.tboHours,
        airframeHours: postFlightOwned.airframeHours,
      });

      const blockHoursForRoll = summary.aircraftUpdates.blockHoursAdded;
      const flightProb = Math.min(
        0.5,
        assessment.probabilityPerFlightHour * blockHoursForRoll,
      );

      // Deterministic per-flight rng — same flight id + ended-at always
      // yields the same outcome.
      const rng = seededRngFor(jobRow.id, simNow);
      if (rng() < flightProb) {
        const event = generateEvent({
          riskTier: assessment.tier,
          factors: assessment.factors,
          aircraftType: {
            fuelType: typeRow.fuelType,
            aircraftClass: typeRow.class,
            overhaulCostCents: typeRow.overhaulCost,
            annualCostCents: typeRow.annualCost,
          },
          rng,
        });

        const groundedMs = event.groundedDays * MS_PER_DAY;
        const scheduledCompletionAt = event.groundedDays > 0 ? simNow + groundedMs : null;
        const status: "in_progress" | "completed" =
          event.groundedDays > 0 ? "in_progress" : "completed";

        const insert = tx
          .insert(maintenanceEvents)
          .values({
            ownedAircraftId: postFlightOwned.id,
            type: "unscheduled",
            cost: event.costCents,
            startedAt: simNow,
            scheduledCompletionAt,
            completedAt: status === "completed" ? simNow : null,
            description: event.description,
            status,
          })
          .run();

        // Deduct event cost from cash. Career row was already updated
        // earlier in this txn — re-read to get the current value. The row
        // must exist (we read it at the top of the txn); if it's gone now,
        // something has corrupted the txn state, so abort hard rather than
        // silently dropping the deduction.
        const careerNow = tx.select().from(career).where(eq(career.id, 1)).get();
        if (!careerNow) {
          throw new Error("Career row vanished mid-completion");
        }
        tx.update(career)
          .set({ cash: careerNow.cash - event.costCents })
          .where(eq(career.id, 1))
          .run();

        if (event.groundedDays > 0) {
          tx.update(ownedAircraft)
            .set({ status: "in_maintenance" })
            .where(eq(ownedAircraft.id, postFlightOwned.id))
            .run();
        }

        unscheduledOut = {
          ...event,
          eventId: Number(insert.lastInsertRowid),
          riskTier: assessment.tier,
          scheduledCompletionAt,
        };
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

    const cashAppliedNow =
      summary.netCashDelta - (unscheduledOut?.costCents ?? 0);

    const finalSummary: CompletionSummaryPayload = {
      ...summary,
      inspectionAlerts: inspectionLines,
      cashAppliedNow,
      unscheduledEvent: unscheduledOut,
      route: {
        originIcao: jobOriginRow.icao,
        originName: jobOriginRow.name,
        originLat: jobOriginRow.lat,
        originLon: jobOriginRow.lon,
        actualIcao: destRow.icao,
        actualName: destRow.name,
        actualLat: destRow.lat,
        actualLon: destRow.lon,
        plannedIcao: jobDestRow.icao,
        plannedName: jobDestRow.name,
        plannedLat: jobDestRow.lat,
        plannedLon: jobDestRow.lon,
        isDiversion,
      },
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
