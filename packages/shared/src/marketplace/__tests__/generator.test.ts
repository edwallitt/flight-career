import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  generateListing,
  generateListingBatch,
  generateTailNumber,
  type ListingAircraftType,
  type ListingAirport,
  type ListingGenerationContext,
} from "../generator.js";

const AIRPORTS: ListingAirport[] = [
  { icao: "CYHZ", size: "major", hasMaintenance: true },
  { icao: "CYUL", size: "major", hasMaintenance: true },
  { icao: "KBOS", size: "major", hasMaintenance: true },
  { icao: "CYQM", size: "regional", hasMaintenance: true },
  { icao: "CYFC", size: "regional", hasMaintenance: false },
  { icao: "CYAW", size: "small", hasMaintenance: false },
  { icao: "CYYR", size: "remote", hasMaintenance: false },
];

const TYPES: ListingAircraftType[] = [
  { id: "c172", class: "SEP", basePurchasePriceCents: 30_000_000, tboHours: 2000 },
  { id: "bonanza_g36", class: "SEP", basePurchasePriceCents: 90_000_000, tboHours: 1700 },
  { id: "baron_g58", class: "MEP", basePurchasePriceCents: 150_000_000, tboHours: 1700 },
  { id: "caravan", class: "SET", basePurchasePriceCents: 250_000_000, tboHours: 3600 },
  { id: "cj4", class: "JET", basePurchasePriceCents: 900_000_000, tboHours: 5000 },
];

function makeCtx(seed: string): ListingGenerationContext {
  return {
    airports: AIRPORTS,
    aircraftTypes: TYPES,
    rng: seedrandom(seed),
    simNow: Date.UTC(2026, 4, 5, 0, 0, 0),
  };
}

describe("generateTailNumber", () => {
  it("produces N-numbers and C-Fxxx tail numbers", () => {
    const rng = seedrandom("tails");
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) seen.push(generateTailNumber(rng));
    const usOk = seen.filter((t) => /^N\d{3}[A-Z]{2}$/.test(t));
    const caOk = seen.filter((t) => /^C-F[A-Z]{3}$/.test(t));
    expect(usOk.length + caOk.length).toBe(50);
    expect(usOk.length).toBeGreaterThan(0);
    expect(caOk.length).toBeGreaterThan(0);
  });
});

describe("generateListing", () => {
  it("produces a structurally valid listing", () => {
    const ctx = makeCtx("listing-one");
    const listing = generateListing("bonanza_g36", ctx);
    expect(listing.aircraftTypeId).toBe("bonanza_g36");
    expect(listing.tailNumber.length).toBeGreaterThan(0);
    expect(listing.airframeHours).toBeGreaterThanOrEqual(0);
    expect(listing.engineHoursSinceOverhaul).toBeGreaterThanOrEqual(0);
    expect(listing.engineHoursSinceOverhaul).toBeLessThanOrEqual(1700 * 0.95);
    expect(listing.askingPriceCents).toBeGreaterThan(0);
    expect(listing.expiresAt).toBeGreaterThan(listing.listedAt);
    expect(AIRPORTS.some((a) => a.icao === listing.locationIcao)).toBe(true);
  });

  it("places listings predominantly at maintenance airports", () => {
    const ctx = makeCtx("locations");
    const counts = { withMx: 0, withoutMx: 0 };
    for (let i = 0; i < 200; i++) {
      const l = generateListing("c172", ctx);
      const ap = AIRPORTS.find((a) => a.icao === l.locationIcao)!;
      if (ap.hasMaintenance) counts.withMx++;
      else counts.withoutMx++;
    }
    expect(counts.withMx).toBeGreaterThan(counts.withoutMx);
  });
});

describe("generateListingBatch", () => {
  it("generates the requested count", () => {
    const ctx = makeCtx("batch");
    const batch = generateListingBatch(20, ctx);
    expect(batch).toHaveLength(20);
  });

  it("favors more affordable classes (more SEP/MEP than JET)", () => {
    const ctx = makeCtx("distribution");
    const batch = generateListingBatch(200, ctx);
    const byClass: Record<string, number> = {};
    for (const l of batch) {
      const t = TYPES.find((tt) => tt.id === l.aircraftTypeId)!;
      byClass[t.class] = (byClass[t.class] ?? 0) + 1;
    }
    expect(byClass.SEP ?? 0).toBeGreaterThan(byClass.JET ?? 0);
    expect((byClass.SEP ?? 0) + (byClass.MEP ?? 0)).toBeGreaterThan(
      (byClass.SET ?? 0) + (byClass.JET ?? 0),
    );
  });
});
