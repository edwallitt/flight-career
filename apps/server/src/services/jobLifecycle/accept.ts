import {
  checkEligibility,
  type AircraftCandidate,
} from "@flightcareer/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
} from "../../db/schema.js";
import {
  REP_HIT_BY_STATE,
  adjustReputation,
  dispatchVerdict,
  jobToRequirements,
  loadAirportLite,
  loadPlayerState,
  type LifecycleResult,
} from "./shared.js";

export interface AcceptJobInput {
  jobId: number;
  aircraftSource: "owned" | "rental" | "ferry";
  ownedAircraftId?: number;
  rentalAircraftTypeId?: string;
}

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

    // Ferry contracts: no aircraft selection step, the aircraft *is* the job.
    if (input.aircraftSource === "ferry") {
      if (jobRow.jobType !== "ferry") {
        return { ok: false, error: "Job is not a ferry contract" };
      }
      if (!jobRow.ferryAircraftTypeId) {
        return { ok: false, error: "Ferry aircraft type missing on job" };
      }
      if (careerRow.currentLocationIcao !== jobRow.originIcao) {
        return {
          ok: false,
          error: `You must be at ${jobRow.originIcao} to accept this ferry`,
        };
      }
      const ratingRow = tx
        .select()
        .from(ratings)
        .where(eq(ratings.class, jobRow.requiredClass))
        .get();
      if (!ratingRow?.earned) {
        return {
          ok: false,
          error: `You are not rated for ${jobRow.requiredClass}`,
        };
      }

      tx.update(jobs)
        .set({ status: "accepted", acceptedAt: careerRow.simDateTime })
        .where(eq(jobs.id, input.jobId))
        .run();

      // Reuse activeAircraftRentalTypeId to carry the ferry aircraft's type id
      // — both rentals and ferries are typed-aircraft-only (no owned row), so
      // every consumer of activeAircraftType() resolves them the same way.
      tx.update(career)
        .set({
          activeJobId: input.jobId,
          activeAircraftSource: "ferry",
          activeAircraftOwnedId: null,
          activeAircraftRentalTypeId: jobRow.ferryAircraftTypeId,
          activeFlightState: "accepted",
          briefedFuelGallons: null,
          briefedFuelCostCents: null,
        })
        .where(eq(career.id, 1))
        .run();

      return { ok: true };
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
    // Ferries also waive: there's no client to upset and the role is "open".
    let waiveRepPenalty = careerRow.activeAircraftSource === "ferry";
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
