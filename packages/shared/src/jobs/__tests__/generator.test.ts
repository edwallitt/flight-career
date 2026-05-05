import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import { ALL_CLIENTS } from "../../clients/index.js";
import type { Role } from "../../clients/types.js";
import { haversineNm } from "../distance.js";
import {
  generateClientJobs,
  generateOpenMarketJobs,
  runGenerationTick,
  type AirportLite,
  type GenerationContext,
} from "../generator.js";
import { calculatePay } from "../pay-calculator.js";

const FIXTURE_AIRPORTS: AirportLite[] = [
  { icao: "CYHZ", lat: 44.8808, lon: -63.5086, size: "major", hasPavedRunway: true },
  { icao: "CYQM", lat: 46.1122, lon: -64.6786, size: "regional", hasPavedRunway: true },
  { icao: "CYQI", lat: 43.8269, lon: -66.0881, size: "regional", hasPavedRunway: true },
  { icao: "CYYG", lat: 46.29, lon: -63.1211, size: "regional", hasPavedRunway: true },
  { icao: "CYFC", lat: 45.8689, lon: -66.5372, size: "regional", hasPavedRunway: true },
  { icao: "CYSJ", lat: 45.3161, lon: -65.8903, size: "regional", hasPavedRunway: true },
  { icao: "CYYR", lat: 53.3192, lon: -60.4258, size: "remote", hasPavedRunway: true },
  { icao: "CYDF", lat: 49.2108, lon: -57.3914, size: "regional", hasPavedRunway: true },
  { icao: "CYJT", lat: 48.5444, lon: -58.55, size: "regional", hasPavedRunway: true },
  { icao: "CYYT", lat: 47.6186, lon: -52.7519, size: "major", hasPavedRunway: true },
  { icao: "CYAW", lat: 44.6394, lon: -63.5036, size: "small", hasPavedRunway: true },
  { icao: "CYUL", lat: 45.4706, lon: -73.7408, size: "major", hasPavedRunway: true },
  { icao: "CYQB", lat: 46.7911, lon: -71.3933, size: "regional", hasPavedRunway: true },
  { icao: "KBOS", lat: 42.3656, lon: -71.0096, size: "major", hasPavedRunway: true },
  { icao: "KMVY", lat: 41.3931, lon: -70.6143, size: "small", hasPavedRunway: true },
  { icao: "KACK", lat: 41.2531, lon: -70.06, size: "regional", hasPavedRunway: true },
];

const FULL_REP: Record<Role, number> = {
  bush: 100,
  air_taxi: 100,
  light_jet: 100,
};

const ZERO_REP: Record<Role, number> = {
  bush: 0,
  air_taxi: 0,
  light_jet: 0,
};

function makeCtx(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    airports: FIXTURE_AIRPORTS,
    reputationByRole: { ...FULL_REP },
    reputationByClient: {},
    simNow: Date.UTC(2026, 5, 15, 12, 0, 0), // mid-June
    rng: seedrandom("test-seed"),
    currentBoardSize: 12,
    targetBoardSize: 12,
    ...overrides,
  };
}

describe("haversineNm", () => {
  it("computes CYHZ → KBOS within tolerance", () => {
    const cyhz = FIXTURE_AIRPORTS.find((a) => a.icao === "CYHZ")!;
    const kbos = FIXTURE_AIRPORTS.find((a) => a.icao === "KBOS")!;
    const d = haversineNm(cyhz, kbos);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(380);
  });

  it("returns 0 for same point", () => {
    const cyhz = FIXTURE_AIRPORTS.find((a) => a.icao === "CYHZ")!;
    expect(haversineNm(cyhz, cyhz)).toBe(0);
  });
});

describe("calculatePay", () => {
  it("scales with distance and class rate", () => {
    const sep100nm = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 200,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    // 100nm * $3 = $300 = 30000 cents
    expect(sep100nm).toBe(30000);

    const jet100nm = calculatePay({
      distanceNm: 100,
      requiredClass: "JET",
      payloadLbs: 600,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    // 100nm * $22 = $2200 = 220000 cents
    expect(jet100nm).toBe(220000);
  });

  it("applies urgency, weather, unpaved, remote and base multipliers", () => {
    const base = calculatePay({
      distanceNm: 200,
      requiredClass: "SET",
      payloadLbs: 800,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    const stacked = calculatePay({
      distanceNm: 200,
      requiredClass: "SET",
      payloadLbs: 800,
      urgency: "critical",
      weatherSensitivity: "strict",
      isUnpavedRequired: true,
      isRemoteDestination: true,
      basePayMultiplier: 2,
      familiarityDiscount: 0,
    });
    expect(stacked).toBeGreaterThan(base * 4);
  });

  it("applies familiarity discount", () => {
    const noDiscount = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 200,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    const discounted = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 200,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0.1,
    });
    expect(discounted).toBeLessThan(noDiscount);
  });

  it("payload above baseline adds pay; below baseline does not subtract", () => {
    const baseline = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 200,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    const heavy = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 600,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    const light = calculatePay({
      distanceNm: 100,
      requiredClass: "SEP",
      payloadLbs: 50,
      urgency: "standard",
      weatherSensitivity: "none",
      isUnpavedRequired: false,
      isRemoteDestination: false,
      basePayMultiplier: 1,
      familiarityDiscount: 0,
    });
    expect(heavy).toBeGreaterThan(baseline);
    expect(light).toBe(baseline);
  });
});

describe("generateClientJobs reputation gating", () => {
  it("returns [] when reputation is below the gate", () => {
    const newfoundland = ALL_CLIENTS.find(
      (c) => c.id === "newfoundland_air_ambulance",
    )!;
    const ctx = makeCtx({
      reputationByRole: { ...ZERO_REP },
      rng: () => 0, // would otherwise definitely fire
    });
    const jobs = generateClientJobs(newfoundland, ctx);
    expect(jobs).toEqual([]);
  });

  it("can generate when reputation meets the gate", () => {
    const maritimeCargo = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    const ctx = makeCtx({ rng: () => 0 });
    const jobs = generateClientJobs(maritimeCargo, ctx);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]!.clientId).toBe("maritime_cargo");
    expect(jobs[0]!.role).toBe("bush");
  });
});

describe("generateClientJobs probability", () => {
  it("never fires when rng() always returns 0.99", () => {
    const client = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const ctx = makeCtx({ rng: () => 0.99 });
      total += generateClientJobs(client, ctx).length;
    }
    expect(total).toBe(0);
  });

  it("fires every tick when rng() always returns 0", () => {
    const client = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    let fired = 0;
    for (let i = 0; i < 20; i++) {
      const ctx = makeCtx({ rng: () => 0 });
      if (generateClientJobs(client, ctx).length > 0) fired++;
    }
    expect(fired).toBe(20);
  });
});

describe("generateOpenMarketJobs", () => {
  it("returns nothing when board is at target", () => {
    const ctx = makeCtx({ currentBoardSize: 12, targetBoardSize: 12 });
    expect(generateOpenMarketJobs(ctx)).toEqual([]);
  });

  it("tops up to target, capped at +3 per tick", () => {
    const ctx = makeCtx({ currentBoardSize: 0, targetBoardSize: 12 });
    const jobs = generateOpenMarketJobs(ctx);
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.role).toBe("open");
      expect(job.clientId).toBeNull();
      expect(job.originIcao).not.toBe(job.destinationIcao);
    }
  });

  it("fills exact deficit when deficit <= 3", () => {
    const ctx = makeCtx({ currentBoardSize: 10, targetBoardSize: 12 });
    expect(generateOpenMarketJobs(ctx)).toHaveLength(2);
  });
});

describe("runGenerationTick determinism", () => {
  it("produces identical output for the same seed", () => {
    const ctxA = makeCtx({
      currentBoardSize: 5,
      targetBoardSize: 12,
      rng: seedrandom("repeatable"),
    });
    const ctxB = makeCtx({
      currentBoardSize: 5,
      targetBoardSize: 12,
      rng: seedrandom("repeatable"),
    });
    const a = runGenerationTick(ALL_CLIENTS, ctxA);
    const b = runGenerationTick(ALL_CLIENTS, ctxB);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("includes both client and open-market jobs in a topped-down board", () => {
    const ctx = makeCtx({
      currentBoardSize: 0,
      targetBoardSize: 12,
      rng: seedrandom("mixed"),
    });
    const jobs = runGenerationTick(ALL_CLIENTS, ctx);
    const openJobs = jobs.filter((j) => j.role === "open");
    expect(openJobs.length).toBeGreaterThan(0);
    expect(openJobs.length).toBeLessThanOrEqual(3);
  });
});
