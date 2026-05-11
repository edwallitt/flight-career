import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/client.js";
import {
  airports,
  career,
  flights,
  trackingState,
} from "../../db/schema.js";
import {
  insertJob,
  insertOwnedAircraft,
  resetTestDb,
} from "../../__tests__/helpers/fixtures.js";
import {
  acceptJob,
  briefJob,
  completeFlightAction,
  getTrackedCompletionPreview,
} from "../jobLifecycle.js";

// We bypass beginFlight (which gates on simBridge.isReadyForTracking()) and
// flip the career row directly so the test runs without a live websocket.
function forceInProgress(): void {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get()!;
  db.update(career)
    .set({
      activeFlightState: "in_progress",
      flightStartedAt: careerRow.simDateTime,
      trackingMode: "tracked",
    })
    .where(eq(career.id, 1))
    .run();
}

function seedTrackingState(jobId: number, opts: {
  events: Array<{ event: string; timestamp: number; positionLat?: number; positionLon?: number }>;
  fuelAtEngineStart?: number;
  fuelAtEngineStop?: number;
  currentFuel?: number;
  landingLat?: number;
  landingLon?: number;
}): void {
  db.insert(trackingState)
    .values({
      jobId,
      currentPositionLat: opts.landingLat ?? null,
      currentPositionLon: opts.landingLon ?? null,
      currentAltitudeFt: 0,
      currentGroundSpeedKts: 0,
      currentTrueHeadingDeg: 0,
      onGround: true,
      engineRunning: false,
      fuelTotalGal: opts.currentFuel ?? null,
      eventsReceived: JSON.stringify(opts.events),
      fuelAtEngineStartGal: opts.fuelAtEngineStart ?? null,
      fuelAtEngineStopGal: opts.fuelAtEngineStop ?? null,
      lastUpdatedAt: Date.now(),
      bridgeStatus: "connected",
    })
    .run();
}

describe("tracked completion", () => {
  beforeEach(() => resetTestDb());

  it("preview returns sim-derived block time and resolves planned destination", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();

    // CYCH coords come from the seed; we anchor touchdown right on the
    // destination so the resolver returns it without a diversion flag.
    const destAirport = db
      .select()
      .from(airports)
      .where(eq(airports.icao, "CYCH"))
      .get()!;
    const t0 = 1_700_000_000_000;
    seedTrackingState(job.id, {
      events: [
        { event: "engine_started", timestamp: t0 },
        { event: "lifted_off", timestamp: t0 + 5 * 60_000 },
        {
          event: "touched_down",
          timestamp: t0 + 60 * 60_000,
          positionLat: destAirport.lat,
          positionLon: destAirport.lon,
        },
        { event: "engine_stopped", timestamp: t0 + 65 * 60_000 },
      ],
      fuelAtEngineStart: 60,
      currentFuel: 45,
      landingLat: destAirport.lat,
      landingLon: destAirport.lon,
    });

    const preview = getTrackedCompletionPreview();
    expect(preview.available).toBe(true);
    expect(preview.blockTimeMinutes).toBe(65);
    expect(preview.fuelBurnedGal).toBeCloseTo(15, 1);
    expect(preview.resolvedDestinationIcao).toBe("CYCH");
    expect(preview.isDiversion).toBe(false);
  });

  it("completion persists sim-derived fields without overriding player-confirmed values", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();

    const t0 = 1_700_000_000_000;
    seedTrackingState(job.id, {
      events: [
        { event: "engine_started", timestamp: t0 },
        { event: "engine_stopped", timestamp: t0 + 90 * 60_000 },
      ],
      fuelAtEngineStart: 60,
      currentFuel: 38,
    });

    // Player edited the values — they typed 92 minutes, sim said 90.
    const result = completeFlightAction({
      actualDestinationIcao: "CYCH",
      blockTimeMinutes: 92,
      fuelBurnedGal: 24,
    });
    if (!result.ok) throw new Error(result.error);

    const flight = db.select().from(flights).orderBy(flights.id).all().at(-1)!;
    expect(flight.trackingMode).toBe("tracked");
    expect(flight.blockTimeMinutes).toBe(92); // player-confirmed wins
    expect(flight.simBlockTimeMinutes).toBeCloseTo(90, 1); // raw sim retained
    expect(flight.simEngineStartAt).toBe(t0);
    expect(flight.simEngineStopAt).toBe(t0 + 90 * 60_000);
    expect(flight.simFuelBurnedGal).toBeCloseTo(22, 1);

    // career fields cleared
    const careerRow = db.select().from(career).where(eq(career.id, 1)).get()!;
    expect(careerRow.trackingMode).toBeNull();
    expect(careerRow.activeFlightState).toBeNull();

    // tracking_state cleared
    const tracking = db
      .select()
      .from(trackingState)
      .where(eq(trackingState.jobId, job.id))
      .get();
    expect(tracking).toBeUndefined();
  });

  it("diversion: touchdown far from planned destination resolves to nearest airport", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();

    // Land at CYHZ instead of CYCH — should be detected as a diversion.
    const cyhz = db
      .select()
      .from(airports)
      .where(eq(airports.icao, "CYHZ"))
      .get()!;
    const t0 = 1_700_000_000_000;
    seedTrackingState(job.id, {
      events: [
        { event: "engine_started", timestamp: t0 },
        {
          event: "touched_down",
          timestamp: t0 + 30 * 60_000,
          positionLat: cyhz.lat,
          positionLon: cyhz.lon,
        },
        { event: "engine_stopped", timestamp: t0 + 35 * 60_000 },
      ],
      landingLat: cyhz.lat,
      landingLon: cyhz.lon,
    });

    const preview = getTrackedCompletionPreview();
    expect(preview.resolvedDestinationIcao).toBe("CYHZ");
    expect(preview.isDiversion).toBe(true);
  });

  it("preview unavailable when not in a tracked flight", () => {
    expect(getTrackedCompletionPreview().available).toBe(false);
  });

  it("beginFlight refuses tracked mode when bridge isn't ready and leaves career.trackingMode null", async () => {
    // Bridge isn't started in tests, so isReadyForTracking() is false. The
    // service must refuse rather than committing trackingMode='tracked' onto
    // a flight that has no event source.
    const { appRouter } = await import("../../trpc/router.js");
    const caller = appRouter.createCaller({});

    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    await caller.lifecycle.accept({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    await caller.lifecycle.brief({ fuelGallons: 0 });
    const result = await caller.lifecycle.beginFlight({ trackingMode: "tracked" });

    expect(result.ok).toBe(false);
    const careerRow = db.select().from(career).where(eq(career.id, 1)).get()!;
    expect(careerRow.trackingMode).toBeNull();
    // State stays at 'briefed' — refusal is total, not partial.
    expect(careerRow.activeFlightState).toBe("briefed");
  });

  it("preview surfaces destinationResolution='unresolved' when touchdown is far from any airport", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();

    // Touchdown in the middle of the Atlantic — nowhere near any airport.
    const t0 = 1_700_000_000_000;
    seedTrackingState(job.id, {
      events: [
        { event: "engine_started", timestamp: t0 },
        {
          event: "touched_down",
          timestamp: t0 + 30 * 60_000,
          positionLat: 40.0,
          positionLon: -40.0,
        },
        { event: "engine_stopped", timestamp: t0 + 35 * 60_000 },
      ],
      landingLat: 40.0,
      landingLon: -40.0,
    });

    const preview = getTrackedCompletionPreview();
    expect(preview.available).toBe(true);
    expect(preview.hasTrackingData).toBe(true);
    expect(preview.destinationResolution).toBe("unresolved");
    expect(preview.resolvedDestinationIcao).toBeNull();
    expect(preview.isDiversion).toBe(false);
  });

  it("preview surfaces hasTrackingData=false when tracked but no events captured", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();
    // No tracking_state row at all — bridge dropped before engine_started.

    const preview = getTrackedCompletionPreview();
    expect(preview.available).toBe(true);
    expect(preview.hasTrackingData).toBe(false);
    expect(preview.destinationResolution).toBe("not_landed_yet");
  });

  it("fuel burn uses fuelAtEngineStopGal when present, ignoring later refuel", () => {
    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    acceptJob({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    briefJob({ fuelGallons: 0 });
    forceInProgress();

    // Started at 60gal, stopped at 38gal (22gal burned). Then player refueled
    // back up to 55 — currentFuelGal mustn't poison the delta.
    const t0 = 1_700_000_000_000;
    seedTrackingState(job.id, {
      events: [
        { event: "engine_started", timestamp: t0 },
        { event: "engine_stopped", timestamp: t0 + 60 * 60_000 },
      ],
      fuelAtEngineStart: 60,
      fuelAtEngineStop: 38,
      currentFuel: 55,
    });

    const preview = getTrackedCompletionPreview();
    expect(preview.fuelBurnedGal).toBeCloseTo(22, 1);
  });

  it("switchToManual demotes a tracked in-progress flight to manual without changing state", async () => {
    const { appRouter } = await import("../../trpc/router.js");
    const caller = appRouter.createCaller({});

    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    await caller.lifecycle.accept({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    await caller.lifecycle.brief({ fuelGallons: 0 });
    forceInProgress(); // Bypass bridge gate to simulate a started tracked flight.

    const result = await caller.lifecycle.switchToManual();
    expect(result.ok).toBe(true);

    const careerRow = db.select().from(career).where(eq(career.id, 1)).get()!;
    expect(careerRow.trackingMode).toBe("manual");
    expect(careerRow.activeFlightState).toBe("in_progress"); // flight continues
    expect(careerRow.activeJobId).toBe(job.id);
  });

  it("beginFlight default (no trackingMode) leaves career.trackingMode='manual'", async () => {
    const { appRouter } = await import("../../trpc/router.js");
    const caller = appRouter.createCaller({});

    const ac = insertOwnedAircraft({ currentLocationIcao: "CYHZ", fuelOnBoardGal: 60 });
    const job = insertJob({ originIcao: "CYHZ", destinationIcao: "CYCH" });
    await caller.lifecycle.accept({
      jobId: job.id,
      aircraftSource: "owned",
      ownedAircraftId: ac.id,
    });
    await caller.lifecycle.brief({ fuelGallons: 0 });
    const result = await caller.lifecycle.beginFlight();

    expect(result.ok).toBe(true);
    const careerRow = db.select().from(career).where(eq(career.id, 1)).get()!;
    expect(careerRow.trackingMode).toBe("manual");
    expect(careerRow.activeFlightState).toBe("in_progress");
  });
});
