import type { ShockEvent } from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  airports,
  career,
  fuelPriceCurrent,
  fuelPriceSnapshots,
  fuelShocks,
} from "../../db/schema.js";
import { resetTestDb } from "../../__tests__/helpers/fixtures.js";
import {
  DRIFT_INTERVAL_MS,
  ensureFuelPriceCurrent,
  forceSpawnShock,
  fuelPriceCentsPerGal,
  getActiveShocks,
  getFuelPrice,
  getFuelPriceHistory,
  getFuelPricesByIcao,
  getHeadlineShock,
  processFuelDriftTick,
} from "../fuelDrift.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

function getSimNow(): number {
  return db.select().from(career).where(eq(career.id, 1)).get()!.simDateTime;
}

function setSimNow(now: number): void {
  db.update(career).set({ simDateTime: now }).where(eq(career.id, 1)).run();
}

function makeShock(over: Partial<ShockEvent> = {}): ShockEvent {
  return {
    type: "supply_tightness",
    severity: "moderate",
    multiplier: 1.4,
    affectsFuelType: "both",
    affectsRegion: "global",
    durationTicks: 8,
    startedAt: getSimNow(),
    description: "Test shock",
    headline: "Prices spike",
    ...over,
  };
}

describe("ensureFuelPriceCurrent", () => {
  beforeEach(() => resetTestDb());

  it("seeds one row per (airport, supported fuel type) on first call", () => {
    const inserted = ensureFuelPriceCurrent(getSimNow());
    expect(inserted).toBeGreaterThan(0);

    const aps = db.select().from(airports).all();
    const expected =
      aps.filter((a) => a.hasAvgas).length + aps.filter((a) => a.hasJetA).length;
    expect(inserted).toBe(expected);

    const rows = db.select().from(fuelPriceCurrent).all();
    expect(rows.length).toBe(expected);
    for (const row of rows) {
      expect(row.currentPriceCents).toBe(row.basePriceCents);
      expect(row.currentShockId).toBeNull();
    }
  });

  it("is idempotent: a second call seeds nothing", () => {
    ensureFuelPriceCurrent(getSimNow());
    expect(ensureFuelPriceCurrent(getSimNow())).toBe(0);
  });

  it("uses the airport baseFuelMultiplier in the seeded base price", () => {
    ensureFuelPriceCurrent(getSimNow());
    // CYHZ is a major airport with multiplier 1.0 → base = 700 cents/gal avgas.
    const cyhz = getFuelPrice("CYHZ", "avgas")!;
    const cyhzAirport = db
      .select()
      .from(airports)
      .where(eq(airports.icao, "CYHZ"))
      .get()!;
    expect(cyhz.basePriceCents).toBe(
      Math.round(700 * cyhzAirport.baseFuelMultiplier),
    );
  });
});

describe("processFuelDriftTick", () => {
  beforeEach(() => resetTestDb());

  it("seeds prices on first tick, updates lastDriftAt to simNow, creates a snapshot per row", () => {
    const now = getSimNow();
    const result = processFuelDriftTick(now);
    expect(result.airportsUpdated).toBeGreaterThan(0);
    expect(result.snapshotsCreated).toBe(result.airportsUpdated);

    const rows = db.select().from(fuelPriceCurrent).all();
    for (const row of rows) {
      expect(row.lastDriftAt).toBe(now);
    }

    const snaps = db.select().from(fuelPriceSnapshots).all();
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      expect(s.effectiveAt).toBe(now);
      expect(s.pricePerGal).toBeGreaterThan(0);
    }
  });

  it("decrements ticksRemaining on active shocks and expires when zero", () => {
    forceSpawnShock(makeShock({ durationTicks: 2 }));
    const result1 = processFuelDriftTick(getSimNow());
    expect(result1.shocksExpired).toBe(0);
    const after1 = db.select().from(fuelShocks).all()[0]!;
    expect(after1.ticksRemaining).toBe(1);
    expect(after1.status).toBe("active");

    setSimNow(getSimNow() + DRIFT_INTERVAL_MS);
    const result2 = processFuelDriftTick(getSimNow());
    expect(result2.shocksExpired).toBe(1);
    const after2 = db.select().from(fuelShocks).all()[0]!;
    expect(after2.ticksRemaining).toBe(0);
    expect(after2.status).toBe("expired");
  });

  it("applies an active global shock to every fuel-price row's currentShockId", () => {
    const shockId = forceSpawnShock(makeShock());
    processFuelDriftTick(getSimNow());
    const rows = db.select().from(fuelPriceCurrent).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.currentShockId).toBe(shockId);
    }
  });

  it("does not apply a shock that targets a different fuel type", () => {
    forceSpawnShock(
      makeShock({ affectsFuelType: "jet-a", affectsRegion: "global" }),
    );
    processFuelDriftTick(getSimNow());
    const avgasRows = db
      .select()
      .from(fuelPriceCurrent)
      .where(eq(fuelPriceCurrent.fuelType, "avgas"))
      .all();
    for (const r of avgasRows) {
      expect(r.currentShockId).toBeNull();
    }
    const jetRows = db
      .select()
      .from(fuelPriceCurrent)
      .where(eq(fuelPriceCurrent.fuelType, "jet-a"))
      .all();
    expect(jetRows.length).toBeGreaterThan(0);
    for (const r of jetRows) {
      expect(r.currentShockId).not.toBeNull();
    }
  });

  it("when two shocks overlap, the strongest multiplier wins", () => {
    const mild = forceSpawnShock(makeShock({ multiplier: 1.1 }));
    const strong = forceSpawnShock(makeShock({ multiplier: 1.6 }));
    processFuelDriftTick(getSimNow());
    const rows = db.select().from(fuelPriceCurrent).all();
    for (const r of rows) {
      expect(r.currentShockId).toBe(strong);
      expect(r.currentShockId).not.toBe(mild);
    }
  });
});

describe("getFuelPrice / fuelPriceCentsPerGal / getFuelPricesByIcao", () => {
  beforeEach(() => resetTestDb());

  it("returns null before the price table is seeded", () => {
    expect(getFuelPrice("CYHZ", "avgas")).toBeNull();
  });

  it("returns the live row after seeding", () => {
    ensureFuelPriceCurrent(getSimNow());
    const row = getFuelPrice("CYHZ", "avgas");
    expect(row).not.toBeNull();
    expect(row!.airportIcao).toBe("CYHZ");
    expect(row!.fuelType).toBe("avgas");
  });

  it("fuelPriceCentsPerGal falls back to the static formula when no live row exists", () => {
    const cyhzAirport = db
      .select()
      .from(airports)
      .where(eq(airports.icao, "CYHZ"))
      .get()!;
    const fallback = fuelPriceCentsPerGal(
      "avgas",
      "CYHZ",
      cyhzAirport.baseFuelMultiplier,
    );
    expect(fallback).toBe(Math.round(700 * cyhzAirport.baseFuelMultiplier));
  });

  it("fuelPriceCentsPerGal prefers the live row over the fallback once seeded", () => {
    ensureFuelPriceCurrent(getSimNow());
    // Mutate the live row to a known value.
    db.update(fuelPriceCurrent)
      .set({ currentPriceCents: 999 })
      .where(
        eq(fuelPriceCurrent.airportIcao, "CYHZ"),
      )
      .run();
    const result = fuelPriceCentsPerGal("avgas", "CYHZ", 1.0);
    expect(result).toBe(999);
  });

  it("getFuelPricesByIcao bundles avgas and jet-a per airport", () => {
    ensureFuelPriceCurrent(getSimNow());
    const map = getFuelPricesByIcao(["CYHZ", "CYQM"]);
    expect(map.size).toBeGreaterThan(0);
    const cyhz = map.get("CYHZ")!;
    expect(cyhz.avgas).not.toBeNull();
    expect(cyhz.jetA).not.toBeNull();
  });

  it("getFuelPricesByIcao returns an empty map for an empty input", () => {
    ensureFuelPriceCurrent(getSimNow());
    expect(getFuelPricesByIcao([])).toEqual(new Map());
  });
});

describe("getFuelPriceHistory", () => {
  beforeEach(() => resetTestDb());

  it("returns rows within the requested window, oldest-first", () => {
    const start = getSimNow();
    // Run a few drift ticks at increasing sim times to lay down snapshots.
    for (let i = 0; i < 4; i++) {
      setSimNow(start + i * DRIFT_INTERVAL_MS);
      processFuelDriftTick(getSimNow());
    }
    setSimNow(start + 4 * DRIFT_INTERVAL_MS);

    const history = getFuelPriceHistory({
      airportIcao: "CYHZ",
      fuelType: "avgas",
      windowDays: 30,
    });
    expect(history.length).toBe(4);
    // Sorted ascending by snapshotAt.
    for (let i = 1; i < history.length; i++) {
      expect(history[i]!.snapshotAt).toBeGreaterThanOrEqual(
        history[i - 1]!.snapshotAt,
      );
    }
    for (const p of history) {
      expect(p.priceCents).toBeGreaterThan(0);
    }
  });

  it("excludes rows older than windowDays", () => {
    // Tick once way in the past, then jump forward.
    processFuelDriftTick(getSimNow());
    setSimNow(getSimNow() + 60 * SIM_DAY_MS);
    processFuelDriftTick(getSimNow());

    const recent = getFuelPriceHistory({
      airportIcao: "CYHZ",
      fuelType: "avgas",
      windowDays: 7,
    });
    // Only the recent snapshot survives a 7-day window.
    expect(recent.length).toBe(1);
  });
});

describe("getActiveShocks / getHeadlineShock", () => {
  beforeEach(() => resetTestDb());

  it("returns active shocks newest-first; expired shocks excluded", () => {
    forceSpawnShock(makeShock({ headline: "first" }));
    setSimNow(getSimNow() + DRIFT_INTERVAL_MS);
    forceSpawnShock(makeShock({ headline: "second", startedAt: getSimNow() }));

    const list = getActiveShocks();
    expect(list).toHaveLength(2);
    expect(list[0]!.headline).toBe("second"); // newest first
    expect(list[1]!.headline).toBe("first");

    // Expire the older one.
    db.update(fuelShocks)
      .set({ status: "expired" })
      .where(eq(fuelShocks.headline, "first"))
      .run();
    expect(getActiveShocks()).toHaveLength(1);
  });

  it("getHeadlineShock returns the most-severe shock; recency breaks ties", () => {
    forceSpawnShock(makeShock({ severity: "mild", headline: "mild" }));
    forceSpawnShock(makeShock({ severity: "severe", headline: "severe" }));
    forceSpawnShock(makeShock({ severity: "moderate", headline: "moderate" }));

    const head = getHeadlineShock();
    expect(head).not.toBeNull();
    expect(head!.headline).toBe("severe");
  });

  it("returns null when no shocks are active", () => {
    expect(getHeadlineShock()).toBeNull();
  });
});

describe("forceSpawnShock", () => {
  beforeEach(() => resetTestDb());

  it("inserts an active shock with ticksRemaining = durationTicks", () => {
    const id = forceSpawnShock(makeShock({ durationTicks: 5 }));
    expect(id).toBeGreaterThan(0);
    const row = db.select().from(fuelShocks).where(eq(fuelShocks.id, id)).get()!;
    expect(row.status).toBe("active");
    expect(row.ticksRemaining).toBe(5);
    expect(row.durationTicks).toBe(5);
  });
});
