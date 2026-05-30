import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { aircraftListings, career } from "../../db/schema.js";
import { resetTestDb } from "../../__tests__/helpers/fixtures.js";
import {
  getListingById,
  getListings,
  maybeRefreshMarketplace,
  refreshMarketplace,
  rngFromSeed,
} from "../marketplace.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

/** Insert one minimal listing for filter/sort assertions without depending on RNG. */
function insertListing(opts: {
  aircraftTypeId?: string;
  tailNumber?: string;
  locationIcao?: string;
  airframeHours?: number;
  askingPriceCents?: number;
  status?: "available" | "sold" | "expired";
  expiresAt?: number;
}): number {
  const now =
    db.select().from(career).where(eq(career.id, 1)).get()?.simDateTime ??
    Date.UTC(2026, 0, 1);
  const row = db
    .insert(aircraftListings)
    .values({
      aircraftTypeId: opts.aircraftTypeId ?? "bonanza_g36",
      tailNumber: opts.tailNumber ?? "C-FTEST",
      locationIcao: opts.locationIcao ?? "CYHZ",
      airframeHours: opts.airframeHours ?? 2000,
      engineHoursSinceOverhaul: 200,
      hoursSince100hr: 30,
      hoursSinceAnnual: 90,
      askingPriceCents: opts.askingPriceCents ?? 500_000_00,
      conditionGrade: "good",
      listedAt: now,
      expiresAt: opts.expiresAt ?? now + 30 * SIM_DAY_MS,
      status: opts.status ?? "available",
      descriptionShort: "Test listing",
    })
    .returning({ id: aircraftListings.id })
    .get();
  return row!.id;
}

describe("refreshMarketplace", () => {
  beforeEach(() => resetTestDb());

  it("is deterministic for a given seed", () => {
    const a = refreshMarketplace(8, rngFromSeed(1234));
    const ids = db
      .select({ id: aircraftListings.id, type: aircraftListings.aircraftTypeId })
      .from(aircraftListings)
      .all()
      .map((r) => r.type);
    resetTestDb();
    const b = refreshMarketplace(8, rngFromSeed(1234));
    const ids2 = db
      .select({ id: aircraftListings.id, type: aircraftListings.aircraftTypeId })
      .from(aircraftListings)
      .all()
      .map((r) => r.type);
    expect(a.added).toBe(b.added);
    expect(ids).toEqual(ids2);
  });

  it("tops up to target after expiry", () => {
    refreshMarketplace(8, rngFromSeed(1));
    const before = db
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.status, "available"))
      .all().length;
    expect(before).toBe(8);

    // Jump sim time past every listing's expiresAt.
    const now = db.select().from(career).where(eq(career.id, 1)).get()!.simDateTime;
    db.update(career)
      .set({ simDateTime: now + 365 * SIM_DAY_MS })
      .where(eq(career.id, 1))
      .run();

    const after = refreshMarketplace(8, rngFromSeed(2));
    expect(after.expired).toBe(8);
    expect(after.added).toBeGreaterThan(0);
    const available = db
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.status, "available"))
      .all().length;
    expect(available).toBe(8);
  });
});

describe("maybeRefreshMarketplace", () => {
  beforeEach(() => resetTestDb());

  function setSimNow(now: number): void {
    db.update(career).set({ simDateTime: now }).where(eq(career.id, 1)).run();
  }

  it("refreshes on first call, then no-ops until the sim-time interval elapses", () => {
    // First call has no anchor → refreshes and records the anchor.
    const first = maybeRefreshMarketplace(8, rngFromSeed(1));
    expect(first).not.toBeNull();

    // A call within the 24 sim-hour window is gated out (returns null).
    const now = db.select().from(career).where(eq(career.id, 1)).get()!.simDateTime;
    setSimNow(now + 12 * 60 * 60 * 1000); // +12h, still inside the interval
    expect(maybeRefreshMarketplace(8, rngFromSeed(2))).toBeNull();

    // Past the interval, it refreshes again.
    setSimNow(now + 25 * 60 * 60 * 1000); // +25h, interval elapsed
    expect(maybeRefreshMarketplace(8, rngFromSeed(3))).not.toBeNull();
  });
});

describe("getListings", () => {
  beforeEach(() => resetTestDb());

  it("excludes non-available listings", () => {
    insertListing({ tailNumber: "C-FAVL", status: "available" });
    insertListing({ tailNumber: "C-FEXP", status: "expired" });
    insertListing({ tailNumber: "C-FSLD", status: "sold" });
    const rows = getListings({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tailNumber).toBe("C-FAVL");
  });

  it("sorts by price ascending by default (no player location)", () => {
    insertListing({ tailNumber: "C-FHI", askingPriceCents: 900_000_00 });
    insertListing({ tailNumber: "C-FLO", askingPriceCents: 100_000_00 });
    insertListing({ tailNumber: "C-FMD", askingPriceCents: 500_000_00 });
    const rows = getListings({});
    expect(rows.map((r) => r.tailNumber)).toEqual(["C-FLO", "C-FMD", "C-FHI"]);
  });

  it("sorts by price_desc when asked", () => {
    insertListing({ tailNumber: "C-FA", askingPriceCents: 100_000_00 });
    insertListing({ tailNumber: "C-FB", askingPriceCents: 900_000_00 });
    const rows = getListings({ sortBy: "price_desc" });
    expect(rows.map((r) => r.tailNumber)).toEqual(["C-FB", "C-FA"]);
  });

  it("sorts by airframe hours ascending", () => {
    insertListing({ tailNumber: "C-FNEW", airframeHours: 500 });
    insertListing({ tailNumber: "C-FOLD", airframeHours: 5000 });
    const rows = getListings({ sortBy: "hours_asc" });
    expect(rows.map((r) => r.tailNumber)).toEqual(["C-FNEW", "C-FOLD"]);
  });

  it("filters by class", () => {
    insertListing({ tailNumber: "C-FSEP", aircraftTypeId: "bonanza_g36" }); // SEP
    insertListing({ tailNumber: "C-FMEP", aircraftTypeId: "baron_g58" }); // MEP
    const sepOnly = getListings({ filterByClass: ["SEP"] });
    expect(sepOnly.map((r) => r.tailNumber)).toEqual(["C-FSEP"]);
  });

  it("filters by maxPriceCents", () => {
    insertListing({ tailNumber: "C-FCHE", askingPriceCents: 200_000_00 });
    insertListing({ tailNumber: "C-FEXP", askingPriceCents: 800_000_00 });
    const cheap = getListings({ maxPriceCents: 300_000_00 });
    expect(cheap.map((r) => r.tailNumber)).toEqual(["C-FCHE"]);
  });

  it("defaults to distance_asc when playerLocationIcao is provided and populates distanceFromPlayerNm", () => {
    insertListing({ tailNumber: "C-FHZ", locationIcao: "CYHZ" });
    insertListing({ tailNumber: "C-FQM", locationIcao: "CYQM" });
    const rows = getListings({ playerLocationIcao: "CYHZ" });
    // Player is at CYHZ — local listing has distance 0 and should sort first.
    expect(rows[0]!.locationIcao).toBe("CYHZ");
    expect(rows[0]!.distanceFromPlayerNm).toBe(0);
    expect(rows[1]!.distanceFromPlayerNm).toBeGreaterThan(0);
  });

  it("leaves distanceFromPlayerNm null when no player location is provided", () => {
    insertListing({ tailNumber: "C-FXX" });
    const rows = getListings({});
    expect(rows[0]!.distanceFromPlayerNm).toBeNull();
  });

  it("enriches with type details (label, fuel, cruise) and engineRemainingHours", () => {
    insertListing({ tailNumber: "C-FENR" });
    const [row] = getListings({});
    expect(row!.aircraftTypeManufacturer).toBe("Beechcraft");
    expect(row!.aircraftTypeModel).toBe("Bonanza G36");
    expect(row!.aircraftClass).toBe("SEP");
    expect(row!.fuelType).toBe("avgas");
    expect(row!.tboHours).toBeGreaterThan(0);
    expect(row!.engineRemainingHours).toBe(row!.tboHours - row!.engineHoursSinceOverhaul);
    expect(row!.depreciationFactor).toBeGreaterThan(0);
  });
});

describe("getListingById", () => {
  beforeEach(() => resetTestDb());

  it("returns the listing even when not available (purchase preview path)", () => {
    const id = insertListing({ tailNumber: "C-FONE", status: "expired" });
    const row = getListingById(id);
    expect(row).not.toBeNull();
    expect(row!.tailNumber).toBe("C-FONE");
  });

  it("returns null for unknown ids", () => {
    expect(getListingById(99_999)).toBeNull();
  });

  it("computes distance when playerLocationIcao is supplied", () => {
    const id = insertListing({ tailNumber: "C-FQM", locationIcao: "CYQM" });
    const local = getListingById(id, "CYQM");
    const remote = getListingById(id, "CYHZ");
    expect(local!.distanceFromPlayerNm).toBe(0);
    expect(remote!.distanceFromPlayerNm).toBeGreaterThan(0);
  });
});
