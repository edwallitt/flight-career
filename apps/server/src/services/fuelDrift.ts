// Fuel-price drift service. Owns the live `fuel_price_current` table and the
// shock lifecycle. Pure-logic helpers (computeNextPrice, maybeSpawnShock) live
// in @flightcareer/shared/fuel; this file is the I/O glue.
//
// Ticking model: one *drift tick* every 12 generation ticks (≈6 sim hours).
// jobBoard.tickJobGeneration calls processFuelDriftTick every 12 ticks.

import {
  compareShockSeverity,
  computeNextPrice,
  maybeSpawnShock,
  type FuelType,
  type ShockEvent,
} from "@flightcareer/shared";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  airports,
  career,
  fuelPriceCurrent,
  fuelPriceSnapshots,
  fuelShocks,
} from "../db/schema.js";

// Static base prices, in cents per gallon, *before* the airport's
// baseFuelMultiplier. Mirrors the legacy fuelPriceCentsPerGal formula so the
// transition from formula to live state preserves seeded values.
const BASE_PRICE_CENTS_PER_GAL: Record<FuelType, number> = {
  avgas: 700,
  "jet-a": 550,
};

function computeBasePriceCents(
  fuelType: FuelType,
  baseFuelMultiplier: number,
): number {
  return Math.round(BASE_PRICE_CENTS_PER_GAL[fuelType] * baseFuelMultiplier);
}

// Minimal RNG seeded from time. Drift is not security-sensitive — uniform
// numbers in [0,1) is all we need.
function rngFromCryptoSeed(): () => number {
  let s = (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

// Make sure every (airport, supported-fuel-type) has a fuel_price_current row.
// Idempotent — safe to call from seed and from the first drift tick.
export function ensureFuelPriceCurrent(simNow: number): number {
  const existingRows = db.select().from(fuelPriceCurrent).all();
  const have = new Set<string>(
    existingRows.map((r) => `${r.airportIcao}::${r.fuelType}`),
  );
  const airportRows = db.select().from(airports).all();
  const inserts: (typeof fuelPriceCurrent.$inferInsert)[] = [];
  for (const a of airportRows) {
    if (a.hasAvgas && !have.has(`${a.icao}::avgas`)) {
      const base = computeBasePriceCents("avgas", a.baseFuelMultiplier);
      inserts.push({
        airportIcao: a.icao,
        fuelType: "avgas",
        currentPriceCents: base,
        basePriceCents: base,
        lastDriftAt: simNow,
        currentShockId: null,
      });
    }
    if (a.hasJetA && !have.has(`${a.icao}::jet-a`)) {
      const base = computeBasePriceCents("jet-a", a.baseFuelMultiplier);
      inserts.push({
        airportIcao: a.icao,
        fuelType: "jet-a",
        currentPriceCents: base,
        basePriceCents: base,
        lastDriftAt: simNow,
        currentShockId: null,
      });
    }
  }
  if (inserts.length > 0) {
    db.insert(fuelPriceCurrent).values(inserts).run();
  }
  return inserts.length;
}

// Resolve which shock applies to a given (airport, fuel_type). Region matching
// is naive: 'global' applies everywhere, 'maritime' to airports whose region
// string contains "Maritime"/"Atlantic", 'east_coast' to airports along the
// eastern seaboard. The seed defines region strings — we pattern-match against
// them rather than introducing a new enum.
function regionMatches(
  affects: string,
  airportRegion: string,
): boolean {
  if (affects === "global") return true;
  const r = airportRegion.toLowerCase();
  if (affects === "maritime") {
    return r.includes("maritime") || r.includes("atlantic");
  }
  if (affects === "east_coast") {
    return (
      r.includes("east") ||
      r.includes("atlantic") ||
      r.includes("maritime") ||
      r.includes("northeast")
    );
  }
  return false;
}

function shockApplies(
  shock: typeof fuelShocks.$inferSelect,
  fuelType: FuelType,
  airportRegion: string,
): boolean {
  if (
    shock.affectsFuelType !== "both" &&
    shock.affectsFuelType !== fuelType
  ) {
    return false;
  }
  return regionMatches(shock.affectsRegion, airportRegion);
}

export interface DriftResult {
  airportsUpdated: number;
  snapshotsCreated: number;
  shockEvent: ShockEvent | null;
  shocksExpired: number;
}

export function processFuelDriftTick(simNow: number): DriftResult {
  ensureFuelPriceCurrent(simNow);

  const rng = rngFromCryptoSeed();

  // Decrement ticks_remaining on active shocks; expire when hitting zero.
  // Active shocks include any new shock spawned in this same tick.
  let shocksExpired = 0;
  const activeBefore = db
    .select()
    .from(fuelShocks)
    .where(eq(fuelShocks.status, "active"))
    .all();
  for (const s of activeBefore) {
    const next = s.ticksRemaining - 1;
    if (next <= 0) {
      db.update(fuelShocks)
        .set({ ticksRemaining: 0, status: "expired" })
        .where(eq(fuelShocks.id, s.id))
        .run();
      shocksExpired += 1;
    } else {
      db.update(fuelShocks)
        .set({ ticksRemaining: next })
        .where(eq(fuelShocks.id, s.id))
        .run();
    }
  }

  // Maybe spawn a new shock. Persist before applying drift so the new shock
  // affects this tick's prices.
  const spawned = maybeSpawnShock(rng, simNow);
  if (spawned) {
    db.insert(fuelShocks)
      .values({
        type: spawned.type,
        severity: spawned.severity,
        multiplier: spawned.multiplier,
        affectsFuelType: spawned.affectsFuelType,
        affectsRegion: spawned.affectsRegion,
        durationTicks: spawned.durationTicks,
        ticksRemaining: spawned.durationTicks,
        startedAt: spawned.startedAt,
        description: spawned.description,
        headline: spawned.headline,
        status: "active",
      })
      .run();
  }

  const activeShocks = db
    .select()
    .from(fuelShocks)
    .where(eq(fuelShocks.status, "active"))
    .all();

  // Pre-load airport regions so we can resolve shock applicability without
  // joining per-row.
  const airportRows = db.select().from(airports).all();
  const regionByIcao = new Map<string, string>(
    airportRows.map((a) => [a.icao, a.region]),
  );

  const currentRows = db.select().from(fuelPriceCurrent).all();
  let updated = 0;
  let snapshots = 0;
  for (const row of currentRows) {
    const region = regionByIcao.get(row.airportIcao);
    if (!region) continue;

    // Pick the strongest applicable shock — multiplier furthest from 1.0.
    let chosenShock: typeof fuelShocks.$inferSelect | null = null;
    for (const s of activeShocks) {
      if (!shockApplies(s, row.fuelType, region)) continue;
      if (
        !chosenShock ||
        Math.abs(s.multiplier - 1) > Math.abs(chosenShock.multiplier - 1)
      ) {
        chosenShock = s;
      }
    }
    const shockMultiplier = chosenShock ? chosenShock.multiplier : 1;
    const ticksSinceLastDrift = Math.max(
      1,
      Math.round((simNow - row.lastDriftAt) / DRIFT_INTERVAL_MS),
    );

    const nextPrice = computeNextPrice({
      currentPriceCents: row.currentPriceCents,
      basePriceCents: row.basePriceCents,
      rng,
      ticksSinceLastDrift,
      shockMultiplier,
    });

    db.update(fuelPriceCurrent)
      .set({
        currentPriceCents: nextPrice,
        lastDriftAt: simNow,
        currentShockId: chosenShock?.id ?? null,
      })
      .where(eq(fuelPriceCurrent.id, row.id))
      .run();
    updated += 1;

    db.insert(fuelPriceSnapshots)
      .values({
        airportIcao: row.airportIcao,
        fuelType: row.fuelType,
        effectiveAt: simNow,
        pricePerGal: nextPrice,
      })
      .onConflictDoNothing()
      .run();
    snapshots += 1;
  }

  return {
    airportsUpdated: updated,
    snapshotsCreated: snapshots,
    shockEvent: spawned,
    shocksExpired,
  };
}

// Sim-ms between drift ticks (6 sim hours). Used both by the tick scheduler
// and by ticksSinceLastDrift catch-up math.
export const DRIFT_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface FuelPriceRow {
  airportIcao: string;
  fuelType: FuelType;
  currentPriceCents: number;
  basePriceCents: number;
}

export function getFuelPrice(
  airportIcao: string,
  fuelType: FuelType,
): FuelPriceRow | null {
  const row = db
    .select()
    .from(fuelPriceCurrent)
    .where(
      and(
        eq(fuelPriceCurrent.airportIcao, airportIcao),
        eq(fuelPriceCurrent.fuelType, fuelType),
      ),
    )
    .get();
  return row
    ? {
        airportIcao: row.airportIcao,
        fuelType: row.fuelType,
        currentPriceCents: row.currentPriceCents,
        basePriceCents: row.basePriceCents,
      }
    : null;
}

// Resolve a price for a (airport, fuel_type), falling back to the static
// formula if no live row exists yet (first run before any drift tick).
// Callers depend on this never throwing — the fuel-cost paths should be
// resilient to the drift tables being empty.
export function fuelPriceCentsPerGal(
  fuelType: FuelType,
  airportIcao: string,
  baseFuelMultiplier: number,
): number {
  const live = getFuelPrice(airportIcao, fuelType);
  if (live) return live.currentPriceCents;
  return computeBasePriceCents(fuelType, baseFuelMultiplier);
}

export function getFuelPricesByIcao(
  airportIcaos: string[],
): Map<string, { avgas: number | null; jetA: number | null }> {
  const out = new Map<string, { avgas: number | null; jetA: number | null }>();
  if (airportIcaos.length === 0) return out;
  const rows = db.select().from(fuelPriceCurrent).all();
  for (const r of rows) {
    if (!airportIcaos.includes(r.airportIcao)) continue;
    const entry = out.get(r.airportIcao) ?? { avgas: null, jetA: null };
    if (r.fuelType === "avgas") entry.avgas = r.currentPriceCents;
    else entry.jetA = r.currentPriceCents;
    out.set(r.airportIcao, entry);
  }
  return out;
}

export interface PriceHistoryPoint {
  snapshotAt: number;
  priceCents: number;
}

export function getFuelPriceHistory(input: {
  airportIcao: string;
  fuelType: FuelType;
  windowDays: number;
}): PriceHistoryPoint[] {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  const simNow = careerRow?.simDateTime ?? Date.now();
  const cutoff = simNow - input.windowDays * 24 * 60 * 60 * 1000;
  const rows = db
    .select()
    .from(fuelPriceSnapshots)
    .where(
      and(
        eq(fuelPriceSnapshots.airportIcao, input.airportIcao),
        eq(fuelPriceSnapshots.fuelType, input.fuelType),
        gte(fuelPriceSnapshots.effectiveAt, cutoff),
      ),
    )
    .orderBy(asc(fuelPriceSnapshots.effectiveAt))
    .all();
  return rows.map((r) => ({
    snapshotAt: r.effectiveAt,
    priceCents: Math.round(r.pricePerGal),
  }));
}

export interface ActiveShockSummary {
  id: number;
  type: ShockEvent["type"];
  severity: ShockEvent["severity"];
  multiplier: number;
  affectsFuelType: ShockEvent["affectsFuelType"];
  affectsRegion: string;
  ticksRemaining: number;
  startedAt: number;
  headline: string;
  description: string;
}

export function getActiveShocks(): ActiveShockSummary[] {
  const rows = db
    .select()
    .from(fuelShocks)
    .where(eq(fuelShocks.status, "active"))
    .orderBy(desc(fuelShocks.startedAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity,
    multiplier: r.multiplier,
    affectsFuelType: r.affectsFuelType,
    affectsRegion: r.affectsRegion,
    ticksRemaining: r.ticksRemaining,
    startedAt: r.startedAt,
    headline: r.headline,
    description: r.description,
  }));
}

// Most-severe active shock, used by the Job Board banner. When ties happen
// the more recent shock wins.
export function getHeadlineShock(): ActiveShockSummary | null {
  const all = getActiveShocks();
  if (all.length === 0) return null;
  const sorted = [...all].sort((a, b) => {
    const sev = compareShockSeverity(a, b);
    if (sev !== 0) return sev;
    return b.startedAt - a.startedAt;
  });
  return sorted[0] ?? null;
}

// Convenience: how many drift ticks we've executed in total. Used by jobBoard
// to schedule one drift tick every DRIFT_TICK_RATIO generation ticks.
export const DRIFT_TICK_RATIO = 12;

// Force-spawn a shock for testing/dev. Reuses the spawn template machinery
// indirectly by accepting a fully-formed ShockEvent. Returns the persisted id.
export function forceSpawnShock(input: ShockEvent): number {
  const insert = db
    .insert(fuelShocks)
    .values({
      type: input.type,
      severity: input.severity,
      multiplier: input.multiplier,
      affectsFuelType: input.affectsFuelType,
      affectsRegion: input.affectsRegion,
      durationTicks: input.durationTicks,
      ticksRemaining: input.durationTicks,
      startedAt: input.startedAt,
      description: input.description,
      headline: input.headline,
      status: "active",
    })
    .returning({ id: fuelShocks.id })
    .all();
  return insert[0]?.id ?? 0;
}

