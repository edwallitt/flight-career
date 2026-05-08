import { haversineNm } from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
} from "../../db/schema.js";
import {
  activeAircraftType,
  dispatchVerdict,
  fuelPriceCentsPerGal,
  recommendedFuelGallons,
} from "./shared.js";

// Floor on briefed fuel — at least 60% of the recommendation, and at least
// 1 gallon. Prevents trivial-fuel bypass of the brief commitment.
const FUEL_FLOOR_FRACTION = 0.6;

export interface BriefJobInput {
  fuelGallons: number;
}

export type BriefResult =
  | { ok: true; fuelCostCents: number; fuelGallons: number }
  | { ok: false; error: string };

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
    // Ferry path: owner provides the aircraft fueled. Same shape as rental
    // here; brief just acknowledges the contract and advances state.
    if (
      careerRow.activeAircraftSource === "rental" ||
      careerRow.activeAircraftSource === "ferry"
    ) {
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
      originRow.icao,
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
