import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import {
  FERRY_PAY,
  generateFerryJob,
  type FerryAircraftType,
  type FerryAirportLite,
  type FerryGenerationContext,
} from "../ferry.js";

const AIRPORTS: FerryAirportLite[] = [
  { icao: "CYHZ", lat: 44.8808, lon: -63.5086, size: "major", hasPavedRunway: true, hasMaintenance: true },
  { icao: "CYQM", lat: 46.1122, lon: -64.6786, size: "regional", hasPavedRunway: true, hasMaintenance: true },
  { icao: "CYQI", lat: 43.8269, lon: -66.0881, size: "regional", hasPavedRunway: true, hasMaintenance: false },
  { icao: "CYYG", lat: 46.29, lon: -63.1211, size: "regional", hasPavedRunway: true, hasMaintenance: false },
  { icao: "CYFC", lat: 45.8689, lon: -66.5372, size: "regional", hasPavedRunway: true, hasMaintenance: true },
  { icao: "CYSJ", lat: 45.3161, lon: -65.8903, size: "regional", hasPavedRunway: true, hasMaintenance: false },
  { icao: "CYYT", lat: 47.6186, lon: -52.7519, size: "major", hasPavedRunway: true, hasMaintenance: true },
  { icao: "CYUL", lat: 45.4706, lon: -73.7408, size: "major", hasPavedRunway: true, hasMaintenance: true },
  { icao: "CYQB", lat: 46.7911, lon: -71.3933, size: "regional", hasPavedRunway: true, hasMaintenance: true },
  { icao: "KBOS", lat: 42.3656, lon: -71.0096, size: "major", hasPavedRunway: true, hasMaintenance: true },
  { icao: "KMVY", lat: 41.3931, lon: -70.6143, size: "small", hasPavedRunway: true, hasMaintenance: false },
  { icao: "KACK", lat: 41.2531, lon: -70.06, size: "regional", hasPavedRunway: true, hasMaintenance: false },
];

// Modeled after seed catalog: a spread across SEP/MEP/SET/JET so the class
// distribution test has something to actually hit each branch.
const TYPES: Array<FerryAircraftType & { manufacturer: string; model: string }> = [
  { id: "c172", class: "SEP", cruiseSpeedKts: 122, rangeNm: 640, basePurchasePriceCents: 30_000_000, manufacturer: "Cessna", model: "172" },
  { id: "sr22", class: "SEP", cruiseSpeedKts: 180, rangeNm: 1000, basePurchasePriceCents: 80_000_000, manufacturer: "Cirrus", model: "SR22" },
  { id: "be58", class: "MEP", cruiseSpeedKts: 200, rangeNm: 1500, basePurchasePriceCents: 90_000_000, manufacturer: "Beechcraft", model: "Baron 58" },
  { id: "p46t", class: "MEP", cruiseSpeedKts: 215, rangeNm: 1300, basePurchasePriceCents: 110_000_000, manufacturer: "Piper", model: "M600" },
  { id: "tbm9", class: "SET", cruiseSpeedKts: 330, rangeNm: 1700, basePurchasePriceCents: 400_000_000, manufacturer: "Daher", model: "TBM 940" },
  { id: "pc12", class: "SET", cruiseSpeedKts: 285, rangeNm: 1800, basePurchasePriceCents: 500_000_000, manufacturer: "Pilatus", model: "PC-12" },
  { id: "cj4", class: "JET", cruiseSpeedKts: 451, rangeNm: 2165, basePurchasePriceCents: 1_050_000_000, manufacturer: "Cessna", model: "Citation CJ4" },
  { id: "ph300", class: "JET", cruiseSpeedKts: 459, rangeNm: 1942, basePurchasePriceCents: 1_000_000_000, manufacturer: "Embraer", model: "Phenom 300" },
];

function makeCtx(seed: string, simNow = 1_700_000_000_000): FerryGenerationContext {
  const rng = seedrandom(seed);
  return { airports: AIRPORTS, aircraftTypes: TYPES, rng, simNow };
}

describe("generateFerryJob", () => {
  it("produces a valid ferry with all required fields", () => {
    const job = generateFerryJob(makeCtx("ferry-seed-a"));
    expect(job).not.toBeNull();
    if (!job) return;

    expect(job.jobType).toBe("ferry");
    expect(job.ferryAircraftTypeId).toBeTruthy();
    expect(job.ferryAircraftTail).toMatch(/^(N\d{3}[A-Z]{2}|C-F[A-Z]{3})$/);
    expect(["owner", "dealer", "operator"]).toContain(job.ferrySource);
    expect(job.ferryOwnerName.length).toBeGreaterThan(0);
    expect(job.clientName).toBe(job.ferryOwnerName);
    expect(job.originIcao).not.toBe(job.destinationIcao);
    expect(job.distanceNm).toBeGreaterThan(0);
    expect(job.payCents).toBeGreaterThan(0);
    expect(job.payCents % 100).toBe(0); // whole-dollar pay
    expect(job.payloadLbs).toBeLessThanOrEqual(200);
    expect(job.paxCount).toBeNull();
    expect(job.scheduleLatest).toBeGreaterThan(job.scheduleEarliest);
  });

  it("ferry distance never exceeds 85% of aircraft spec range", () => {
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const job = generateFerryJob(makeCtx(`range-check-${i}`));
      if (!job) continue;
      const type = TYPES.find((t) => t.id === job.ferryAircraftTypeId);
      expect(type).toBeDefined();
      if (!type) continue;
      expect(job.distanceNm).toBeLessThanOrEqual(type.rangeNm * 0.85);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("pay scales with class: SEP < MEP < SET < JET at fixed distance", () => {
    // Compare base+perNm formula directly — the variance is ±10% so
    // categories don't overlap at the same distance.
    const distance = 400;
    const sep = FERRY_PAY.SEP.base + distance * FERRY_PAY.SEP.perNm;
    const mep = FERRY_PAY.MEP.base + distance * FERRY_PAY.MEP.perNm;
    const set = FERRY_PAY.SET.base + distance * FERRY_PAY.SET.perNm;
    const jet = FERRY_PAY.JET.base + distance * FERRY_PAY.JET.perNm;
    expect(sep).toBeLessThan(mep);
    expect(mep).toBeLessThan(set);
    expect(set).toBeLessThan(jet);
  });

  it("pay variance stays within ±10% of the base formula", () => {
    for (let i = 0; i < 100; i++) {
      const job = generateFerryJob(makeCtx(`pay-var-${i}`));
      if (!job) continue;
      const table = FERRY_PAY[job.minClass];
      const base = table.base + job.distanceNm * table.perNm;
      const dollars = job.payCents / 100;
      // Allow a 1-dollar slack for rounding to whole dollars.
      expect(dollars).toBeGreaterThanOrEqual(Math.floor(base * 0.9) - 1);
      expect(dollars).toBeLessThanOrEqual(Math.ceil(base * 1.1) + 1);
    }
  });

  it("class distribution roughly tracks the configured weights over many runs", () => {
    const counts: Record<string, number> = { SEP: 0, MEP: 0, SET: 0, JET: 0 };
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const job = generateFerryJob(makeCtx(`distrib-${i}`));
      if (!job) continue;
      counts[job.minClass]! += 1;
      total += 1;
    }
    expect(total).toBeGreaterThan(300);
    // Source bias warps the raw 35/25/25/15 split, but every class should
    // still appear with non-trivial frequency across hundreds of runs.
    expect(counts.SEP! / total).toBeGreaterThan(0.1);
    expect(counts.MEP! / total).toBeGreaterThan(0.05);
    expect(counts.SET! / total).toBeGreaterThan(0.1);
    expect(counts.JET! / total).toBeGreaterThan(0.02);
  });

  it("schedule window scales with distance", () => {
    const HOUR_MS = 60 * 60 * 1000;
    const samples = { short: [] as number[], mid: [] as number[], long: [] as number[] };
    for (let i = 0; i < 200; i++) {
      const job = generateFerryJob(makeCtx(`window-${i}`));
      if (!job) continue;
      const windowHours = (job.scheduleLatest - job.scheduleEarliest) / HOUR_MS;
      if (job.distanceNm < 200) samples.short.push(windowHours);
      else if (job.distanceNm < 500) samples.mid.push(windowHours);
      else samples.long.push(windowHours);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (samples.short.length > 0 && samples.long.length > 0) {
      // Short-haul windows should average wider than long-haul windows.
      expect(avg(samples.short)).toBeGreaterThan(avg(samples.long));
    }
  });
});
