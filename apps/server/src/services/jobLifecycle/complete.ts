import {
  FERRY_VOICE_PROFILES,
  assessRisk,
  completeFlight,
  generateEvent,
  getClientById,
  haversineNm,
  resolveClaim,
  type ClaimOutcome,
  type CompleteFlightInput,
  type CompleteFlightOutput,
  type RiskAssessment,
  type RiskTier,
  type SignoffPromptInput,
  type SignoffReputationTier,
  type UnscheduledEvent,
} from "@flightcareer/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  flights,
  jobs,
  insuranceClaims,
  maintenanceEvents,
  ownedAircraft,
  ratings,
  reputation,
  trackingState,
} from "../../db/schema.js";
import {
  simBridge,
  type TrackedFlightEventRecord,
} from "../simBridge.js";
import {
  ABORT_REP_PENALTY,
  activeAircraftType,
  adjustReputation,
  fuelPriceCentsPerGal,
  type LifecycleResult,
} from "./shared.js";
import { getActivePolicyForAircraft } from "../insurance.js";

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

interface TrackedFlightSnapshot {
  events: TrackedFlightEventRecord[];
  fuelAtEngineStartGal: number | null;
  fuelAtEngineStopGal: number | null;
  currentFuelGal: number | null;
  landingLat: number | null;
  landingLon: number | null;
}

interface TrackedDerived {
  blockTimeMinutes: number | null;
  engineStartAt: number | null;
  engineStopAt: number | null;
  liftedOffAt: number | null;
  touchedDownAt: number | null;
  fuelBurnedGal: number | null;
  landingLat: number | null;
  landingLon: number | null;
}

// Both `db` and a `db.transaction(tx => ...)` `tx` expose the same query
// builders we need; drizzle's exact transaction type isn't structurally
// compatible with the database type. Loose typing here avoids leaking that
// detail through these helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;
function loadTrackedSnapshot(
  tx: DbLike,
  jobId: number,
): TrackedFlightSnapshot | null {
  const row = tx
    .select()
    .from(trackingState)
    .where(eq(trackingState.jobId, jobId))
    .get();
  if (!row) return null;
  let events: TrackedFlightEventRecord[] = [];
  try {
    const parsed = JSON.parse(row.eventsReceived) as unknown;
    if (Array.isArray(parsed)) events = parsed as TrackedFlightEventRecord[];
  } catch {
    events = [];
  }
  return {
    events,
    fuelAtEngineStartGal: row.fuelAtEngineStartGal,
    fuelAtEngineStopGal: row.fuelAtEngineStopGal,
    currentFuelGal: row.fuelTotalGal,
    landingLat: row.currentPositionLat,
    landingLon: row.currentPositionLon,
  };
}

function deriveFromTracked(snap: TrackedFlightSnapshot): TrackedDerived {
  let engineStartAt: number | null = null;
  let engineStopAt: number | null = null;
  let liftedOffAt: number | null = null;
  let touchedDownAt: number | null = null;
  // Latest touchdown wins — covers go-arounds and bounces.
  let landingLat: number | null = null;
  let landingLon: number | null = null;
  for (const evt of snap.events) {
    switch (evt.event) {
      case "engine_started":
        if (engineStartAt == null) engineStartAt = evt.timestamp;
        break;
      case "engine_stopped":
        engineStopAt = evt.timestamp;
        break;
      case "lifted_off":
        if (liftedOffAt == null) liftedOffAt = evt.timestamp;
        break;
      case "touched_down":
        touchedDownAt = evt.timestamp;
        if (evt.positionLat != null && evt.positionLon != null) {
          landingLat = evt.positionLat;
          landingLon = evt.positionLon;
        }
        break;
    }
  }
  // Prefer touchdown coords from the event payload; fall back to the last
  // persisted state if the event didn't carry them.
  if (landingLat == null) landingLat = snap.landingLat;
  if (landingLon == null) landingLon = snap.landingLon;

  // Block time = engine_start to engine_stop (wall-clock minutes). Both
  // domains are wall-clock unix ms, same as the manual modal uses.
  let blockTimeMinutes: number | null = null;
  if (engineStartAt != null && engineStopAt != null && engineStopAt > engineStartAt) {
    blockTimeMinutes = (engineStopAt - engineStartAt) / 60_000;
  }

  // Fuel burn: prefer the captured engine_stopped reading so a post-shutdown
  // refuel doesn't break the delta. Fall back to whatever fuel we last saw if
  // engine_stopped never fired (in-progress flights or a missed event).
  let fuelBurnedGal: number | null = null;
  if (snap.fuelAtEngineStartGal != null) {
    const endFuel =
      snap.fuelAtEngineStopGal != null
        ? snap.fuelAtEngineStopGal
        : snap.currentFuelGal;
    if (endFuel != null) {
      const delta = snap.fuelAtEngineStartGal - endFuel;
      fuelBurnedGal = delta > 0 ? Math.round(delta * 10) / 10 : null;
    }
  }

  return {
    blockTimeMinutes,
    engineStartAt,
    engineStopAt,
    liftedOffAt,
    touchedDownAt,
    fuelBurnedGal,
    landingLat,
    landingLon,
  };
}

const NEAREST_AIRPORT_THRESHOLD_NM = 5;

/**
 * Resolve a touchdown position to an ICAO. Linear scan over airports — the
 * table is small enough (a few thousand rows) that this is faster than
 * building any index. Returns null if nothing is within 5nm.
 */
function resolveNearestIcao(
  tx: DbLike,
  lat: number,
  lon: number,
): { icao: string; distanceNm: number } | null {
  const all = tx
    .select({ icao: airports.icao, lat: airports.lat, lon: airports.lon })
    .from(airports)
    .all();
  let best: { icao: string; distanceNm: number } | null = null;
  for (const a of all) {
    const d = haversineNm({ lat, lon }, { lat: a.lat, lon: a.lon });
    if (best == null || d < best.distanceNm) {
      best = { icao: a.icao, distanceNm: d };
    }
  }
  if (!best) return null;
  return best.distanceNm <= NEAREST_AIRPORT_THRESHOLD_NM ? best : null;
}

// Discriminant for what the sim told us about where the player landed. The UI
// surfaces these as distinct states — "matched"/"diverted" auto-fill the
// destination, "unresolved" forces the player to enter it, and
// "not_landed_yet" hides the auto-fill cue entirely.
export type DestinationResolutionStatus =
  | "not_landed_yet"
  | "matched"
  | "diverted"
  | "unresolved";

export interface TrackedCompletionPreview {
  // True iff the player is in a tracked flight RIGHT NOW. Independent of
  // whether any events have arrived — distinguishes "no flight" from "tracked
  // flight, bridge quiet so far".
  available: boolean;
  // True iff at least one bridge event was recorded for this flight. The UI
  // uses this to decide whether to label the modal "Tracked completion" or
  // fall back to "Manual completion" copy (because nothing was actually
  // tracked).
  hasTrackingData: boolean;
  blockTimeMinutes: number | null;
  fuelBurnedGal: number | null;
  resolvedDestinationIcao: string | null;
  resolvedDestinationDistanceNm: number | null;
  destinationResolution: DestinationResolutionStatus;
  isDiversion: boolean;
  events: TrackedFlightEventRecord[];
  engineStartAt: number | null;
  engineStopAt: number | null;
  liftedOffAt: number | null;
  touchedDownAt: number | null;
}

/**
 * Read-only view of what the server would auto-fill for a tracked completion.
 * The UI uses this to seed the completion form and to decide whether to show
 * the "auto-detect ready" prompt. Returns `available: false` when the active
 * flight isn't tracked or the data isn't there yet.
 */
export function getTrackedCompletionPreview(): TrackedCompletionPreview {
  const empty: TrackedCompletionPreview = {
    available: false,
    hasTrackingData: false,
    blockTimeMinutes: null,
    fuelBurnedGal: null,
    resolvedDestinationIcao: null,
    resolvedDestinationDistanceNm: null,
    destinationResolution: "not_landed_yet",
    isDiversion: false,
    events: [],
    engineStartAt: null,
    engineStopAt: null,
    liftedOffAt: null,
    touchedDownAt: null,
  };
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return empty;
  if (
    careerRow.activeFlightState !== "in_progress" ||
    careerRow.trackingMode !== "tracked" ||
    careerRow.activeJobId == null
  ) {
    return empty;
  }
  const jobRow = db
    .select()
    .from(jobs)
    .where(eq(jobs.id, careerRow.activeJobId))
    .get();
  if (!jobRow) return empty;

  const snap = loadTrackedSnapshot(db, careerRow.activeJobId);
  if (!snap) {
    return { ...empty, available: true };
  }
  const derived = deriveFromTracked(snap);

  let resolvedIcao: string | null = null;
  let resolvedDistance: number | null = null;
  if (derived.landingLat != null && derived.landingLon != null) {
    const nearest = resolveNearestIcao(
      db,
      derived.landingLat,
      derived.landingLon,
    );
    if (nearest) {
      resolvedIcao = nearest.icao;
      resolvedDistance = nearest.distanceNm;
    }
  }

  // Touchdown happens before engine_stopped. Once we've seen a touchdown event
  // we try to resolve a nearby airport; if none is within threshold we surface
  // an "unresolved" state so the UI can prompt the player to type the ICAO
  // instead of silently pre-filling the planned destination.
  let destinationResolution: DestinationResolutionStatus;
  if (derived.touchedDownAt == null) {
    destinationResolution = "not_landed_yet";
  } else if (resolvedIcao == null) {
    destinationResolution = "unresolved";
  } else if (resolvedIcao === jobRow.destinationIcao) {
    destinationResolution = "matched";
  } else {
    destinationResolution = "diverted";
  }

  return {
    available: true,
    hasTrackingData: snap.events.length > 0,
    blockTimeMinutes:
      derived.blockTimeMinutes != null
        ? Math.max(1, Math.round(derived.blockTimeMinutes))
        : null,
    fuelBurnedGal: derived.fuelBurnedGal,
    resolvedDestinationIcao: resolvedIcao,
    resolvedDestinationDistanceNm: resolvedDistance,
    destinationResolution,
    isDiversion: destinationResolution === "diverted",
    events: snap.events,
    engineStartAt: derived.engineStartAt,
    engineStopAt: derived.engineStopAt,
    liftedOffAt: derived.liftedOffAt,
    touchedDownAt: derived.touchedDownAt,
  };
}

export interface PostFlightUnscheduledEvent extends UnscheduledEvent {
  eventId: number;
  riskTier: RiskTier;
  scheduledCompletionAt: number | null;
}

export interface DispatcherSignoffPayload {
  message: string;
  dispatcherName: string | null;
  sourceLabel: string | null;
}

export interface CompletionSummaryPayload extends CompleteFlightOutput {
  flightId: number;
  inspectionAlerts: string[];
  cashAppliedNow: number;
  unscheduledEvent: PostFlightUnscheduledEvent | null;
  // Present only when an unscheduled event occurred on an OWNED aircraft.
  // Carries the insurance split (or the uninsured / not-covered outcome).
  // Null for rental/ferry flights and when no event occurred.
  insuranceClaim: ClaimOutcome | null;
  // Generated asynchronously after the txn commits, then merged into the
  // response. Null when no API key, generation failed, or validation rejected
  // the output — the UI just omits the section.
  dispatcherSignoff: DispatcherSignoffPayload | null;
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

export interface PostCompletionSignoffContext {
  flightId: number;
  promptInput: SignoffPromptInput;
  dispatcherName: string | null;
  sourceLabel: string | null;
}

export type CompleteFlightActionResult =
  | {
      ok: true;
      summary: CompletionSummaryPayload;
      signoff: PostCompletionSignoffContext;
    }
  | { ok: false; error: string };

function flightOutcome(
  summary: CompleteFlightOutput,
): "completed" | "diverted" | "failed" {
  if (summary.finalPay === 0) return "failed";
  if (summary.diversionAdjustment < 0) return "diverted";
  return "completed";
}

// Flight-count buckets ladder from "unproven" (no prior flights) up through
// "top" (15+ flights + sustained high reputation). Score only escalates the
// top of the ladder — a one-flight pilot can't be "high" no matter how good
// the rep score is.
function tierForSignoff(
  flightsWithThisClient: number,
  clientRepScore: number,
): SignoffReputationTier {
  if (flightsWithThisClient === 0) return "unproven";
  if (flightsWithThisClient <= 3) return "novice";
  if (flightsWithThisClient <= 15) return "mid";
  return clientRepScore >= 85 ? "top" : "high";
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

  // Populated by the txn closure when a tracked flight is being cleared. We
  // call simBridge.endTracking AFTER the txn commits so an unexpected rollback
  // doesn't desync the in-memory pointer from the DB.
  let trackedJobIdToFinalize: number | null = null;

  const result = db.transaction((tx): CompleteFlightActionResult => {
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

    // Tracked-flight metadata is captured here even though it doesn't affect
    // the canonical block-time / fuel-burn used in the completion math —
    // those come from the player-confirmed input. The sim-derived values are
    // persisted to the flight row for retrospective inspection (and a future
    // "use sim values" toggle).
    const trackingMode: "manual" | "tracked" =
      careerRow.trackingMode === "tracked" ? "tracked" : "manual";
    const trackedSnap =
      trackingMode === "tracked" ? loadTrackedSnapshot(tx, jobRow.id) : null;
    const trackedDerived = trackedSnap ? deriveFromTracked(trackedSnap) : null;
    let trackedResolvedIcao: string | null = null;
    if (
      trackedDerived &&
      trackedDerived.landingLat != null &&
      trackedDerived.landingLon != null
    ) {
      const nearest = resolveNearestIcao(
        tx,
        trackedDerived.landingLat,
        trackedDerived.landingLon,
      );
      trackedResolvedIcao = nearest?.icao ?? null;
    }

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
      ? fuelPriceCentsPerGal(typeRow.fuelType, destRow.icao, destRow.baseFuelMultiplier)
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
      // Ferries: owner pays for aircraft time. Player only collects the fee.
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
        trackingMode: null,
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
    // Set whenever an unscheduled event occurs on this owned aircraft —
    // carries the insurance split (or the uninsured / not-covered outcome).
    let claimOutcome: ClaimOutcome | null = null;
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

        // The maintenance_events row always records the FULL event cost —
        // the event genuinely cost that much. The insurance split lives only
        // on the insurance_claims row.
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
        const maintenanceEventId = Number(insert.lastInsertRowid);

        // Resolve the event against any ACTIVE insurance policy on this
        // aircraft. Uninsured / not-covered still produces an outcome (the
        // player simply pays in full) so the completion summary can explain
        // the result either way.
        const policy = getActivePolicyForAircraft(postFlightOwned.id, tx);
        claimOutcome = resolveClaim({
          policyTier: policy ? policy.tier : null,
          eventSeverity: event.severity,
          eventCostCents: event.costCents,
        });

        // Record a claim row only when the policy actually paid out — a
        // covered-but-under-deductible event pays nothing and is kept off
        // the claims ledger (mirrors the spec's "insurerPaid > 0" rule).
        if (policy && claimOutcome.covered && claimOutcome.insurerPaidCents > 0) {
          tx.insert(insuranceClaims)
            .values({
              policyId: policy.id,
              ownedAircraftId: postFlightOwned.id,
              maintenanceEventId,
              eventSeverity: event.severity,
              fullEventCostCents: claimOutcome.fullEventCostCents,
              deductiblePaidCents: claimOutcome.deductibleCents,
              insurerPaidCents: claimOutcome.insurerPaidCents,
              playerPaidCents: claimOutcome.playerPaidCents,
              createdAt: simNow,
            })
            .run();
        }

        // Deduct only what the player actually owes (deductible + any excess
        // over the ceiling, or the full cost when uninsured/not-covered).
        // Career row was already updated earlier in this txn — re-read to get
        // the current value. The row must exist (we read it at the top of the
        // txn); if it's gone now, something has corrupted the txn state, so
        // abort hard rather than silently dropping the deduction.
        const careerNow = tx.select().from(career).where(eq(career.id, 1)).get();
        if (!careerNow) {
          throw new Error("Career row vanished mid-completion");
        }
        tx.update(career)
          .set({ cash: careerNow.cash - claimOutcome.playerPaidCents })
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
    const flightInsert = tx
      .insert(flights)
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
        trackingMode,
        simBlockTimeMinutes: trackedDerived?.blockTimeMinutes ?? null,
        simEngineStartAt: trackedDerived?.engineStartAt ?? null,
        simEngineStopAt: trackedDerived?.engineStopAt ?? null,
        simLiftedOffAt: trackedDerived?.liftedOffAt ?? null,
        simTouchedDownAt: trackedDerived?.touchedDownAt ?? null,
        simActualDestinationIcao: trackedResolvedIcao,
        simFuelBurnedGal: trackedDerived?.fuelBurnedGal ?? null,
        simLandingLat: trackedDerived?.landingLat ?? null,
        simLandingLon: trackedDerived?.landingLon ?? null,
      })
      .run();
    const flightId = Number(flightInsert.lastInsertRowid);

    // Clear the buffered tracking row. Best-effort — the foreign key allows
    // the row to outlive the active job briefly, so a delete failure here is
    // tolerable.
    if (trackingMode === "tracked") {
      try {
        tx.delete(trackingState).where(eq(trackingState.jobId, jobRow.id)).run();
      } catch (err) {
        console.warn("[complete] failed to clear tracking_state:", err);
      }
      // Hand off to post-txn — see trackedJobIdToFinalize declaration above.
      trackedJobIdToFinalize = jobRow.id;
    }

    // Job: mark completed, store rep deltas
    tx.update(jobs)
      .set({
        status: "completed",
        completedAt: simNow,
        reputationDeltasJson: JSON.stringify(summary.reputationDeltas),
      })
      .where(eq(jobs.id, jobRow.id))
      .run();

    // The player only pays what the claim resolution says they owe — the
    // deductible plus any excess over the ceiling, or the full cost when
    // uninsured / not covered. claimOutcome is set whenever an event
    // occurred (insured or not).
    const cashAppliedNow =
      summary.netCashDelta - (claimOutcome?.playerPaidCents ?? 0);

    // -----------------------------------------------------------------
    // Sign-off context — gathered inside the txn so we have a consistent
    // snapshot. Generation itself runs after commit (async, can fail).
    // -----------------------------------------------------------------
    const isFerryJob = jobRow.jobType === "ferry";
    const clientDef = jobRow.clientId ? getClientById(jobRow.clientId) : undefined;

    let priorFlightsWithClient = 0;
    let clientRepScore = 0;
    if (!isFerryJob && jobRow.clientId) {
      // Count flights tied to any job for this client, excluding the row we
      // just inserted.
      const jobIdsForClient = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.clientId, jobRow.clientId))
        .all()
        .map((r) => r.id);
      if (jobIdsForClient.length > 0) {
        priorFlightsWithClient = Math.max(
          0,
          tx
            .select()
            .from(flights)
            .where(
              and(
                isNotNull(flights.jobId),
                inArray(flights.jobId, jobIdsForClient),
              ),
            )
            .all().length - 1,
        );
      }
      const repRow = tx
        .select()
        .from(reputation)
        .where(eq(reputation.scope, `client:${jobRow.clientId}`))
        .get();
      clientRepScore = repRow?.score ?? 0;
    }

    const signoffEvent = unscheduledOut
      ? {
          severity: unscheduledOut.severity,
          description: unscheduledOut.description,
        }
      : null;

    const promptInput: SignoffPromptInput = {
      jobType: isFerryJob ? "ferry" : "standard",
      clientName: isFerryJob
        ? jobRow.ferryOwnerName ?? null
        : clientDef?.name ?? null,
      clientRole: jobRow.role,
      clientVoice: clientDef?.voice ?? null,
      ferrySource: isFerryJob ? jobRow.ferrySource ?? null : null,
      ferryOwnerName: isFerryJob ? jobRow.ferryOwnerName ?? null : null,
      outcome,
      divertedFromIcao: isDiversion ? jobRow.destinationIcao : null,
      actualDestinationIcao: actualDest,
      unscheduledEvent: signoffEvent,
      reputationTier: tierForSignoff(priorFlightsWithClient, clientRepScore),
      flightsWithThisClient: priorFlightsWithClient,
      originIcao: jobRow.originIcao,
      blockTimeMinutes: input.blockTimeMinutes,
      payCents: summary.finalPay,
    };

    // Byline parts the UI renders under the message.
    let dispatcherName: string | null = null;
    let sourceLabel: string | null = null;
    if (isFerryJob && jobRow.ferrySource && jobRow.ferryOwnerName) {
      const profile = FERRY_VOICE_PROFILES[jobRow.ferrySource];
      dispatcherName = profile.dispatcherTemplate.replace(
        "{ownerName}",
        jobRow.ferryOwnerName,
      );
      // Owner is the dispatcher; dealers/operators have a company name worth
      // showing on a second line.
      sourceLabel =
        jobRow.ferrySource === "owner" ? null : jobRow.ferryOwnerName;
    } else if (jobRow.clientId && clientDef) {
      dispatcherName = clientDef.voice?.dispatcherName ?? null;
      sourceLabel = clientDef.name;
    } else if (!jobRow.clientId) {
      // Open market — byline is intentionally minimal.
      dispatcherName = "Anonymous broker";
      sourceLabel = null;
    }

    const finalSummary: CompletionSummaryPayload = {
      ...summary,
      flightId,
      inspectionAlerts: inspectionLines,
      cashAppliedNow,
      unscheduledEvent: unscheduledOut,
      insuranceClaim: claimOutcome,
      dispatcherSignoff: null,
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

    return {
      ok: true,
      summary: finalSummary,
      signoff: {
        flightId,
        promptInput,
        dispatcherName,
        sourceLabel,
      },
    };
  });

  // Side-effect: nudge the bridge's in-memory tracked-job pointer now that the
  // DB commit is durable. endTracking(deleteRow=false) is a sync no-op against
  // the DB (the row was already deleted in the txn) and only touches memory.
  if (result.ok && trackedJobIdToFinalize != null) {
    simBridge.endTracking(trackedJobIdToFinalize, false);
  }
  return result;
}

/**
 * Generates the dispatcher sign-off via the AI service, persists it to the
 * flight row, and returns the payload to merge into the response. Returns
 * null on any failure (no API key, API error, invalid output) — the caller
 * should treat null as "no sign-off this time, omit the section".
 */
export async function applyDispatcherSignoff(
  ctx: PostCompletionSignoffContext,
  generate: (input: SignoffPromptInput) => Promise<string | null>,
): Promise<DispatcherSignoffPayload | null> {
  let message: string | null;
  try {
    message = await generate(ctx.promptInput);
  } catch (err) {
    console.warn("[signoff] generator threw:", err);
    return null;
  }
  if (!message) return null;

  try {
    db.update(flights)
      .set({ dispatcherSignoff: message })
      .where(eq(flights.id, ctx.flightId))
      .run();
  } catch (err) {
    console.warn(
      `[signoff] persist failed for flight ${ctx.flightId}:`,
      err,
    );
    // Still return the payload — the player sees it even if the cache write
    // dropped it from the logbook.
  }

  return {
    message,
    dispatcherName: ctx.dispatcherName,
    sourceLabel: ctx.sourceLabel,
  };
}

export function abortFlight(): LifecycleResult {
  let trackedJobIdToFinalize: number | null = null;
  const result = db.transaction((tx): LifecycleResult => {
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

    // Clear any buffered tracking state — abort discards it like the flight
    // never happened. Best-effort; foreign-key lifecycle is stable.
    if (careerRow.trackingMode === "tracked") {
      try {
        tx.delete(trackingState).where(eq(trackingState.jobId, careerRow.activeJobId)).run();
      } catch (err) {
        console.warn("[abort] failed to clear tracking_state:", err);
      }
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
        trackingMode: null,
      })
      .where(eq(career.id, 1))
      .run();

    if (careerRow.trackingMode === "tracked" && careerRow.activeJobId != null) {
      trackedJobIdToFinalize = careerRow.activeJobId;
    }

    return { ok: true };
  });

  if (result.ok && trackedJobIdToFinalize != null) {
    simBridge.endTracking(trackedJobIdToFinalize, false);
  }
  return result;
}

/**
 * Mid-flight escape hatch: demote an active tracked flight to manual mode.
 * The flight stays in_progress; only the tracking metadata is unwound. Player
 * completes via the existing manual form. Used by the "Switch to Manual Mode"
 * button and (transitively) by the MSFS-integration off-toggle.
 */
export function switchToManualMode(): LifecycleResult {
  let trackedJobIdToFinalize: number | null = null;
  const result = db.transaction((tx): LifecycleResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "in_progress") {
      return { ok: false, error: "No flight in progress" };
    }
    if (careerRow.trackingMode !== "tracked") {
      // Already manual — idempotent success rather than error noise.
      return { ok: true };
    }
    tx.update(career)
      .set({ trackingMode: "manual" })
      .where(eq(career.id, 1))
      .run();
    // The tracking_state row stays — sim_* values captured up to this point
    // are still useful for completion's reference fields. complete.ts will
    // GC it.
    if (careerRow.activeJobId != null) {
      trackedJobIdToFinalize = careerRow.activeJobId;
    }
    return { ok: true };
  });
  if (result.ok && trackedJobIdToFinalize != null) {
    simBridge.endTracking(trackedJobIdToFinalize, false);
  }
  return result;
}
