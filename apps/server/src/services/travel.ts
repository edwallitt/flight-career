import {
  calculateTransfer,
  haversineNm,
  type TransferEstimate,
  type TransferInputs,
  type TransferType,
} from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  ownedAircraft,
  transfers,
} from "../db/schema.js";
import { fuelPriceCentsPerGal } from "./jobLifecycle.js";
import { tickJobGeneration } from "./jobBoard.js";

export interface TransferRequest {
  type: TransferType;
  destinationIcao: string;
  ownedAircraftId?: number;
}

export interface TransferPreview {
  estimate: TransferEstimate;
  willArriveAt: number;
  originIcao: string;
  destinationIcao: string;
  destinationName: string;
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
      destinationIcao: ctx.destRow.icao,
      destinationName: ctx.destRow.name,
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

    const newSimTime =
      ctx.careerRow.simDateTime + estimate.durationMinutes * 60_000;
    const movesPilot = req.type === "pilot" || req.type === "pilot_aircraft";
    const movesAircraft =
      req.type === "pilot_aircraft" || req.type === "aircraft";

    tx.update(career)
      .set({
        cash: ctx.careerRow.cash - estimate.costCents,
        simDateTime: newSimTime,
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

    const insertResult = tx
      .insert(transfers)
      .values({
        type: req.type,
        originIcao: ctx.originIcao,
        destinationIcao: ctx.destRow.icao,
        ownedAircraftId: ctx.ownedRow?.id ?? null,
        distanceNm: ctx.distanceNm,
        costCents: estimate.costCents,
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
      arrivedAtSimTime: newSimTime,
    };
  });

  // Sweep stale jobs and top up the board now that sim time has advanced.
  // Run outside the transfer transaction so a tick failure doesn't roll back
  // the player's travel.
  if (result.ok) {
    try {
      tickJobGeneration();
    } catch {
      // Tick failures are non-fatal — the next regular tick will catch up.
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
  currentLocationIcao: string;
  currentLocationName: string;
}

export function listOwnedAircraftForTransfer(): OwnedAircraftForTransfer[] {
  const rows = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .where(eq(ownedAircraft.status, "available"))
    .all();
  return rows.map(({ owned, type, ap }) => ({
    id: owned.id,
    tailNumber: owned.tailNumber,
    aircraftTypeId: type.id,
    manufacturer: type.manufacturer,
    model: type.model,
    cls: type.class,
    currentLocationIcao: owned.currentLocationIcao,
    currentLocationName: ap.name,
  }));
}
