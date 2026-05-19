import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  airports,
  career,
  jobs,
  ownedAircraft,
} from "../../db/schema.js";
import {
  getCareer,
  insertFlight,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import { getAtlasData } from "../atlas.js";

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

describe("getAtlasData — airports", () => {
  beforeEach(() => resetTestDb());

  it("returns every seeded airport with fuel prices only where the FBO carries that grade", () => {
    const data = getAtlasData();
    const seedCount = db.select().from(airports).all().length;
    expect(data.airports).toHaveLength(seedCount);

    const cyhz = data.airports.find((a) => a.icao === "CYHZ");
    expect(cyhz).toBeDefined();
    expect(cyhz!.fuelPriceAvgas).not.toBeNull();
    expect(cyhz!.fuelPriceJetA).not.toBeNull();
    expect(cyhz!.fuelPriceAvgas).toBeGreaterThan(0);
    expect(cyhz!.hasMaintenance).toBe(true);
    expect(cyhz!.hasFbo).toBe(true);
  });

  it("nulls fuel prices for grades the airport doesn't stock", () => {
    // Force CYCH to a stripped-down strip for the test.
    db.update(airports)
      .set({ hasAvgas: false, hasJetA: false })
      .where(eq(airports.icao, "CYCH"))
      .run();
    const data = getAtlasData();
    const cych = data.airports.find((a) => a.icao === "CYCH")!;
    expect(cych.fuelPriceAvgas).toBeNull();
    expect(cych.fuelPriceJetA).toBeNull();
  });
});

describe("getAtlasData — owned aircraft", () => {
  beforeEach(() => resetTestDb());

  it("returns owned aircraft with type label and airport coords; excludes sold", () => {
    insertOwnedAircraft({ tailNumber: "C-FONE", currentLocationIcao: "CYHZ" });
    const sold = insertOwnedAircraft({ tailNumber: "C-FSLD" });
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, sold.id))
      .run();

    const data = getAtlasData();
    expect(data.ownedAircraft).toHaveLength(1);

    const a = data.ownedAircraft[0]!;
    expect(a.tailNumber).toBe("C-FONE");
    expect(a.currentLocationIcao).toBe("CYHZ");
    expect(a.aircraftTypeLabel).toBe("Beechcraft Bonanza G36"); // bonanza_g36 default
    expect(a.aircraftClass).toBe("SEP");
    expect(a.lat).toBeTypeOf("number");
    expect(a.lon).toBeTypeOf("number");
    expect(a.tboHours).toBeGreaterThan(0);
  });
});

describe("getAtlasData — recent flights", () => {
  beforeEach(() => resetTestDb());

  it("only includes flights that ended within the 30-day window", () => {
    const now = getCareer().simDateTime;
    insertFlight({ endedAt: now - 5 * SIM_DAY_MS });
    insertFlight({ endedAt: now - 40 * SIM_DAY_MS }); // outside window
    const data = getAtlasData();
    expect(data.recentFlights).toHaveLength(1);
    expect(data.recentFlights[0]!.ageDays).toBeCloseTo(5, 1);
  });

  it("orders flights newest-first and computes net cents", () => {
    const now = getCareer().simDateTime;
    insertFlight({
      endedAt: now - 10 * SIM_DAY_MS,
      totalRevenue: 10_000,
      totalCost: 4_000,
    });
    insertFlight({
      endedAt: now - 1 * SIM_DAY_MS,
      totalRevenue: 30_000,
      totalCost: 5_000,
    });
    const data = getAtlasData();
    expect(data.recentFlights.map((f) => f.netCents)).toEqual([
      30_000 - 5_000,
      10_000 - 4_000,
    ]);
  });

  it("labels owned-aircraft flights with the type label, falling back to a rental type", () => {
    const owned = insertOwnedAircraft({ tailNumber: "C-FOWN" });
    insertFlight({ ownedAircraftId: owned.id, rentalAircraftTypeId: null });
    insertFlight({ ownedAircraftId: null, rentalAircraftTypeId: "bonanza_g36" });
    const data = getAtlasData();
    expect(data.recentFlights).toHaveLength(2);
    for (const f of data.recentFlights) {
      expect(f.aircraftLabel).toBe("Beechcraft Bonanza G36");
    }
  });
});

describe("getAtlasData — jobs", () => {
  beforeEach(() => resetTestDb());

  it("returns only open jobs, capped at MAX_JOBS, newest-first", () => {
    const now = getCareer().simDateTime;
    // 35 open jobs, staggered generation time
    for (let i = 0; i < 35; i++) {
      insertJob({ generatedAt: now - i * 60_000 });
    }
    insertJob({ status: "completed" }); // should be filtered out
    const data = getAtlasData();
    expect(data.jobs).toHaveLength(30); // MAX_JOBS

    // Sorted descending by generatedAt. Because we inserted i=0 with the
    // newest timestamp first, the lowest id should land at the head of the list.
    expect(data.jobs[0]!.id).toBeLessThan(data.jobs[data.jobs.length - 1]!.id);
  });

  it("resolves client name for standard jobs and ferryOwnerName for ferries", () => {
    insertJob({ clientId: "maritime_cargo" });
    const ferry = insertJob({ clientId: null });
    db.update(jobs)
      .set({
        jobType: "ferry",
        ferryAircraftTypeId: "bonanza_g36",
        ferryAircraftTail: "C-FERY",
        ferrySource: "dealer",
        ferryOwnerName: "Atlantic Aircraft Sales",
      })
      .where(eq(jobs.id, ferry.id))
      .run();

    const data = getAtlasData();
    const standard = data.jobs.find((j) => j.clientId === "maritime_cargo")!;
    expect(standard.jobType).toBe("standard");
    expect(standard.clientName).toBe("Maritime Cargo Express");
    expect(standard.ferryAircraftLabel).toBeNull();

    const ferryJob = data.jobs.find((j) => j.id === ferry.id)!;
    expect(ferryJob.jobType).toBe("ferry");
    expect(ferryJob.clientName).toBe("Atlantic Aircraft Sales");
    expect(ferryJob.ferrySource).toBe("dealer");
    expect(ferryJob.ferryAircraftTail).toBe("C-FERY");
    expect(ferryJob.ferryAircraftLabel).toBe("Beechcraft Bonanza G36");
  });
});

describe("getAtlasData — player & active tracked flight", () => {
  beforeEach(() => resetTestDb());

  it("exposes the player when the career row references a known airport", () => {
    const data = getAtlasData();
    expect(data.player).not.toBeNull();
    expect(data.player!.currentLocationIcao).toBe("CYHZ");
    expect(data.player!.lat).toBeTypeOf("number");
    expect(data.player!.simDateTime).toBe(getCareer().simDateTime);
  });

  it("returns player=null when there is no career row", () => {
    db.delete(career).run();
    const data = getAtlasData();
    expect(data.player).toBeNull();
  });

  it("activeTrackedFlight is null unless state is in_progress AND trackingMode is tracked", () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYQM" });
    // Accepted but not in-progress
    db.update(career)
      .set({
        activeJobId: job.id,
        activeFlightState: "accepted",
        trackingMode: "tracked",
      })
      .where(eq(career.id, 1))
      .run();
    expect(getAtlasData().activeTrackedFlight).toBeNull();

    // In-progress but manual
    db.update(career)
      .set({ activeFlightState: "in_progress", trackingMode: "manual" })
      .where(eq(career.id, 1))
      .run();
    expect(getAtlasData().activeTrackedFlight).toBeNull();
  });

  it("populates activeTrackedFlight when in_progress + tracked", () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYQM" });
    db.update(jobs).set({ distanceNm: 124.7 }).where(eq(jobs.id, job.id)).run();
    const owned = insertOwnedAircraft();
    db.update(career)
      .set({
        activeJobId: job.id,
        activeAircraftOwnedId: owned.id,
        activeFlightState: "in_progress",
        trackingMode: "tracked",
      })
      .where(eq(career.id, 1))
      .run();

    const data = getAtlasData();
    expect(data.activeTrackedFlight).not.toBeNull();
    expect(data.activeTrackedFlight!.jobId).toBe(job.id);
    expect(data.activeTrackedFlight!.ownedAircraftId).toBe(owned.id);
    expect(data.activeTrackedFlight!.originIcao).toBe("CYHZ");
    expect(data.activeTrackedFlight!.destinationIcao).toBe("CYQM");
    expect(data.activeTrackedFlight!.totalDistanceNm).toBe(125); // rounded
  });
});
