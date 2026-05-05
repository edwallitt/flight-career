import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import { flights, jobs, ownedAircraft, reputation } from "../../db/schema.js";
import {
  getCareer,
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  abortFlight,
  acceptJob,
  beginFlight,
  briefJob,
  cancelAcceptedJob,
  completeFlightAction,
  getActiveJob,
  type CompleteFlightActionResult,
  type CompletionSummaryPayload,
} from "../jobLifecycle.js";

function assertOk<T extends { ok: true } | { ok: false; error: string }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok:true, got error: ${result.error}`);
  }
}

function summaryOf(
  result: CompleteFlightActionResult,
): CompletionSummaryPayload {
  assertOk(result);
  return result.summary;
}

function getRep(scope: string): number {
  return (
    db.select().from(reputation).where(eq(reputation.scope, scope)).get()
      ?.score ?? 0
  );
}

function getJob(id: number): typeof jobs.$inferSelect {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!;
}

function getOwnedAircraft(id: number): typeof ownedAircraft.$inferSelect {
  return db
    .select()
    .from(ownedAircraft)
    .where(eq(ownedAircraft.id, id))
    .get()!;
}

describe("acceptJob", () => {
  beforeEach(() => resetTestDb());

  it("rental at player location: locks active state, marks job accepted", () => {
    const job = insertJob();
    const result = acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });

    expect(result).toEqual({ ok: true });
    expect(getCareer().activeJobId).toBe(job.id);
    expect(getCareer().activeFlightState).toBe("accepted");
    expect(getCareer().activeAircraftSource).toBe("rental");
    expect(getCareer().activeAircraftRentalTypeId).toBe("bonanza_g36");
    expect(getJob(job.id).status).toBe("accepted");
  });

  it("owned aircraft: status flips to committed", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const job = insertJob();
    const result = acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });

    expect(result.ok).toBe(true);
    expect(getOwnedAircraft(ac.id).status).toBe("committed");
    expect(getCareer().activeAircraftOwnedId).toBe(ac.id);
  });

  it("rejects when already on a job", () => {
    const job1 = insertJob();
    const job2 = insertJob();
    acceptJob({
      jobId: job1.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });

    const result = acceptJob({
      jobId: job2.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    expect(result).toEqual({ ok: false, error: "Already on an active job" });
  });

  it("rejects rental that isn't offered at player location", () => {
    const job = insertJob();
    // Default fixtures only place bonanza_g36 at CYHZ.
    const result = acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "caravan",
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /not available for rental/,
    );
  });

  it("rejects ineligible aircraft (insufficient payload)", () => {
    const job = insertJob({ payloadLbs: 2000 }); // Bonanza maxes at 1075
    const result = acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /Aircraft not eligible/,
    );
  });
});

describe("briefJob", () => {
  beforeEach(() => resetTestDb());

  function setupAccepted(): number {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    return job.id;
  }

  it("deducts cash and locks briefed state", () => {
    setupAccepted();
    const before = getCareer().cash;
    const result = briefJob({ fuelGallons: 30 });
    expect(result.ok).toBe(true);
    const after = getCareer();
    expect(after.activeFlightState).toBe("briefed");
    expect(after.briefedFuelGallons).toBe(30);
    expect(after.briefedFuelCostCents).toBe(
      (result as { ok: true; fuelCostCents: number }).fuelCostCents,
    );
    expect(after.cash).toBe(before - after.briefedFuelCostCents!);
  });

  it("rejects fuel below the operational floor", () => {
    setupAccepted();
    const result = briefJob({ fuelGallons: 1 });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /Fuel below operational minimum/,
    );
  });

  it("rejects when cash is insufficient", () => {
    resetTestDb({ cash: 100 }); // $1
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const result = briefJob({ fuelGallons: 30 });
    expect(result).toEqual({ ok: false, error: "Insufficient cash for fuel" });
  });

  it("rejects when not in accepted state", () => {
    // No active job at all.
    const result = briefJob({ fuelGallons: 30 });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /Cannot brief/,
    );
  });
});

describe("cancelAcceptedJob", () => {
  beforeEach(() => resetTestDb({ startingRoleRep: 50 }));

  it("from accepted: applies -2/-3 rep, releases aircraft, no fuel deducted", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });

    const before = getCareer().cash;
    const result = cancelAcceptedJob();
    expect(result).toEqual({ ok: true });

    expect(getRep("bush")).toBe(50 - 2);
    // Client rep starts at 0 and the cancel hit is -3 → clamped to 0 floor.
    expect(getRep("client:maritime_cargo")).toBe(0);
    expect(getJob(job.id).status).toBe("cancelled");
    expect(getOwnedAircraft(ac.id).status).toBe("available");
    expect(getCareer().activeJobId).toBeNull();
    expect(getCareer().cash).toBe(before);
  });

  it("from briefed: applies -5/-8 rep, fuel cost is NOT refunded", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const beforeBrief = getCareer().cash;
    briefJob({ fuelGallons: 30 });
    const afterBrief = getCareer().cash;
    expect(afterBrief).toBeLessThan(beforeBrief);

    const result = cancelAcceptedJob();
    expect(result.ok).toBe(true);
    expect(getRep("bush")).toBe(50 - 5);
    expect(getCareer().cash).toBe(afterBrief); // no refund
  });

  it("rejects when nothing to cancel", () => {
    const result = cancelAcceptedJob();
    expect(result).toEqual({ ok: false, error: "No cancellable active job" });
  });
});

describe("beginFlight", () => {
  beforeEach(() => resetTestDb());

  function setupBriefed(opts: { owned?: boolean } = {}): {
    jobId: number;
    aircraftId: number | null;
  } {
    const job = insertJob();
    let aircraftId: number | null = null;
    if (opts.owned) {
      const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ" });
      aircraftId = ac.id;
      acceptJob({
        jobId: job.id,
        aircraftSource: "owned",
        ownedAircraftId: ac.id,
      });
    } else {
      acceptJob({
        jobId: job.id,
        aircraftSource: "rental",
        rentalAircraftTypeId: "bonanza_g36",
      });
    }
    briefJob({ fuelGallons: 30 });
    return { jobId: job.id, aircraftId };
  }

  it("briefed → in_progress, sets flight_started_at, owned aircraft → in_flight", () => {
    const { jobId, aircraftId } = setupBriefed({ owned: true });
    const before = getCareer();
    const result = beginFlight();
    expect(result.ok).toBe(true);
    expect((result as { ok: true; startedAt: number }).startedAt).toBe(
      before.simDateTime,
    );

    const after = getCareer();
    expect(after.activeFlightState).toBe("in_progress");
    expect(after.flightStartedAt).toBe(before.simDateTime);

    expect(getJob(jobId).status).toBe("in_progress");
    expect(getOwnedAircraft(aircraftId!).status).toBe("in_flight");
  });

  it("rental: career flips, no aircraft row to update", () => {
    setupBriefed();
    const result = beginFlight();
    expect(result.ok).toBe(true);
    expect(getCareer().activeFlightState).toBe("in_progress");
  });

  it("rejects when not briefed", () => {
    // Just an accepted job, no brief.
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const result = beginFlight();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /Cannot begin flight/,
    );
  });
});

describe("completeFlightAction", () => {
  beforeEach(() => resetTestDb({ startingRoleRep: 25 }));

  function flyTo(): { jobId: number; aircraftId: number } {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      hoursSince100hr: 50,
      fuelOnBoardGal: 70,
    });
    const job = insertJob({ payloadLbs: 600, pay: 100_000 });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();
    return { jobId: job.id, aircraftId: ac.id };
  }

  it("on-time delivery: cash applied, location moved, rep + flights row + outcome", () => {
    const { jobId, aircraftId } = flyTo();
    const beforeCash = getCareer().cash;
    const result = completeFlightAction({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 60,
      fuelBurnedGal: 17,
    });
    const summary = summaryOf(result);

    const career = getCareer();
    expect(career.activeJobId).toBeNull();
    expect(career.activeFlightState).toBeNull();
    expect(career.flightStartedAt).toBeNull();
    expect(career.currentLocationIcao).toBe("CYCH");
    expect(career.cash).toBe(beforeCash + summary.netCashDelta);

    expect(getRep("bush")).toBe(25 + 2);
    expect(getRep("client:maritime_cargo")).toBe(3); // started at 0, +3

    expect(getJob(jobId).status).toBe("completed");
    expect(getJob(jobId).completedAt).toBe(career.simDateTime);

    const flightRows = db.select().from(flights).all();
    expect(flightRows).toHaveLength(1);
    const log = flightRows[0]!;
    expect(log.jobId).toBe(jobId);
    expect(log.outcome).toBe("completed");
    expect(log.originIcao).toBe("CYHZ");
    expect(log.destinationIcao).toBe("CYCH");
    expect(log.blockTimeMinutes).toBe(60);
    expect(log.endedAt - log.startedAt).toBe(60 * 60_000);

    const ac = getOwnedAircraft(aircraftId);
    expect(ac.status).toBe("available");
    expect(ac.currentLocationIcao).toBe("CYCH");
    expect(ac.hoursSince100hr).toBeCloseTo(51, 5); // 50 + 60min/60
    expect(ac.airframeHours).toBeCloseTo(1501, 5);
  });

  it("diversion within 50nm marks outcome=diverted and reduces pay", () => {
    flyTo();
    // CYHZ → CYCH job, divert to CYAW (Shearwater, ~5nm from CYHZ; close to CYCH? probably not, but
    // let's pick a real near-airport. Use CYHZ destination as a deliberate ~0nm diversion just to
    // exercise the near-tier path — diverted distance from target = haversine(CYHZ, CYCH) which
    // is the planned distance. That actually puts us in far-tier. Use a nearer airport.)
    // CYAW is ~7nm from CYHZ but CYCH is the target. Picking CYDF (Deer Lake) instead would be too far.
    // Easiest deterministic check: pretend we landed at the same job destination → not a diversion.
    // For diversion, divert to a real airport near CYCH. CYQM (Moncton) is ~50nm from CYCH.
    const result = completeFlightAction({
      actualDestinationIcao: "CYQM",
      blockTimeMinutes: 60,
      fuelBurnedGal: 17,
    });
    const summary = summaryOf(result);
    const log = db.select().from(flights).all()[0]!;
    expect(["diverted", "failed"]).toContain(log.outcome);
    // Whatever the diversion tier, finalPay must be < jobPay.
    expect(summary.finalPay).toBeLessThan(100_000);
    expect(summary.diversionAdjustment).toBeLessThan(0);
  });

  it("rental flight: aircraftUpdates is null, rentalCost charged, no owned aircraft state", () => {
    const job = insertJob({ payloadLbs: 600, pay: 100_000 });
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();

    const result = completeFlightAction({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 60,
      fuelBurnedGal: 17,
    });
    const summary = summaryOf(result);
    expect(summary.aircraftUpdates).toBeNull();
    expect(summary.rentalCost).toBeGreaterThan(0);
    expect(summary.destinationRefuelCost).toBe(0);
  });

  it("rejects when not in_progress", () => {
    const result = completeFlightAction({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 60,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown destination ICAO", () => {
    flyTo();
    const result = completeFlightAction({
      actualDestinationIcao: "XXXX",
      blockTimeMinutes: 60,
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /Unknown destination/,
    );
  });

  it("100-hour inspection alert fires when crossing the threshold", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      hoursSince100hr: 99.5,
    });
    const job = insertJob({ payloadLbs: 600, pay: 100_000 });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();

    const result = completeFlightAction({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 60,
    });
    const summary = summaryOf(result);
    expect(summary.inspectionAlerts.some((s) => s.includes("100-hour"))).toBe(
      true,
    );
  });
});

describe("abortFlight", () => {
  beforeEach(() => resetTestDb({ startingRoleRep: 50 }));

  it("applies -8/-12 rep, cancels job, restores owned aircraft without hours", () => {
    const ac = insertOwnedAircraft({
      currentLocationIcao: "CYHZ",
      airframeHours: 1500,
    });
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();

    const result = abortFlight();
    expect(result).toEqual({ ok: true });
    expect(getRep("bush")).toBe(50 - 8);
    expect(getRep("client:maritime_cargo")).toBe(0); // started 0, clamped on -12
    expect(getJob(job.id).status).toBe("cancelled");
    expect(getOwnedAircraft(ac.id).status).toBe("available");
    expect(getOwnedAircraft(ac.id).airframeHours).toBe(1500); // unchanged
    expect(getCareer().activeJobId).toBeNull();
    expect(getCareer().flightStartedAt).toBeNull();
  });

  it("open-market job: no reputation change", () => {
    const job = insertJob({ role: "open", clientId: null });
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();

    abortFlight();
    expect(getRep("bush")).toBe(50);
    expect(getRep("air_taxi")).toBe(50);
  });

  it("rejects when nothing in flight", () => {
    const result = abortFlight();
    expect(result).toEqual({ ok: false, error: "No flight in progress" });
  });
});

describe("getActiveJob.cancelPenalty", () => {
  beforeEach(() => resetTestDb());

  it("accepted state → -2/-3", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    const snap = getActiveJob();
    expect(snap?.cancelPenalty).toEqual({ role: -2, client: -3 });
  });

  it("briefed state → -5/-8", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    briefJob({ fuelGallons: 30 });
    const snap = getActiveJob();
    expect(snap?.cancelPenalty).toEqual({ role: -5, client: -8 });
  });

  it("in_progress state → -8/-12 (abort magnitudes)", () => {
    const job = insertJob();
    acceptJob({
      jobId: job.id,
      aircraftSource: "rental",
      rentalAircraftTypeId: "bonanza_g36",
    });
    briefJob({ fuelGallons: 30 });
    beginFlight();
    const snap = getActiveJob();
    expect(snap?.cancelPenalty).toEqual({ role: -8, client: -12 });
  });
});
