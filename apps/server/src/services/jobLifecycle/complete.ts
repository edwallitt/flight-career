import {
  FERRY_VOICE_PROFILES,
  assessRisk,
  completeFlight,
  generateEvent,
  getClientById,
  haversineNm,
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
  maintenanceEvents,
  ownedAircraft,
  ratings,
  reputation,
} from "../../db/schema.js";
import {
  ABORT_REP_PENALTY,
  activeAircraftType,
  adjustReputation,
  fuelPriceCentsPerGal,
  type LifecycleResult,
} from "./shared.js";

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
      })
      .run();
    const flightId = Number(flightInsert.lastInsertRowid);

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
