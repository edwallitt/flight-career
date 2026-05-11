import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftTypes,
  career,
  jobs,
  ownedAircraft,
} from "../../db/schema.js";
import { simBridge } from "../simBridge.js";
import { dispatchVerdict } from "./shared.js";

export type BeginFlightResult =
  | { ok: true; startedAt: number; trackingMode: "manual" | "tracked" }
  | { ok: false; error: string };

export interface BeginFlightInput {
  trackingMode?: "manual" | "tracked";
}

export function beginFlight(input: BeginFlightInput = {}): BeginFlightResult {
  const trackingMode = input.trackingMode ?? "manual";
  return db.transaction((tx): BeginFlightResult => {
    const careerRow = tx.select().from(career).where(eq(career.id, 1)).get();
    if (!careerRow) return { ok: false, error: "Career not found" };
    if (careerRow.activeFlightState !== "briefed") {
      return {
        ok: false,
        error: `Cannot begin flight in state ${careerRow.activeFlightState ?? "(none)"}`,
      };
    }

    if (trackingMode === "tracked" && !simBridge.isReadyForTracking()) {
      return {
        ok: false,
        error:
          "MSFS tracking is unavailable. Confirm the SimBridge is running and MSFS is connected.",
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
      .set({
        activeFlightState: "in_progress",
        flightStartedAt: startedAt,
        trackingMode,
      })
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

    return { ok: true, startedAt, trackingMode };
  });
}
