import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { career, jobs, ownedAircraft, ratingExams, ratings } from "../../db/schema.js";
import {
  getCareer,
  insertFlight,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import { bookExam, getCareerSnapshot, tierForScore } from "../career.js";

function setHoursInClass(
  cls: "SEP" | "MEP" | "SET" | "JET",
  hours: number,
): void {
  db.update(ratings)
    .set({ hoursInClass: hours })
    .where(eq(ratings.class, cls))
    .run();
}

describe("tierForScore", () => {
  it("buckets by published thresholds", () => {
    expect(tierForScore(0)).toBe("novice");
    expect(tierForScore(24)).toBe("novice");
    expect(tierForScore(25)).toBe("mid");
    expect(tierForScore(59)).toBe("mid");
    expect(tierForScore(60)).toBe("high");
    expect(tierForScore(84)).toBe("high");
    expect(tierForScore(85)).toBe("top");
    expect(tierForScore(100)).toBe("top");
  });
});

describe("bookExam", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("MEP with 25 SEP hours: deducts cost and earns the rating instantly", () => {
    setHoursInClass("SEP", 30);
    const beforeCash = getCareer().cash;

    const result = bookExam({ class: "MEP" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(300_000); // $3,000 from RATING_REQUIREMENTS
    // Instant: resolves at the current sim time, no lead time.
    expect(result.scheduledFor).toBe(getCareer().simDateTime);

    expect(getCareer().cash).toBe(beforeCash - result.cost);

    // Rating is earned immediately on payment.
    const ratingRow = db
      .select()
      .from(ratings)
      .where(eq(ratings.class, "MEP"))
      .get()!;
    expect(ratingRow.earned).toBe(true);
    expect(ratingRow.earnedAt).toBe(getCareer().simDateTime);

    const examRow = db
      .select()
      .from(ratingExams)
      .where(eq(ratingExams.id, result.examId))
      .get()!;
    expect(examRow.class).toBe("MEP");
    expect(examRow.status).toBe("passed");
    expect(examRow.resolvedAt).toBe(getCareer().simDateTime);
  });

  it("rejects when hour gates aren't met", () => {
    // SEP only has 5 hours — far below the MEP gate of 25 total + 25 SEP.
    setHoursInClass("SEP", 5);
    const result = bookExam({ class: "MEP" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/hours/);
  });

  it("rejects SEP (no exam requirement)", () => {
    const result = bookExam({ class: "SEP" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no exam requirement/);
  });

  it("rejects re-taking a class already earned", () => {
    setHoursInClass("SEP", 30);
    bookExam({ class: "MEP" }); // earns MEP instantly
    const second = bookExam({ class: "MEP" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/already earned/);
  });

  it("rejects when cash is below the exam fee", () => {
    resetTestDb({ cash: 100_00 });
    setHoursInClass("SEP", 30);
    const result = bookExam({ class: "MEP" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Insufficient cash/i);
  });
});

describe("getCareerSnapshot", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("returns rating cards for all four classes with eligibility for unearned classes", () => {
    setHoursInClass("SEP", 30);
    const snap = getCareerSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.ratings).toHaveLength(4);

    const sep = snap!.ratings.find((r) => r.class === "SEP")!;
    expect(sep.earned).toBe(true);
    expect(sep.requirement).toBeNull();
    expect(sep.eligibility).toBeNull();

    const mep = snap!.ratings.find((r) => r.class === "MEP")!;
    expect(mep.earned).toBe(false);
    expect(mep.requirement).not.toBeNull();
    expect(mep.eligibility).not.toBeNull();
    expect(mep.eligibility!.eligible).toBe(true);
  });

  it("clamps reputation display to zero when role has no flights but a non-zero score", () => {
    // Default startingRoleRep = 25, with no flights logged → drift case.
    const snap = getCareerSnapshot();
    expect(snap).not.toBeNull();
    for (const r of snap!.reputation.byRole) {
      expect(r.flightCount).toBe(0);
      expect(r.score).toBe(0); // clamped despite stored 25
    }
  });

  it("includes a milestones block with simNow and pilotName", () => {
    const snap = getCareerSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.pilotName).toBe("TestPilot");
    expect(snap!.milestones.simNow).toBe(getCareer().simDateTime);
    expect(snap!.milestones.totalFlights).toBe(0);
    expect(snap!.milestones.aircraftOwned).toBe(0);
  });

  it("returns null when there is no career row", () => {
    db.delete(career).run();
    expect(getCareerSnapshot()).toBeNull();
  });
});

describe("getCareerSnapshot milestones", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  /** Override a job's distanceNm — fixture default is 0. */
  function setJobDistance(jobId: number, nm: number): void {
    db.update(jobs)
      .set({ distanceNm: nm })
      .where(eq(jobs.id, jobId))
      .run();
  }

  it("aggregates totalFlights, totalBlockMinutes, totalEarnings, and aircraftOwned", () => {
    insertOwnedAircraft({ tailNumber: "C-FONE" });
    insertOwnedAircraft({ tailNumber: "C-FTWO" });
    insertFlight({ blockTimeMinutes: 60, totalRevenue: 50_000, totalCost: 1_000 });
    insertFlight({ blockTimeMinutes: 90, totalRevenue: 80_000, totalCost: 2_000 });

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.totalFlights).toBe(2);
    expect(snap.milestones.totalBlockMinutes).toBe(150);
    expect(snap.milestones.totalEarnings).toBe(50_000 + 80_000);
    expect(snap.milestones.aircraftOwned).toBe(2);
  });

  it("aircraftOwned excludes sold aircraft", () => {
    insertOwnedAircraft();
    const sold = insertOwnedAircraft();
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, sold.id))
      .run();

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.aircraftOwned).toBe(1);
  });

  it("uniqueAirportsVisited counts distinct origin+destination ICAOs across flights", () => {
    insertFlight({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ originIcao: "CYCH", destinationIcao: "CYQM" });
    insertFlight({ originIcao: "CYHZ", destinationIcao: "CYQM" });

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.uniqueAirportsVisited).toBe(3); // CYHZ, CYCH, CYQM
  });

  it("longestFlight picks the flight whose linked job has the largest distanceNm", () => {
    const shortJob = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const longJob = insertJob({ originIcao: "CYHZ", destinationIcao: "CYQM" });
    setJobDistance(shortJob.id, 50);
    setJobDistance(longJob.id, 250);

    insertFlight({ jobId: shortJob.id, originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ jobId: longJob.id, originIcao: "CYHZ", destinationIcao: "CYQM" });

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.longestFlight).not.toBeNull();
    expect(snap.milestones.longestFlight!.distanceNm).toBe(250);
    expect(snap.milestones.longestFlight!.destinationIcao).toBe("CYQM");
    expect(snap.milestones.totalDistanceNm).toBe(50 + 250);
  });

  it("longestFlight is null when no flights have a positive linked distance", () => {
    insertFlight({ jobId: null }); // unlinked → distance defaults to 0
    const snap = getCareerSnapshot()!;
    expect(snap.milestones.longestFlight).toBeNull();
    expect(snap.milestones.totalDistanceNm).toBe(0);
  });

  it("favoriteRoute requires ≥3 flights AND a route with count ≥2", () => {
    // 3 flights, 2 share a route → favorite emerges.
    const j1 = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const j2 = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const j3 = insertJob({ originIcao: "CYHZ", destinationIcao: "CYQM" });
    insertFlight({ jobId: j1.id, originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ jobId: j2.id, originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ jobId: j3.id, originIcao: "CYHZ", destinationIcao: "CYQM" });

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.favoriteRoute).toEqual({
      origin: "CYHZ",
      destination: "CYCH",
      count: 2,
    });
  });

  it("favoriteRoute is null with only 2 flights even when they match", () => {
    insertFlight({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const snap = getCareerSnapshot()!;
    expect(snap.milestones.favoriteRoute).toBeNull();
  });

  it("favoriteRoute is null when ≥3 flights are all distinct routes", () => {
    insertFlight({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    insertFlight({ originIcao: "CYCH", destinationIcao: "CYQM" });
    insertFlight({ originIcao: "CYQM", destinationIcao: "CYHZ" });
    const snap = getCareerSnapshot()!;
    expect(snap.milestones.favoriteRoute).toBeNull();
  });

  it("topClient is the client with the most flights, with totalEarnings rolled up", () => {
    const cargo1 = insertJob({ clientId: "maritime_cargo" });
    const cargo2 = insertJob({ clientId: "maritime_cargo" });
    const other = insertJob({ clientId: "northern_outfitters" });

    insertFlight({ jobId: cargo1.id, totalRevenue: 30_000, totalCost: 1_000 });
    insertFlight({ jobId: cargo2.id, totalRevenue: 40_000, totalCost: 1_000 });
    insertFlight({ jobId: other.id, totalRevenue: 70_000, totalCost: 1_000 });

    const snap = getCareerSnapshot()!;
    expect(snap.milestones.topClient).not.toBeNull();
    expect(snap.milestones.topClient!.clientId).toBe("maritime_cargo");
    expect(snap.milestones.topClient!.flightCount).toBe(2);
    expect(snap.milestones.topClient!.totalEarnings).toBe(30_000 + 40_000);
  });

  it("topClient is null when no flights have a known client", () => {
    insertFlight({ jobId: null });
    const snap = getCareerSnapshot()!;
    expect(snap.milestones.topClient).toBeNull();
  });

  it("reputation byRole shows the real score (not the drift-clamp) once flights exist for that role", () => {
    // Default fixture sets each role rep to 25 with no flights → drift clamp.
    // Logging a bush flight should expose the real 25 and tier='mid'.
    const job = insertJob({ clientId: "maritime_cargo", role: "bush" });
    insertFlight({ jobId: job.id });

    const snap = getCareerSnapshot()!;
    const bush = snap.reputation.byRole.find((r) => r.role === "bush")!;
    expect(bush.flightCount).toBe(1);
    expect(bush.score).toBe(25);
    expect(bush.tier).toBe("mid");

    // Roles without flights stay clamped to 0.
    const airTaxi = snap.reputation.byRole.find((r) => r.role === "air_taxi")!;
    expect(airTaxi.flightCount).toBe(0);
    expect(airTaxi.score).toBe(0);
  });

  it("reputation byClient surfaces clients with flight history, sorted by score then flightCount", () => {
    const j1 = insertJob({ clientId: "maritime_cargo", role: "bush" });
    const j2 = insertJob({ clientId: "maritime_cargo", role: "bush" });
    insertFlight({ jobId: j1.id });
    insertFlight({ jobId: j2.id });

    const snap = getCareerSnapshot()!;
    const cargo = snap.reputation.byClient.find(
      (c) => c.clientId === "maritime_cargo",
    );
    expect(cargo).toBeDefined();
    expect(cargo!.flightCount).toBe(2);
    expect(cargo!.lastInteractionAt).not.toBeNull();
  });
});
