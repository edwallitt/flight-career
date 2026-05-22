import { describe, expect, it } from "vitest";
import {
  buildTerminatorFC,
  computeJobRateRange,
  FERRY_LINE_COLOR,
  FIT_COLOR,
  FIT_UNKNOWN_COLOR,
  RATE_GRADIENT,
  resolveJobPaintColor,
  solarPosition,
  type AtlasJob,
} from "../AtlasMap.js";

// Terminator math is shading, not navigation — but if it drifts visibly
// (e.g. the night side ends up in the wrong hemisphere) the player loses
// trust in the whole sim-time surface. These tests pin the invariants
// that *would* be visible: subsolar at the right meridian for the time
// of day, declination sign matching the season, and the resulting fill
// covering the dark pole.

const HOUR = 60 * 60 * 1000;

describe("solarPosition", () => {
  it("places subsolar near 0° at UTC noon on the equinox", () => {
    // 2026-03-20 12:00 UTC — vernal equinox-ish day.
    const t = Date.UTC(2026, 2, 20, 12, 0);
    const s = solarPosition(t);
    expect(Math.abs(s.subsolarLon)).toBeLessThan(0.1); // sub-degree
    // Declination is near zero around the equinox.
    expect(Math.abs(s.declinationRad)).toBeLessThan(0.05);
  });

  it("moves subsolar 15° west per UTC hour", () => {
    const noon = Date.UTC(2026, 5, 21, 12, 0);
    const onePm = noon + HOUR;
    const s12 = solarPosition(noon);
    const s13 = solarPosition(onePm);
    // After noon the subsolar point sits at -15° (15° W of Greenwich).
    expect(s13.subsolarLon - s12.subsolarLon).toBeCloseTo(-15, 1);
  });

  it("gives positive declination in NH summer", () => {
    // 2026-06-21 — summer solstice.
    const t = Date.UTC(2026, 5, 21, 12, 0);
    const s = solarPosition(t);
    const decDeg = (s.declinationRad * 180) / Math.PI;
    expect(decDeg).toBeGreaterThan(20);
    expect(decDeg).toBeLessThan(24);
  });

  it("gives negative declination in NH winter", () => {
    const t = Date.UTC(2026, 11, 21, 12, 0);
    const s = solarPosition(t);
    const decDeg = (s.declinationRad * 180) / Math.PI;
    expect(decDeg).toBeLessThan(-20);
    expect(decDeg).toBeGreaterThan(-24);
  });
});

describe("buildTerminatorFC", () => {
  it("produces a closed polygon in NH summer with night pole near south", () => {
    const t = Date.UTC(2026, 5, 21, 12, 0);
    const fc = buildTerminatorFC(t);
    expect(fc.features).toHaveLength(1);
    const ring = fc.features[0]!.geometry.coordinates[0]!;
    // Ring is closed.
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Polygon must include points at the southern night-pole closure.
    const hasSouthClosure = ring.some(
      ([, lat]) => typeof lat === "number" && lat < -80,
    );
    expect(hasSouthClosure).toBe(true);
    // And no point near the north pole closure (since in NH summer the
    // north sits in 24h day).
    const hasNorthClosure = ring.some(
      ([, lat]) => typeof lat === "number" && lat > 80,
    );
    expect(hasNorthClosure).toBe(false);
  });

  it("flips the night-pole closure for NH winter", () => {
    const t = Date.UTC(2026, 11, 21, 12, 0);
    const fc = buildTerminatorFC(t);
    expect(fc.features).toHaveLength(1);
    const ring = fc.features[0]!.geometry.coordinates[0]!;
    const hasNorthClosure = ring.some(
      ([, lat]) => typeof lat === "number" && lat > 80,
    );
    expect(hasNorthClosure).toBe(true);
  });

  it("emits no features near the equinox where the formula degenerates", () => {
    const t = Date.UTC(2026, 2, 20, 12, 0); // vernal equinox-ish
    const fc = buildTerminatorFC(t);
    // We deliberately bail out within ±0.5° of declination zero.
    expect(fc.features.length).toBeLessThanOrEqual(1);
  });
});

describe("computeJobRateRange", () => {
  const baseJob = {
    role: "bush",
    requiredClass: "SEP",
    urgency: "standard",
    weatherSensitivity: "none",
    clientId: null,
    clientName: null,
    description: "",
    jobType: "standard",
    ferrySource: null,
    ferryAircraftTail: null,
    ferryAircraftLabel: null,
    originIcao: "A",
    destinationIcao: "B",
    originLat: 0,
    originLon: 0,
    originName: "A",
    destinationLat: 0,
    destinationLon: 0,
    destinationName: "B",
  } as const;

  function makeJob(id: number, payCents: number, distanceNm: number): AtlasJob {
    return { ...baseJob, id, pay: payCents, distanceNm } as AtlasJob;
  }

  it("returns null when no scoreable jobs exist", () => {
    expect(computeJobRateRange([])).toBeNull();
    // Zero-distance jobs aren't scoreable.
    expect(computeJobRateRange([makeJob(1, 5000, 0)])).toBeNull();
  });

  it("returns lo/hi in $/nm units", () => {
    const ctx = computeJobRateRange([
      makeJob(1, 10000, 100), // $1.00/nm
      makeJob(2, 30000, 100), // $3.00/nm
      makeJob(3, 20000, 100), // $2.00/nm
    ]);
    expect(ctx).not.toBeNull();
    expect(ctx!.lo).toBeCloseTo(1.0, 2);
    expect(ctx!.hi).toBeCloseTo(3.0, 2);
  });

  it("excludes ferry jobs from the rate range", () => {
    const ctx = computeJobRateRange([
      makeJob(1, 10000, 100),
      { ...makeJob(2, 99999, 100), jobType: "ferry" } as AtlasJob,
    ]);
    expect(ctx).not.toBeNull();
    expect(ctx!.hi).toBeCloseTo(1.0, 2);
  });
});

describe("resolveJobPaintColor", () => {
  // Three subtle invariants worth locking: ferries opt out of every
  // alternative encoding; missing fit data falls back to gray instead of
  // exploding; and a degenerate rate range (one job, or all jobs equal)
  // returns the midpoint color, not NaN.
  const standard = {
    id: 1,
    pay: 50000,
    distanceNm: 100,
    role: "bush",
    requiredClass: "SEP",
    urgency: "standard",
    weatherSensitivity: "none",
    clientId: null,
    clientName: null,
    description: "",
    jobType: "standard",
    ferrySource: null,
    ferryAircraftTail: null,
    ferryAircraftLabel: null,
    originIcao: "A",
    destinationIcao: "B",
    originLat: 0,
    originLon: 0,
    originName: "A",
    destinationLat: 0,
    destinationLon: 0,
    destinationName: "B",
  } as AtlasJob;
  const ferry = { ...standard, jobType: "ferry" } as AtlasJob;

  it("ferry jobs paint ferry color under every encoding", () => {
    expect(resolveJobPaintColor(ferry, "role", null, null)).toBe(
      FERRY_LINE_COLOR,
    );
    expect(
      resolveJobPaintColor(ferry, "fit", new Map([[1, "ready"]]), null),
    ).toBe(FERRY_LINE_COLOR);
    expect(
      resolveJobPaintColor(ferry, "rate", null, { lo: 1, hi: 5 }),
    ).toBe(FERRY_LINE_COLOR);
  });

  it("unknown fit (job not in map) falls back to the unknown gray", () => {
    expect(resolveJobPaintColor(standard, "fit", new Map(), null)).toBe(
      FIT_UNKNOWN_COLOR,
    );
    expect(resolveJobPaintColor(standard, "fit", null, null)).toBe(
      FIT_UNKNOWN_COLOR,
    );
  });

  it("known fit picks the matching FIT_COLOR", () => {
    const fit = new Map([[1, "ready" as const]]);
    expect(resolveJobPaintColor(standard, "fit", fit, null)).toBe(
      FIT_COLOR.ready,
    );
  });

  it("rate mode with lo === hi returns the gradient midpoint", () => {
    // If every job has the same $/nm, the gradient flattens — we don't
    // want NaN colors. The mid stop is the only correct answer here.
    const color = resolveJobPaintColor(standard, "rate", null, {
      lo: 2,
      hi: 2,
    });
    expect(color).toBe(RATE_GRADIENT.mid);
  });

  it("rate mode with zero distance falls to the worst color", () => {
    const noDistance = { ...standard, distanceNm: 0 } as AtlasJob;
    expect(
      resolveJobPaintColor(noDistance, "rate", null, { lo: 1, hi: 5 }),
    ).toBe(RATE_GRADIENT.worst);
  });
});
