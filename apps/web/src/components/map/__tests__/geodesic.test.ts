import { describe, expect, it } from "vitest";
import {
  geodesicCircleCoords,
  haversineNm,
  computeReachableIcaoSet,
  type AtlasAirport,
} from "../AtlasMap.js";

// The geodesic-ring math underpins both the visual range rings and the
// reachability dim. If it drifts, players see airports highlighted as
// reachable that they can't actually fly to, or rings that don't line up
// with the dim border — a particularly nasty class of bug because it
// erodes trust in the planning surface. So we lock the invariants in.

describe("geodesicCircleCoords", () => {
  it("returns segments + 1 coordinates (closed ring)", () => {
    const pts = geodesicCircleCoords(45, -65, 200, 64);
    expect(pts).toHaveLength(65);
    // Last point coincides with the first to close the line.
    expect(pts[0]?.[0]).toBeCloseTo(pts[pts.length - 1]?.[0] ?? 0, 6);
    expect(pts[0]?.[1]).toBeCloseTo(pts[pts.length - 1]?.[1] ?? 0, 6);
  });

  it("places every point ~rangeNm from the center under haversine", () => {
    const lat = 45;
    const lon = -65;
    const range = 400;
    const pts = geodesicCircleCoords(lat, lon, range, 128);
    for (const [lo, la] of pts) {
      const d = haversineNm(lat, lon, la, lo);
      // 0.5nm tolerance on a 400nm circle is well within the rounding of
      // the trig functions and the float math involved.
      expect(Math.abs(d - range)).toBeLessThan(0.5);
    }
  });

  it("works at small ranges and high latitudes", () => {
    const lat = 67;
    const lon = -50;
    const range = 25;
    const pts = geodesicCircleCoords(lat, lon, range, 96);
    for (const [lo, la] of pts) {
      const d = haversineNm(lat, lon, la, lo);
      expect(Math.abs(d - range)).toBeLessThan(0.1);
    }
  });

  it("normalizes longitudes into [-180, 180]", () => {
    // A ring near the antimeridian shouldn't wrap to +/-200.
    const pts = geodesicCircleCoords(40, 179, 100);
    for (const [lo] of pts) {
      expect(lo).toBeGreaterThanOrEqual(-180);
      expect(lo).toBeLessThanOrEqual(180);
    }
  });
});

describe("computeReachableIcaoSet", () => {
  // Mini fixture: two airports inside range, one outside, one at infinity.
  const here: AtlasAirport = {
    icao: "AAAA",
    name: "Here",
    country: "X",
    region: "x",
    lat: 45,
    lon: -65,
    size: "regional",
    longestRunwayFt: 6000,
    fuelPriceAvgas: null,
    fuelPriceJetA: null,
    hasMaintenance: false,
    hasFbo: false,
  };
  const close: AtlasAirport = { ...here, icao: "BBBB", lat: 45.5, lon: -65.5 };
  const mid: AtlasAirport = { ...here, icao: "CCCC", lat: 46, lon: -67 };
  const far: AtlasAirport = { ...here, icao: "DDDD", lat: 60, lon: -100 };

  it("returns null when dim is disabled", () => {
    const out = computeReachableIcaoSet(
      { lat: 45, lon: -65, rangeNm: 400, cruiseSpeedKts: 140, tailNumber: "N1", aircraftTypeLabel: "X" },
      [here, close, mid, far],
      false,
    );
    expect(out).toBeNull();
  });

  it("returns null when there's no anchor", () => {
    expect(computeReachableIcaoSet(null, [here, close], true)).toBeNull();
  });

  it("includes airports within range and excludes those outside", () => {
    const out = computeReachableIcaoSet(
      {
        lat: 45,
        lon: -65,
        rangeNm: 200,
        cruiseSpeedKts: 140,
        tailNumber: "N1",
        aircraftTypeLabel: "X",
      },
      [here, close, mid, far],
      true,
    )!;
    expect(out.has("AAAA")).toBe(true); // distance 0
    expect(out.has("BBBB")).toBe(true); // ~ 40nm
    // mid is ~ 110nm — keep in range; far is way out.
    expect(out.has("CCCC")).toBe(true);
    expect(out.has("DDDD")).toBe(false);
  });
});
