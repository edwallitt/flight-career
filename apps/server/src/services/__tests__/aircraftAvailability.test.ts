import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { ownedAircraft, ratings } from "../../db/schema.js";
import {
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import { getCandidatesForJob } from "../aircraftAvailability.js";

describe("getCandidatesForJob", () => {
  beforeEach(() =>
    resetTestDb({
      cash: 1_000_000_00,
      // Default rentals: bonanza_g36 SEP at CYHZ.
    }),
  );

  it("returns null for an unknown job id", async () => {
    const result = await getCandidatesForJob(99999);
    expect(result).toBeNull();
  });

  it("ranks an owned-at-origin aircraft above a co-located rental", async () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      tailNumber: "C-FONE",
    });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });

    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    expect(result!.ranked.length).toBeGreaterThanOrEqual(2);

    const top = result!.ranked[0]!;
    expect(top.candidate.source).toBe("owned");
    expect(top.candidate.ownedAircraftId).toBe(ac.id);
    expect(top.eligibility.eligible).toBe(true);
  });

  it("excludes sold aircraft from the candidate set", async () => {
    const sold = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, sold.id))
      .run();

    const job = insertJob({ originIcao: "CYHZ" });
    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    expect(
      result!.ranked.some((r) => r.candidate.ownedAircraftId === sold.id),
    ).toBe(false);
  });

  it("ranks a rental at the player's location when there are no owned options", async () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    const top = result!.ranked[0]!;
    expect(top.candidate.source).toBe("rental");
    expect(top.eligibility.eligible).toBe(true);
  });

  it("attaches display + fuel data to each ranked candidate", async () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    for (const r of result!.ranked) {
      expect(r.display.model).toBeTruthy();
      expect(r.display.cruiseSpeedKts).toBeGreaterThan(0);
      expect(r.display.fuelType === "avgas" || r.display.fuelType === "jet-a").toBe(
        true,
      );
      expect(r.fuel.source).toBe(r.candidate.source);
      // Rentals always report status='rental'; owned report a real status.
      if (r.candidate.source === "rental") {
        expect(r.fuel.status).toBe("rental");
      } else {
        expect(["sufficient", "top_up", "insufficient"]).toContain(
          r.fuel.status,
        );
      }
    }
  });

  it("flags an owned aircraft with low fuel as 'insufficient' and an estimated range below trip distance", async () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      fuelOnBoardGal: 5, // far below trip needs
    });
    const job = insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYCH",
      payloadLbs: 500,
    });

    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    const owned = result!.ranked.find(
      (r) => r.candidate.ownedAircraftId === ac.id,
    )!;
    expect(owned.fuel.status).toBe("insufficient");
    expect(owned.fuel.estimatedRangeNm).toBeLessThan(result!.job.distanceNm);
  });

  it("returns NOT_RATED on candidates whose class the player lacks", async () => {
    // Drop MEP rating; insert an MEP-required job; offer a rental that's MEP.
    db.update(ratings)
      .set({ earned: false })
      .where(eq(ratings.class, "MEP"))
      .run();
    resetTestDb({
      ratingsEarned: { SEP: true, MEP: false, SET: false, JET: false },
      rentalsAt: { CYHZ: ["bonanza_g36", "baron_g58"] }, // baron is MEP
    });

    const job = insertJob({
      originIcao: "CYHZ",
      destinationIcao: "CYCH",
      requiredClass: "MEP",
      payloadLbs: 500,
    });

    const result = await getCandidatesForJob(job.id);
    expect(result).not.toBeNull();
    const baron = result!.ranked.find(
      (r) => r.candidate.aircraftTypeId === "baron_g58",
    );
    expect(baron).toBeTruthy();
    expect(baron!.eligibility.eligible).toBe(false);
    expect(baron!.eligibility.reasons).toContain("NOT_RATED");
  });

  it("computes job.distanceNm via haversine over the airport coordinates", async () => {
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYQM" });
    const result = await getCandidatesForJob(job.id);
    // CYHZ → CYQM is in the rough 60–150 nm band depending on the exact
    // aerodrome coords used for each.
    expect(result!.job.distanceNm).toBeGreaterThan(60);
    expect(result!.job.distanceNm).toBeLessThan(170);
  });
});
