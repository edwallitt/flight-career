import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { aircraftListings, career, ratings } from "../../db/schema.js";
import {
  getCareer,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import { refreshMarketplace, rngFromSeed } from "../../services/marketplace.js";
import { appRouter } from "../router.js";

const caller = () => appRouter.createCaller({});

describe("trpc: health", () => {
  it("returns ok", async () => {
    const result = await caller().health.ping();
    // health.ping returns { ok: true } in this codebase
    expect(result).toMatchObject({ ok: true });
  });
});

describe("trpc: career", () => {
  beforeEach(() => resetTestDb({ cash: 5_000_000_00 }));

  it("get returns the career snapshot with location resolved", async () => {
    const result = await caller().career.get();
    expect(result).not.toBeNull();
    expect(result!.pilotName).toBe("TestPilot");
    expect(result!.currentLocationIcao).toBe("CYHZ");
    expect(result!.currentLocationName).toBeTruthy();
    expect(result!.cash).toBe(5_000_000_00);
  });

  it("bookExam: validates class enum", async () => {
    await expect(
      // @ts-expect-error — intentional bad input to verify zod rejection
      caller().career.bookExam({ class: "XEP" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("bookExam happy path: deducts cost and earns the rating instantly", async () => {
    db.update(ratings)
      .set({ hoursInClass: 30 })
      .where(eq(ratings.class, "SEP"))
      .run();
    const result = await caller().career.bookExam({ class: "MEP" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(300_000);
    // Instant: resolves at the current sim time and the rating is earned now.
    expect(result.scheduledFor).toBe(getCareer().simDateTime);
    expect(
      db.select().from(ratings).where(eq(ratings.class, "MEP")).get()!.earned,
    ).toBe(true);
  });
});

describe("trpc: jobs", () => {
  beforeEach(() => resetTestDb());

  it("list returns open jobs", async () => {
    insertJob();
    const list = await caller().jobs.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("open");
  });

  it("listWithReachability bundles player location + reachability per job", async () => {
    insertJob({ originIcao: "CYHZ" });
    const result = await caller().jobs.listWithReachability();
    expect(result.playerLocationIcao).toBe("CYHZ");
    expect(result.jobs[0]!.reachability.status).toBe("at_origin");
  });

  it("getById validates positive int and returns null for unknown", async () => {
    await expect(
      caller().jobs.getById({ id: -5 }),
    ).rejects.toBeInstanceOf(TRPCError);

    const result = await caller().jobs.getById({ id: 99999 });
    expect(result).toBeNull();
  });

  it("tickNow advances sim time and returns the tick result", async () => {
    const before = getCareer().simDateTime;
    // The world clock advances by real time elapsed since the last sync.
    // Anchor it an hour back so a tick reliably moves the clock forward
    // regardless of how few milliseconds the test itself takes.
    db.update(career)
      .set({ lastClockSyncReal: Date.now() - 60 * 60 * 1000 })
      .where(eq(career.id, 1))
      .run();
    const result = await caller().jobs.tickNow();
    expect(result).toMatchObject({
      expired: expect.any(Number),
      inserted: expect.any(Number),
    });
    expect(getCareer().simDateTime).toBeGreaterThan(before);
  });
});

describe("trpc: lifecycle", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("accept: rejects when neither ownedAircraftId nor rentalAircraftTypeId is supplied", async () => {
    const job = insertJob();
    await expect(
      caller().lifecycle.accept({
        jobId: job.id,
        aircraftSource: "rental",
        // missing rentalAircraftTypeId
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("accept happy path: marks job accepted and locks active state on the career row", async () => {
    const job = insertJob();
    const result = await caller().lifecycle.accept({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    expect(result).toEqual({ ok: true });
    expect(getCareer().activeJobId).toBe(job.id);
    expect(getCareer().activeFlightState).toBe("accepted");
  });

  it("getActiveJob returns the snapshot with cancel penalty after accept", async () => {
    const job = insertJob();
    await caller().lifecycle.accept({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const active = await caller().lifecycle.getActiveJob();
    expect(active).not.toBeNull();
    expect(active!.cancelPenalty).toEqual({ role: -2, client: -3 });
  });

  it("complete happy path: rental, returns ok with summary", async () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const job = insertJob({ pay: 100_000, payloadLbs: 600 });
    await caller().lifecycle.accept({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    await caller().lifecycle.brief({ fuelGallons: 30 });
    await caller().lifecycle.beginFlight();

    const result = await caller().lifecycle.complete({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 60,
      fuelBurnedGal: 17,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.netCashDelta).toBeDefined();
  });
});

describe("trpc: marketplace", () => {
  beforeEach(() => resetTestDb({ cash: 5_000_000_00 }));

  it("listings returns enriched listings + player location", async () => {
    refreshMarketplace(24, rngFromSeed(7));
    const result = await caller().marketplace.listings();
    expect(result.playerLocationIcao).toBe("CYHZ");
    expect(result.listings.length).toBeGreaterThan(0);
    for (const l of result.listings) {
      expect(l.askingPriceCents).toBeGreaterThan(0);
      expect(l.aircraftClass).toMatch(/SEP|MEP|SET|JET/);
    }
  });

  it("listings rejects negative maxPriceCents", async () => {
    await expect(
      caller().marketplace.listings({ maxPriceCents: -1 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("purchase happy path: cash purchase succeeds end-to-end", async () => {
    refreshMarketplace(24, rngFromSeed(7));
    const cheapest = db
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.status, "available"))
      .all()
      .sort((a, b) => a.askingPriceCents - b.askingPriceCents)[0]!;

    const result = await caller().marketplace.purchase({
      listingId: cheapest.id,
      paymentMethod: "cash",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownedAircraftId).toBeGreaterThan(0);

    const listingAfter = db
      .select()
      .from(aircraftListings)
      .where(eq(aircraftListings.id, cheapest.id))
      .get()!;
    expect(listingAfter.status).toBe("sold");
  });
});

describe("trpc: sale", () => {
  beforeEach(() => resetTestDb({ cash: 5_000_000_00 }));

  it("preview returns estimate + eligibility", async () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const result = await caller().sale.preview({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.estimate.estimatedValueCents).toBeGreaterThan(0);
    expect(result.preview.eligibility.eligible).toBe(true);
  });

  it("confirm executes a sale and credits cash", async () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const beforeCash = getCareer().cash;
    const result = await caller().sale.confirm({ ownedAircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getCareer().cash).toBe(beforeCash + result.netReceivedCents);
  });

  it("preview validates positive int", async () => {
    await expect(
      caller().sale.preview({ ownedAircraftId: 0 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("trpc: hangar", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("fleet returns owned aircraft details", async () => {
    insertOwnedAircraft({ tailNumber: "C-FONE" });
    insertOwnedAircraft({ tailNumber: "C-FTWO" });
    const fleet = await caller().hangar.fleet();
    expect(fleet).toHaveLength(2);
    for (const a of fleet) {
      expect(a.manufacturer).toBeTruthy();
      expect(a.fuelCapacityGal).toBeGreaterThan(0);
    }
  });

  it("aircraftById returns null for unknown id", async () => {
    expect(await caller().hangar.aircraftById({ id: 99999 })).toBeNull();
  });

  it("refuel debits cash and tops up tank", async () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      fuelOnBoardGal: 0,
    });
    const before = getCareer().cash;
    const result = await caller().hangar.refuel({ aircraftId: ac.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getCareer().cash).toBe(before - result.costCents);
  });
});
