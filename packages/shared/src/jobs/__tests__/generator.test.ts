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
import {
  calculatePay,
  familiarityDiscountForCount,
  MAX_FAMILIARITY_DISCOUNT,
  routeKey,
} from "../pay-calculator.js";

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
    // One 30-min slice of world time per pass — the granularity the engine
    // was originally tuned around (48 slices/day). Client rates scale off
    // this, so the probability suites below behave as they did under the old
    // fixed-tick model.
    genElapsedMs: 30 * 60 * 1000,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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
      loyaltyBonus: 0,
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

describe("generateClientJobs reputation payoff", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("bakes the loyalty pay bonus into client jobs at top standing", () => {
    const client = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    // Full-day window → both runs clamp to MAX_CLIENT_JOBS_PER_GEN (3) and
    // consume the rng identically, so the only difference is the loyalty bonus.
    const base = generateClientJobs(
      client,
      makeCtx({
        reputationByClient: {},
        genElapsedMs: DAY,
        rng: seedrandom("loyalty-seed"),
      }),
    );
    const loyal = generateClientJobs(
      client,
      makeCtx({
        reputationByClient: { maritime_cargo: 100 }, // top → +30%
        genElapsedMs: DAY,
        rng: seedrandom("loyalty-seed"),
      }),
    );
    expect(base.length).toBe(3);
    expect(loyal.length).toBe(3);
    for (let i = 0; i < base.length; i++) {
      // Same underlying job (route unchanged) — only the pay differs.
      expect(loyal[i]!.destinationIcao).toBe(base[i]!.destinationIcao);
      expect(loyal[i]!.pay / base[i]!.pay).toBeCloseTo(1.3, 2);
    }
  });

  it("priority work: top standing raises a client's job frequency", () => {
    const client = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    // 8h window: novice expects 6 × (8/24) = 2 jobs; top expects ×1.5 = 3.
    const window = 8 * 60 * 60 * 1000;
    const novice = generateClientJobs(
      client,
      makeCtx({
        reputationByClient: {},
        genElapsedMs: window,
        rng: seedrandom("freq-seed"),
      }),
    );
    const loyal = generateClientJobs(
      client,
      makeCtx({
        reputationByClient: { maritime_cargo: 100 },
        genElapsedMs: window,
        rng: seedrandom("freq-seed"),
      }),
    );
    expect(novice.length).toBe(2);
    expect(loyal.length).toBe(3);
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

const DAY = 24 * 60 * 60 * 1000;

describe("familiarityDiscountForCount", () => {
  it("is zero for an unflown route", () => {
    expect(familiarityDiscountForCount(0)).toBe(0);
    expect(familiarityDiscountForCount(-3)).toBe(0);
  });

  it("grows per recent flight and caps", () => {
    expect(familiarityDiscountForCount(1)).toBeCloseTo(0.03);
    expect(familiarityDiscountForCount(3)).toBeCloseTo(0.09);
    expect(familiarityDiscountForCount(100)).toBe(MAX_FAMILIARITY_DISCOUNT);
  });
});

describe("runGenerationTick familiarity discount", () => {
  it("pays less for an over-flown route than a fresh one (same client)", () => {
    // Force a single maritime_cargo job and compare pay with vs without recent
    // flights on the route it lands on. We drive the same seed both ways so the
    // route/payload are identical; only routeFlightCounts differs.
    const maritime = ALL_CLIENTS.find((c) => c.id === "maritime_cargo")!;
    const base = generateClientJobs(
      maritime,
      makeCtx({ genElapsedMs: DAY, rng: seedrandom("fam") }),
    );
    expect(base.length).toBeGreaterThan(0);
    const sample = base[0]!;
    const counts = { [routeKey(sample.originIcao, sample.destinationIcao)]: 5 };
    const discounted = generateClientJobs(
      maritime,
      makeCtx({
        genElapsedMs: DAY,
        rng: seedrandom("fam"),
        routeFlightCounts: counts,
      }),
    );
    const sameRoute = discounted.find(
      (j) =>
        j.originIcao === sample.originIcao &&
        j.destinationIcao === sample.destinationIcao,
    )!;
    expect(sameRoute).toBeDefined();
    expect(sameRoute.pay).toBeLessThan(sample.pay);
  });
});

describe("runGenerationTick board ceiling", () => {
  it("adds nothing when the board is already at the ceiling (no home floor)", () => {
    // Saturated board, no deficit, no player location → no branded, no
    // open-market, no overshoot. Holds regardless of rng.
    const ctx = makeCtx({
      currentBoardSize: 14,
      targetBoardSize: 12,
      maxBoardSize: 14,
      genElapsedMs: DAY, // would fire plenty of branded if uncapped
    });
    expect(runGenerationTick(ALL_CLIENTS, ctx)).toEqual([]);
  });

  it("admits branded only up to the ceiling's remaining headroom", () => {
    const ctx = makeCtx({
      currentBoardSize: 13,
      targetBoardSize: 12,
      maxBoardSize: 14,
      genElapsedMs: DAY,
      rng: seedrandom("ceiling"),
    });
    // 1 slot of headroom; no player location so no home overshoot.
    expect(runGenerationTick(ALL_CLIENTS, ctx).length).toBeLessThanOrEqual(1);
  });
});

describe("runGenerationTick flyable-class bias", () => {
  it("keeps unflyable branded out once the board is at target", () => {
    // Board already at target → the aspirational band (below target) is full,
    // so only flyable client work may be admitted into the headroom above it.
    const ctx = makeCtx({
      currentBoardSize: 12,
      targetBoardSize: 12,
      maxBoardSize: 20,
      genElapsedMs: DAY,
      playerAvailableClasses: ["SEP"],
      rng: seedrandom("flyable"),
    });
    const jobs = runGenerationTick(ALL_CLIENTS, ctx);
    const branded = jobs.filter((j) => j.role !== "open");
    expect(branded.length).toBeGreaterThan(0); // path is exercised
    for (const j of branded) expect(j.requiredClass).toBe("SEP");
  });
});

describe("runGenerationTick branded floor", () => {
  it("force-surfaces flyable branded up to the floor on a fresh board", () => {
    // Tiny elapsed window → the natural branded trickle is ~0, so reaching the
    // floor proves the forced top-up fired. Early-game rep, SEP-only player.
    const ctx = makeCtx({
      currentBoardSize: 0,
      targetBoardSize: 12,
      maxBoardSize: 14,
      minBrandedJobs: 3,
      brandedJobCount: 0,
      genElapsedMs: 30 * 1000,
      reputationByRole: { bush: 25, air_taxi: 5, light_jet: 0 },
      playerAvailableClasses: ["SEP"],
      rng: seedrandom("floor"),
    });
    const jobs = runGenerationTick(ALL_CLIENTS, ctx);
    const flyableBranded = jobs.filter(
      (j) => j.role !== "open" && j.requiredClass === "SEP",
    );
    expect(flyableBranded.length).toBeGreaterThanOrEqual(3);
  });

  it("does not top up when the board already meets the floor", () => {
    const ctx = makeCtx({
      currentBoardSize: 8,
      targetBoardSize: 12,
      maxBoardSize: 14,
      minBrandedJobs: 3,
      brandedJobCount: 3, // floor already satisfied by jobs on the board
      genElapsedMs: 30 * 1000,
      reputationByRole: { bush: 25, air_taxi: 5, light_jet: 0 },
      playerAvailableClasses: ["SEP"],
      rng: seedrandom("nofloor"),
    });
    // With a 30s window and the floor met, branded output should be ~none; any
    // jobs are the open-market deficit fill toward target.
    const jobs = runGenerationTick(ALL_CLIENTS, ctx);
    expect(jobs.every((j) => j.role === "open")).toBe(true);
  });
});

describe("runGenerationTick home-origin floor", () => {
  it("guarantees home departures even when the board is at the ceiling", () => {
    // Player just repositioned to CYAW: board full of non-home work, zero home
    // jobs. The home floor must overshoot the ceiling to un-strand them.
    const ctx = makeCtx({
      currentBoardSize: 14,
      targetBoardSize: 12,
      maxBoardSize: 14,
      genElapsedMs: 30 * 1000,
      playerLocationIcao: "CYAW",
      homeOriginJobCount: 0,
      rng: seedrandom("stranded"),
    });
    const jobs = runGenerationTick(ALL_CLIENTS, ctx);
    const homeOpen = jobs.filter(
      (j) => j.role === "open" && j.originIcao === "CYAW",
    );
    expect(homeOpen.length).toBe(3); // MIN_HOME_ORIGIN_JOBS, the bounded overshoot
    // Branded admission is shut off at the ceiling, so the only additions are
    // the forced home jobs.
    expect(jobs.length).toBe(3);
  });
});
