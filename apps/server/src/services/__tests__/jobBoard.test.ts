import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { career, jobs } from "../../db/schema.js";
import {
  getCareer,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  getOpenJobs,
  getOpenJobsWithReachability,
  getJobById,
  tickJobGeneration,
} from "../jobBoard.js";

const SIM_TICK_MS = 30 * 60 * 1000;

function setSimNow(now: number): void {
  db.update(career).set({ simDateTime: now }).where(eq(career.id, 1)).run();
}

describe("tickJobGeneration", () => {
  beforeEach(() => resetTestDb());

  it("advances sim time by 30 simulated minutes per tick", () => {
    const before = getCareer().simDateTime;
    tickJobGeneration();
    expect(getCareer().simDateTime).toBe(before + SIM_TICK_MS);
  });

  it("expires open jobs whose expiresAt is now in the past", () => {
    const now = getCareer().simDateTime;
    // Job that expires before the *next* tick (anything in the past tick window).
    const stale = insertJob({ expiresAt: now - 1 });
    const fresh = insertJob({ expiresAt: now + 24 * 60 * 60 * 1000 });

    const result = tickJobGeneration();
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const staleAfter = db.select().from(jobs).where(eq(jobs.id, stale.id)).get()!;
    const freshAfter = db.select().from(jobs).where(eq(jobs.id, fresh.id)).get()!;
    expect(staleAfter.status).toBe("expired");
    expect(freshAfter.status).toBe("open");
  });

  it("inserts new jobs to top up toward the target board size", () => {
    // Empty board — most ticks should add at least one new job.
    const result = tickJobGeneration();
    const open = db.select().from(jobs).where(eq(jobs.status, "open")).all();
    expect(result.inserted).toBeGreaterThanOrEqual(0);
    expect(open.length).toBe(result.inserted);
  });

  it("never persists jobs with distanceNm = 0", () => {
    // Run several ticks to build up a board, then assert the invariant.
    for (let i = 0; i < 10; i++) tickJobGeneration();
    const rows = db.select().from(jobs).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.distanceNm, `job ${row.id}`).toBeGreaterThan(0);
    }
  });

  it("does not fire fuel drift on consecutive ticks within the drift interval", () => {
    tickJobGeneration(); // seeds fuel prices with lastDriftAt = simNow
    const second = tickJobGeneration();
    expect(second.fuelDrift.fired).toBe(false);
  });

  it("fires fuel drift once enough sim time has elapsed (≥ 6 sim hours)", () => {
    tickJobGeneration(); // seed
    // Jump sim clock forward 7 hours — past the 6-hour drift interval.
    setSimNow(getCareer().simDateTime + 7 * 60 * 60 * 1000);
    const result = tickJobGeneration();
    expect(result.fuelDrift.fired).toBe(true);
    expect(result.fuelDrift.airportsUpdated).toBeGreaterThan(0);
  });

  it("is a no-op when no career row exists", () => {
    db.delete(career).run();
    const result = tickJobGeneration();
    expect(result).toEqual({
      expired: 0,
      inserted: 0,
      fuelDrift: {
        fired: false,
        airportsUpdated: 0,
        snapshotsCreated: 0,
        shockSpawned: false,
        shocksExpired: 0,
      },
    });
  });
});

describe("getOpenJobs", () => {
  beforeEach(() => resetTestDb());

  it("returns only open jobs, decoded into list items, sorted newest first", () => {
    const now = getCareer().simDateTime;
    setSimNow(now);
    const older = insertJob({ generatedAt: now - 10_000 });
    setSimNow(now);
    const newer = insertJob({ generatedAt: now });
    insertJob({ status: "expired" });
    insertJob({ status: "completed" });

    const list = getOpenJobs();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(newer.id);
    expect(list[1]!.id).toBe(older.id);
  });

  it("decodes requiredCapabilitiesJson into a string array", () => {
    insertJob({ requiredCapabilities: ["unpaved", "float"] });
    const list = getOpenJobs();
    expect(list[0]!.requiredCapabilities).toEqual(["unpaved", "float"]);
  });

  it("attaches clientName from the shared client registry", () => {
    insertJob({ clientId: "maritime_cargo" });
    const list = getOpenJobs();
    expect(list[0]!.clientName).toBeTruthy();
    expect(list[0]!.clientId).toBe("maritime_cargo");
  });

});

describe("getOpenJobsWithReachability", () => {
  beforeEach(() => resetTestDb());

  it("marks jobs starting at the player's location as 'at_origin'", () => {
    insertJob({ originIcao: "CYHZ" }); // player default location
    const result = getOpenJobsWithReachability();
    expect(result.playerLocationIcao).toBe("CYHZ");
    expect(result.jobs[0]!.reachability.status).toBe("at_origin");
  });

  it("uses rentals at the player's location to mark reposition_rental", () => {
    insertJob({ originIcao: "CYQM" }); // not at player location
    const enriched = getOpenJobsWithReachability();
    // CYHZ → CYQM is ~140 nm, well within a Bonanza G36's range.
    expect(enriched.jobs[0]!.reachability.status).toBe("reposition_rental");
  });

  it("attaches a 'ready' fit + non-null recommendedJobId when an owned C172 fits", () => {
    insertOwnedAircraft({ aircraftTypeId: "c172", currentLocationIcao: "CYHZ" });
    insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      payloadLbs: 140,
      pay: 64_000,
    });
    const result = getOpenJobsWithReachability();
    expect(result.jobs[0]!.fit.status).toBe("ready");
    expect(result.jobs[0]!.fit.payHourCents).toBeGreaterThan(0);
    expect(result.recommendedJobId).toBe(result.jobs[0]!.id);
    expect(result.fleet.ownedHere.some((a) => a.aircraftTypeId === "c172")).toBe(
      true,
    );
  });

  it("flags wont_fit when payload exceeds every available aircraft", () => {
    // Default fixture has a Bonanza G36 rental (1100 lb) at CYHZ. A 2000 lb
    // payload overruns both that and any owned starter, so the fit pass
    // demotes the row to wont_fit and recommendedJobId stays null.
    insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      payloadLbs: 2000,
      requiredClass: "SEP",
    });
    const result = getOpenJobsWithReachability();
    expect(result.jobs[0]!.fit.status).toBe("wont_fit");
    expect(result.recommendedJobId).toBeNull();
  });

  it("flags locked when the player has no rating for the required class", () => {
    // Default fixture only seeds the SEP rating. A SET-class job is locked.
    insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      requiredClass: "SET",
    });
    const result = getOpenJobsWithReachability();
    expect(result.jobs[0]!.fit.status).toBe("locked");
    expect(result.jobs[0]!.fit.reason).toMatch(/SET/);
  });

  it("includes simNow + fleet summary alongside the jobs array", () => {
    insertOwnedAircraft({ aircraftTypeId: "c172", currentLocationIcao: "CYHZ" });
    const result = getOpenJobsWithReachability();
    expect(typeof result.simNow).toBe("number");
    expect(result.fleet.ownedHere.length).toBeGreaterThan(0);
    // The default rental fixture parks a Bonanza G36 at CYHZ.
    expect(result.fleet.rentalsHere.some((r) => r.cls === "SEP")).toBe(true);
  });

  it("populates netPayHourCents alongside payHourCents for ready jobs", () => {
    insertOwnedAircraft({ aircraftTypeId: "c172", currentLocationIcao: "CYHZ" });
    insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      payloadLbs: 140,
      pay: 64_000,
    });
    const result = getOpenJobsWithReachability();
    const fit = result.jobs[0]!.fit;
    expect(fit.status).toBe("ready");
    expect(fit.payHourCents).toBeGreaterThan(0);
    expect(fit.netPayHourCents).not.toBeNull();
    // Net should always be ≤ gross — we never bonus the player.
    expect(fit.netPayHourCents!).toBeLessThanOrEqual(fit.payHourCents!);
  });

  it("returns activeJob: null when the career has no active flight", () => {
    const result = getOpenJobsWithReachability();
    expect(result.activeJob).toBeNull();
  });

  it("surfaces activeJob summary and pivots the recommendation to the destination", () => {
    // Player flying CYHZ → CYQM (owned C172). Two open jobs: one departing
    // CYHZ (where the player physically is), one departing CYQM (where the
    // player will be when they land). The pivot should pick the CYQM job.
    insertOwnedAircraft({ aircraftTypeId: "c172", currentLocationIcao: "CYHZ" });
    const flying = insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYQM",
      payloadLbs: 200,
      pay: 80_000,
    });
    insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      payloadLbs: 100,
      pay: 99_999, // gross-higher than the pivot pick — but at the wrong airport
    });
    const cyqmJob = insertJob({
      originIcao: "CYQM",
      destinationIcao: "CYHZ",
      payloadLbs: 100,
      pay: 60_000,
    });

    // Splice the player into an in-flight state on `flying`.
    db
      .update(career)
      .set({
        activeJobId: flying.id,
        activeFlightState: "in_progress",
        activeAircraftSource: "rental",
        activeAircraftRentalTypeId: "c172",
      })
      .where(eq(career.id, 1))
      .run();

    const result = getOpenJobsWithReachability();
    expect(result.activeJob).not.toBeNull();
    expect(result.activeJob!.jobId).toBe(flying.id);
    expect(result.activeJob!.destinationIcao).toBe("CYQM");
    // Recommendation pivots away from the higher-paying CYHZ job to the
    // CYQM job — that's where the player will actually be.
    expect(result.recommendedJobId).toBe(cyqmJob.id);
  });
});

describe("getJobById", () => {
  beforeEach(() => resetTestDb());

  it("returns null for an unknown id", () => {
    expect(getJobById(99999)).toBeNull();
  });

  it("returns origin and destination airport metadata", () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const detail = getJobById(job.id);
    expect(detail).not.toBeNull();
    expect(detail!.originName).toBeTruthy();
    expect(detail!.destinationName).toBeTruthy();
    expect(typeof detail!.originLat).toBe("number");
  });
});
