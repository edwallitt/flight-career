import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  ownedAircraft,
  ratings,
  transfers,
} from "../../db/schema.js";
import {
  getCareer,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import { acceptJob } from "../jobLifecycle.js";
import {
  executeTransfer,
  listOwnedAircraftForTransfer,
  previewTransfer,
} from "../travel.js";

describe("previewTransfer", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("pilot transfer: estimates duration and cost between two airports", () => {
    const result = previewTransfer({
      type: "pilot",
      destinationIcao: "CYQM",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.originIcao).toBe("CYHZ");
    expect(result.preview.destinationIcao).toBe("CYQM");
    expect(result.preview.distanceNm).toBeGreaterThan(0);
    expect(result.preview.estimate.durationMinutes).toBeGreaterThan(0);
    expect(result.preview.estimate.costCents).toBeGreaterThanOrEqual(0);
    expect(result.preview.willArriveAt).toBe(
      getCareer().simDateTime + result.preview.estimate.durationMinutes * 60_000,
    );
  });

  it("pilot_aircraft: factors in fuel and landing fees from destination airport", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const result = previewTransfer({
      type: "pilot_aircraft",
      destinationIcao: "CYQM",
      ownedAircraftId: ac.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.estimate.aircraftHoursAccrued).toBeGreaterThan(0);
    expect(result.preview.estimate.fuelGallonsBurned).toBeGreaterThan(0);
  });

  it("rejects when origin equals destination", () => {
    const result = previewTransfer({
      type: "pilot",
      destinationIcao: "CYHZ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/same airport/);
  });

  it("rejects unknown destination ICAO", () => {
    const result = previewTransfer({
      type: "pilot",
      destinationIcao: "ZZZZ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unknown destination/);
  });

  it("rejects pilot_aircraft without an aircraft id", () => {
    const result = previewTransfer({
      type: "pilot_aircraft",
      destinationIcao: "CYQM",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Aircraft is required/);
  });

  it("rejects when an active job is in flight", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const result = previewTransfer({
      type: "pilot",
      destinationIcao: "CYQM",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/job is active/);
  });
});

describe("executeTransfer", () => {
  beforeEach(() => resetTestDb({ cash: 1_000_000_00 }));

  it("pilot: moves player location, debits cost, writes transfers row — without advancing sim time", () => {
    const before = getCareer();

    const preview = previewTransfer({
      type: "pilot",
      destinationIcao: "CYQM",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const expectedCost = preview.preview.estimate.costCents;
    const expectedDuration = preview.preview.estimate.durationMinutes;

    const result = executeTransfer({
      type: "pilot",
      destinationIcao: "CYQM",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = getCareer();
    expect(after.currentLocationIcao).toBe("CYQM");
    expect(after.cash).toBe(before.cash - expectedCost);
    // Transfers are instantaneous: arrival is "now", not now + flight time.
    expect(result.arrivedAtSimTime).toBe(before.simDateTime);
    // Sanity: the flight itself is long (>= 30 min), so if it were being added
    // to sim time the assertion below would blow past the 1-minute window.
    expect(expectedDuration * 60_000).toBeGreaterThanOrEqual(30 * 60_000);
    // The post-transfer tick only folds in real wall-clock elapsed (a few ms
    // in a test) — the flight duration must NOT be added to the world clock.
    expect(after.simDateTime - before.simDateTime).toBeLessThan(60_000);

    const trRow = db
      .select()
      .from(transfers)
      .where(eq(transfers.id, result.transferId))
      .get()!;
    expect(trRow.type).toBe("pilot");
    expect(trRow.originIcao).toBe("CYHZ");
    expect(trRow.destinationIcao).toBe("CYQM");
    expect(trRow.ownedAircraftId).toBeNull();
  });

  it("pilot_aircraft: moves player + aircraft, accrues hours, credits class hours toward rating", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      airframeHours: 1500,
      hoursSince100hr: 50,
    });
    const sepBefore = db
      .select()
      .from(ratings)
      .where(eq(ratings.class, "SEP"))
      .get()!;

    const result = executeTransfer({
      type: "pilot_aircraft",
      destinationIcao: "CYQM",
      ownedAircraftId: ac.id,
    });
    expect(result.ok).toBe(true);

    const after = getCareer();
    expect(after.currentLocationIcao).toBe("CYQM");

    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.currentLocationIcao).toBe("CYQM");
    expect(acAfter.airframeHours).toBeGreaterThan(1500);
    expect(acAfter.hoursSince100hr).toBeGreaterThan(50);

    const sepAfter = db
      .select()
      .from(ratings)
      .where(eq(ratings.class, "SEP"))
      .get()!;
    expect(sepAfter.hoursInClass).toBeGreaterThan(sepBefore.hoursInClass);
  });

  it("aircraft (ferry): moves the aircraft but NOT the player, no rating credit", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      airframeHours: 1500,
    });
    const sepBefore = db
      .select()
      .from(ratings)
      .where(eq(ratings.class, "SEP"))
      .get()!;

    const before = getCareer();
    const result = executeTransfer({
      type: "aircraft",
      destinationIcao: "CYQM",
      ownedAircraftId: ac.id,
    });
    expect(result.ok).toBe(true);

    const after = getCareer();
    expect(after.currentLocationIcao).toBe(before.currentLocationIcao); // pilot stayed

    const acAfter = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, ac.id))
      .get()!;
    expect(acAfter.currentLocationIcao).toBe("CYQM");
    expect(acAfter.airframeHours).toBeGreaterThan(1500);

    const sepAfter = db
      .select()
      .from(ratings)
      .where(eq(ratings.class, "SEP"))
      .get()!;
    expect(sepAfter.hoursInClass).toBe(sepBefore.hoursInClass); // no credit
  });

  it("rejects executing when the aircraft is not available (e.g. in flight)", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      status: "in_flight",
    });
    const result = executeTransfer({
      type: "aircraft",
      destinationIcao: "CYQM",
      ownedAircraftId: ac.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not available/);
  });

  it("rejects when player can't cover the cost", () => {
    resetTestDb({ cash: 1_00 }); // $1
    const result = executeTransfer({
      type: "pilot",
      destinationIcao: "CYQM",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Insufficient cash/);

    // Sim state must be untouched on a failed transfer.
    expect(getCareer().currentLocationIcao).toBe("CYHZ");
  });
});

describe("listOwnedAircraftForTransfer", () => {
  beforeEach(() => resetTestDb());

  it("returns details for each non-sold aircraft, joined to type and airport", () => {
    const a = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    insertOwnedAircraft({ currentLocationIcao: "CYQM", status: "in_flight" });

    // Mark a third one sold — should NOT appear.
    const c = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    db.update(ownedAircraft)
      .set({ status: "sold" })
      .where(eq(ownedAircraft.id, c.id))
      .run();

    const list = listOwnedAircraftForTransfer();
    expect(list).toHaveLength(2);
    const ids = list.map((l) => l.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(c.id);
    for (const ac of list) {
      expect(ac.tailNumber).toBeTruthy();
      expect(ac.manufacturer).toBeTruthy();
      expect(ac.currentLocationName).toBeTruthy();
    }
  });
});
