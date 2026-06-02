import {
  calculateTransfer,
  haversineNm,
  type TransferEstimate,
  type TransferInputs,
  type TransferType,
} from "@flightcareer/shared";
import { eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  ownedAircraft,
  ratings,
  transfers,
} from "../db/schema.js";
import { fuelPriceCentsPerGal } from "./jobLifecycle.js";
import { tickJobGeneration } from "./jobBoard.js";
import { processLoanPayments } from "./purchase.js";

export interface TransferRequest {
  type: TransferType;
  destinationIcao: string;
  ownedAircraftId?: number;
}

export interface TransferPreview {
  estimate: TransferEstimate;
  willArriveAt: number;
  originIcao: string;
  originName: string;
  originLat: number;
  originLon: number;
  destinationIcao: string;
  destinationName: string;
  destinationLat: number;
  destinationLon: number;
  distanceNm: number;
}

export type PreviewResult =
  | { ok: true; preview: TransferPreview }
  | { ok: false; error: string };

export type ExecuteResult =
  | { ok: true; transferId: number; arrivedAtSimTime: number }
  | { ok: false; error: string };

interface ResolvedContext {
  careerRow: typeof career.$inferSelect;
  originIcao: string;
  originRow: typeof airports.$inferSelect;
  destRow: typeof airports.$inferSelect;
  distanceNm: number;
  inputs: TransferInputs;
  ownedRow: typeof ownedAircraft.$inferSelect | null;
  typeRow: typeof aircraftTypes.$inferSelect | null;
}

function resolveContext(req: TransferRequest): ResolvedContext | { error: string } {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return { error: "Career not found" };
  if (careerRow.activeJobId != null) {
    return { error: "Cannot travel while a job is active" };
  }

  const destination = req.destinationIcao.trim().toUpperCase();
  if (!destination) return { error: "Destination is required" };

  let originIcao: string;
  let ownedRow: typeof ownedAircraft.$inferSelect | null = null;
  let typeRow: typeof aircraftTypes.$inferSelect | null = null;

  if (req.type === "pilot") {
    originIcao = careerRow.currentLocationIcao;
  } else {
    if (req.ownedAircraftId == null) {
      return { error: "Aircraft is required for this transfer type" };
    }
    ownedRow =
      db
        .select()
        .from(ownedAircraft)
        .where(eq(ownedAircraft.id, req.ownedAircraftId))
        .get() ?? null;
    if (!ownedRow) return { error: "Owned aircraft not found" };
    if (ownedRow.status !== "available") {
      return { error: `Aircraft is not available (status: ${ownedRow.status})` };
    }
    typeRow =
      db
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, ownedRow.aircraftTypeId))
        .get() ?? null;
    if (!typeRow) return { error: "Aircraft type not found" };
    originIcao = ownedRow.currentLocationIcao;
  }

  if (originIcao === destination) {
    return { error: "Origin and destination are the same airport" };
  }

  const originRow = db
    .select()
    .from(airports)
    .where(eq(airports.icao, originIcao))
    .get();
  const destRow = db
    .select()
    .from(airports)
    .where(eq(airports.icao, destination))
    .get();
  if (!originRow) return { error: `Unknown origin airport: ${originIcao}` };
  if (!destRow) return { error: `Unknown destination airport: ${destination}` };

  const distanceNm = Math.round(
    haversineNm(
      { lat: originRow.lat, lon: originRow.lon },
      { lat: destRow.lat, lon: destRow.lon },
    ),
  );

  const inputs: TransferInputs = {
    type: req.type,
    originIcao,
    destinationIcao: destination,
    distanceNm,
    originSize: originRow.size,
    destinationSize: destRow.size,
  };

  if (req.type !== "pilot" && typeRow) {
    inputs.aircraftCruiseSpeedKts = typeRow.cruiseSpeedKts;
    inputs.aircraftFuelBurnGph = typeRow.fuelBurnGph;
    inputs.aircraftClass = typeRow.class;
    inputs.destinationFuelPriceCents = fuelPriceCentsPerGal(
      typeRow.fuelType,
      destRow.icao,
      destRow.baseFuelMultiplier,
    );
    inputs.destinationLandingFeeCents = destRow.baseLandingFee;
  }

  return { careerRow, originIcao, originRow, destRow, distanceNm, inputs, ownedRow, typeRow };
}

export function previewTransfer(req: TransferRequest): PreviewResult {
  const ctx = resolveContext(req);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const estimate = calculateTransfer(ctx.inputs);
  const willArriveAt =
    ctx.careerRow.simDateTime + estimate.durationMinutes * 60_000;

  return {
    ok: true,
    preview: {
      estimate,
      willArriveAt,
      originIcao: ctx.originIcao,
      originName: ctx.originRow.name,
      originLat: ctx.originRow.lat,
      originLon: ctx.originRow.lon,
      destinationIcao: ctx.destRow.icao,
      destinationName: ctx.destRow.name,
      destinationLat: ctx.destRow.lat,
      destinationLon: ctx.destRow.lon,
      distanceNm: ctx.distanceNm,
    },
  };
}

export function executeTransfer(req: TransferRequest): ExecuteResult {
  const result = db.transaction((tx): ExecuteResult => {
    const ctx = resolveContext(req);
    if ("error" in ctx) return { ok: false, error: ctx.error };

    const estimate = calculateTransfer(ctx.inputs);
    if (ctx.careerRow.cash < estimate.costCents) {
      return { ok: false, error: "Insufficient cash" };
    }

    const movesPilot = req.type === "pilot" || req.type === "pilot_aircraft";
    const movesAircraft =
      req.type === "pilot_aircraft" || req.type === "aircraft";

    tx.update(career)
      .set({
        cash: ctx.careerRow.cash - estimate.costCents,
        // Transfers are instantaneous on the world clock — they no longer
        // advance simDateTime, which would otherwise desync sim time from the
        // 1× real-time clock permanently (the tick only adds the real-time
        // delta, so any one-off bump here never gets reabsorbed).
        lastPlayedAt: Date.now(),
        currentLocationIcao: movesPilot
          ? ctx.destRow.icao
          : ctx.careerRow.currentLocationIcao,
      })
      .where(eq(career.id, 1))
      .run();

    if (movesAircraft && ctx.ownedRow) {
      tx.update(ownedAircraft)
        .set({
          currentLocationIcao: ctx.destRow.icao,
          airframeHours: ctx.ownedRow.airframeHours + estimate.aircraftHoursAccrued,
          engineHoursSinceOverhaul:
            ctx.ownedRow.engineHoursSinceOverhaul + estimate.aircraftHoursAccrued,
          hoursSince100hr:
            ctx.ownedRow.hoursSince100hr + estimate.aircraftHoursAccrued,
        })
        .where(eq(ownedAircraft.id, ctx.ownedRow.id))
        .run();
    }

    // pilot_aircraft = player flies the aircraft, so they accumulate hours
    // toward the rating. aircraft-only = a contract pilot ferries it; the
    // player wasn't flying, so no rating credit.
    if (req.type === "pilot_aircraft" && ctx.typeRow) {
      const ratingRow = tx
        .select()
        .from(ratings)
        .where(eq(ratings.class, ctx.typeRow.class))
        .get();
      if (ratingRow) {
        tx.update(ratings)
          .set({
            hoursInClass: ratingRow.hoursInClass + estimate.aircraftHoursAccrued,
          })
          .where(eq(ratings.class, ctx.typeRow.class))
          .run();
      }
    }

    const insertResult = tx
      .insert(transfers)
      .values({
        type: req.type,
        originIcao: ctx.originIcao,
        destinationIcao: ctx.destRow.icao,
        ownedAircraftId: ctx.ownedRow?.id ?? null,
        distanceNm: ctx.distanceNm,
        costCents: estimate.costCents,
        // Recorded for history/flavor only. Transfers no longer advance the
        // world clock, so this is the estimated flight time, not elapsed sim
        // time.
        simTimeAdvancedMinutes: estimate.durationMinutes,
        aircraftHoursAccrued: estimate.aircraftHoursAccrued,
        fuelGallonsBurned: estimate.fuelGallonsBurned,
        executedAt: ctx.careerRow.simDateTime,
      })
      .returning({ id: transfers.id })
      .all();

    return {
      ok: true,
      transferId: insertResult[0]!.id,
      arrivedAtSimTime: ctx.careerRow.simDateTime,
    };
  });

  // Sweep stale jobs and process loans so the board reflects the player's new
  // location. The transfer itself no longer advances sim time, but the tick
  // still folds in real-time elapsed since the last sync. Run outside the
  // transfer transaction so a tick failure doesn't roll back the player's
  // travel.
  if (result.ok) {
    try {
      tickJobGeneration();
    } catch {
      // Tick failures are non-fatal — the next regular tick will catch up.
    }
    try {
      processLoanPayments();
    } catch {
      // Loan payment failures are non-fatal — they'll be picked up next tick.
    }
  }

  return result;
}

export interface OwnedAircraftForTransfer {
  id: number;
  tailNumber: string;
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: "SEP" | "MEP" | "SET" | "JET";
  status: "available" | "in_maintenance" | "in_flight" | "committed";
  currentLocationIcao: string;
  currentLocationName: string;
}

export function listOwnedAircraftForTransfer(): OwnedAircraftForTransfer[] {
  const rows = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .where(ne(ownedAircraft.status, "sold"))
    .all();
  return rows.map(({ owned, type, ap }) => ({
    id: owned.id,
    tailNumber: owned.tailNumber,
    aircraftTypeId: type.id,
    manufacturer: type.manufacturer,
    model: type.model,
    cls: type.class,
    status: owned.status as Exclude<typeof owned.status, "sold">,
    currentLocationIcao: owned.currentLocationIcao,
    currentLocationName: ap.name,
  }));
}
