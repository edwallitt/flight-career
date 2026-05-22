import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  Point,
  LineString,
  Polygon,
} from "geojson";
import { MAP_PALETTE, getMapStyle } from "../../lib/map/style.js";

// Re-export server data shapes via a thin client surface so this component
// doesn't import from the server package.
export interface AtlasAirport {
  icao: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  size: "major" | "regional" | "small" | "remote";
  longestRunwayFt: number;
  fuelPriceAvgas: number | null;
  fuelPriceJetA: number | null;
  hasMaintenance: boolean;
  hasFbo: boolean;
}

export interface AtlasOwnedAircraft {
  id: number;
  tailNumber: string;
  aircraftTypeLabel: string;
  aircraftClass: "SEP" | "MEP" | "SET" | "JET";
  currentLocationIcao: string;
  currentLocationName: string;
  lat: number;
  lon: number;
  status: "available" | "in_maintenance" | "in_flight" | "committed";
  airframeHours: number;
  engineHoursSinceOverhaul: number;
  tboHours: number;
  fuelType: "avgas" | "jet-a";
  rangeNm: number;
  cruiseSpeedKts: number;
  // Usable fuel capacity in US gallons. 0 = catalog hasn't backfilled the
  // value; the drawer renders "—" rather than a phantom $0.
  fuelCapacityGal: number;
}

export interface AtlasRecentFlight {
  id: number;
  fromIcao: string;
  toIcao: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  endedAt: number;
  ageDays: number;
  netCents: number;
  blockTimeMinutes: number;
  aircraftLabel: string;
}

export interface AtlasJob {
  id: number;
  originIcao: string;
  originLat: number;
  originLon: number;
  originName: string;
  destinationIcao: string;
  destinationLat: number;
  destinationLon: number;
  destinationName: string;
  distanceNm: number;
  role: "bush" | "air_taxi" | "light_jet" | "open";
  requiredClass: "SEP" | "MEP" | "SET" | "JET";
  urgency: "flexible" | "standard" | "urgent" | "critical";
  weatherSensitivity: "none" | "mild" | "strict";
  pay: number;
  clientId: string | null;
  clientName: string | null;
  description: string;
  jobType: "standard" | "ferry";
  ferrySource: "owner" | "dealer" | "operator" | null;
  ferryAircraftTail: string | null;
  ferryAircraftLabel: string | null;
}

export interface AtlasPlayer {
  currentLocationIcao: string;
  currentLocationName: string;
  lat: number;
  lon: number;
  simDateTime: number;
}

export interface AtlasActiveTrackedFlight {
  jobId: number;
  ownedAircraftId: number | null;
  originIcao: string;
  originName: string;
  originLat: number;
  originLon: number;
  destinationIcao: string;
  destinationName: string;
  destinationLat: number;
  destinationLon: number;
  totalDistanceNm: number;
}

// Live aircraft state sampled from the SimBridge. Passed in separately from
// `data` so the parent can poll it at 1Hz without invalidating the rest of
// the atlas dataset.
export interface AtlasTrackedPosition {
  lat: number;
  lon: number;
  headingDeg: number;
  altitudeFt: number;
  groundSpeedKts: number;
  onGround: boolean;
}

export interface AtlasData {
  airports: AtlasAirport[];
  ownedAircraft: AtlasOwnedAircraft[];
  recentFlights: AtlasRecentFlight[];
  jobs: AtlasJob[];
  player: AtlasPlayer | null;
  activeTrackedFlight: AtlasActiveTrackedFlight | null;
}

export type AtlasFeatureRef =
  | { type: "airport"; icao: string }
  | { type: "aircraft"; id: number }
  | { type: "flight"; id: number }
  | { type: "job"; id: number };

export interface AtlasLayerSet {
  airports: boolean;
  fuelPrices: boolean;
  ownedAircraft: boolean;
  recentFlights: boolean;
  jobs: boolean;
  playerLocation: boolean;
  // Live MSFS-tracked flight (route + moving aircraft marker). Layer is only
  // meaningful while `data.activeTrackedFlight` is non-null — the LayerPanel
  // suppresses the row otherwise.
  trackedFlight: boolean;
  // Range rings + reachability dim. Each can be toggled independently — a
  // player may want the rings without dimming, or vice versa. Both no-op
  // unless an AtlasRangeAnchor is supplied (which itself requires an
  // available owned aircraft at the player's airport).
  rangeRings: boolean;
  reachabilityDim: boolean;
  // Day-night terminator overlay. On by default — atmospheric + planning
  // cue. Off via the layer panel for the rare player who finds the
  // contrast distracting.
  nightShade: boolean;
}

// Anchor for the range overlay. Provided by the parent so the planning model
// (which aircraft drives the rings) stays in one place. Null when no eligible
// aircraft is at the player's airport — rings disappear and dim is suppressed.
export interface AtlasRangeAnchor {
  lat: number;
  lon: number;
  // Straight-line range in nm. The inner solid ring is rendered at
  // rangeNm / 1.15 to match the eligibility reserve factor; the outer dashed
  // ring is the raw catalog range.
  rangeNm: number;
  cruiseSpeedKts: number;
  tailNumber: string;
  aircraftTypeLabel: string;
  // True when the parent is overriding the default "best aircraft at the
  // player's airport" computation. The map renders a chip in the top bar so
  // the player knows they're looking at a hypothetical, not their actual
  // dispatch envelope.
  isOverride?: boolean;
}

export type AtlasJobClassFilter = "any" | AtlasJob["requiredClass"];

// How job lines / dots / arrows are colored. Three encodings expose
// different planning intents:
//   role     — what kind of work (today's default, doctrine matching)
//   fit      — green ready / amber reposition / red unreachable / gray
//              locked. Requires fit data from jobs.listWithReachability.
//   rate     — dollar-per-nm gradient. Worst rates fade dim; best go
//              green. Computed against the visible jobs' lo/hi.
export type AtlasJobColorBy = "role" | "fit" | "rate";

// Fit status mirrors the JobFit.status enum on the server. Decoupling
// here so AtlasMap doesn't import from the server package.
export type AtlasJobFitStatus = "ready" | "reposition" | "wont_fit" | "locked";

export const FIT_COLOR: Record<AtlasJobFitStatus, string> = {
  ready: "#5ec47c",
  reposition: "#d4a574",
  wont_fit: "#e15c4f",
  locked: "#7d7d7d",
};
// Falls back to gray when we have no fit row for a job — happens during
// the lag between an atlas.getData refresh and the next
// listWithReachability refresh, and for any unmerged edge case.
export const FIT_UNKNOWN_COLOR = "#5d5d5d";

// Rate gradient. Inverted semantics vs the fuel gradient: high $/nm is
// *good* for the player so it earns the green end, low rate dims out.
export const RATE_GRADIENT = {
  worst: "#7a6e57",
  mid: "#cfcfcf",
  best: "#5ec47c",
} as const;

export interface AtlasJobFilters {
  // Inclusive nautical-mile distance window applied to job route length.
  distanceNm: { min: number; max: number };
  // Empty / "any" means no class restriction.
  classes: AtlasJobClassFilter[];
}

export interface AtlasMapProps {
  data: AtlasData;
  visibleLayers: AtlasLayerSet;
  jobFilters?: AtlasJobFilters;
  selectedFeature?: AtlasFeatureRef | null;
  onFeatureClick?: (feature: AtlasFeatureRef) => void;
  // Reports the filtered count back so the layer panel can render "8 / 14".
  onFilteredJobsChange?: (count: number) => void;
  // Fuel type the overlay should color airports by. Driven by what the player
  // actually consumes (any jet/turbine → jet-a, else avgas).
  fuelOverlayType?: "avgas" | "jet-a";
  // Live position from the SimBridge. Renders the moving aircraft glyph + the
  // flown/remaining route split. Null while the bridge has no fresh sample
  // (e.g. mid-reconnect) — the route line stays put but the marker freezes.
  trackedPosition?: AtlasTrackedPosition | null;
  // Anchor for range rings + reachability dim. The parent computes this from
  // the best available owned aircraft sitting at the player's airport.
  rangeAnchor?: AtlasRangeAnchor | null;
  // Imperative "focus this point" signal. Parent bumps `key` to retrigger
  // the flyTo even when the destination hasn't changed (e.g. user searches
  // the same ICAO twice). null suppresses any movement.
  focusPoint?: { lat: number; lon: number; zoom?: number; key: number } | null;
  // Color-by mode for job lines + dots + arrows. Defaults to "role" so
  // existing callers and screenshots stay unchanged.
  jobColorBy?: AtlasJobColorBy;
  // Per-job fit status, keyed by job id. Only consulted when jobColorBy ===
  // "fit". Missing entries (and missing map entirely) fall back to the
  // unknown gray so the player sees something rather than nothing.
  jobFitById?: ReadonlyMap<number, AtlasJobFitStatus>;
}

// ---------------------------------------------------------------------------
// Layer / source IDs
// ---------------------------------------------------------------------------

const SRC_AIRPORTS = "src-airports";
const SRC_FLIGHTS = "src-flights";
const SRC_OWNED = "src-owned";
const SRC_JOBS_LINES = "src-jobs-lines";
const SRC_JOBS_POINTS = "src-jobs-points";
const SRC_PLAYER = "src-player";
const SRC_TRACKED_LINES = "src-tracked-lines";
const SRC_TRACKED_POINTS = "src-tracked-points";
const SRC_TRACKED_AIRCRAFT = "src-tracked-aircraft";
const SRC_RANGE = "src-range";
const SRC_TERMINATOR = "src-terminator";

const L_AIRPORT_HALO = "l-airport-halo"; // outer ring for major airports
const L_AIRPORT_CIRCLE = "l-airport-circle";
const L_AIRPORT_LABEL = "l-airport-label";
const L_FLIGHT_GLOW = "l-flight-glow";
const L_FLIGHT_LINE = "l-flight-line";
const L_OWNED_BG = "l-owned-bg";
const L_OWNED_ICON = "l-owned-icon";
const L_OWNED_LABEL = "l-owned-label";
// Open-job layers — line connecting origin → dest, plus emphasis dots at each
// end. Replaces the older single-triangle marker.
const L_JOB_LINE_HIT = "l-job-line-hit"; // wide invisible hit area
const L_JOB_LINE = "l-job-line";
const L_JOB_ARROW = "l-job-arrow"; // direction marker at line midpoint
const L_JOB_ORIGIN = "l-job-origin";
const L_JOB_DEST = "l-job-dest";
const L_PLAYER_RING = "l-player-ring";
const L_PLAYER_PULSE_A = "l-player-pulse-a";
const L_PLAYER_PULSE_B = "l-player-pulse-b";
const L_PLAYER_DOT = "l-player-dot";
// Tracked-flight (live MSFS) layers. Flown = solid, remaining = dashed; the
// origin/destination dots and live aircraft glyph sit on top.
const L_TRACKED_REMAIN = "l-tracked-remain";
const L_TRACKED_FLOWN_GLOW = "l-tracked-flown-glow";
const L_TRACKED_FLOWN = "l-tracked-flown";
const L_TRACKED_ORIGIN = "l-tracked-origin";
const L_TRACKED_DEST = "l-tracked-dest";
const L_TRACKED_AIRCRAFT_HALO = "l-tracked-aircraft-halo";
const L_TRACKED_AIRCRAFT_BG = "l-tracked-aircraft-bg";
const L_TRACKED_AIRCRAFT_ICON = "l-tracked-aircraft-icon";
// Range rings — outer (catalog range, dashed) and inner (range / reserve
// factor, solid). Both drawn from the same source (SRC_RANGE) and filtered by
// the feature's `kind` property.
const L_RANGE_OUTER = "l-range-outer";
const L_RANGE_INNER = "l-range-inner";
// Day-night terminator — single fill layer over the night hemisphere,
// derived from career.simDateTime. Underlays everything except basemap.
const L_TERMINATOR = "l-terminator";

// Color helpers ------------------------------------------------------------

const SIZE_RADIUS: Record<AtlasAirport["size"], number> = {
  major: 7,
  regional: 5,
  small: 3.5,
  remote: 3,
};

const SIZE_TIER_COLOR: Record<AtlasAirport["size"], string> = {
  major: "#e6c69a",
  regional: "#b89167",
  small: "#7d6748",
  remote: "#564732",
};

// Exported so the AtlasLegend can render colour keys that stay in lockstep
// with what the map actually paints. Don't fork these — extend here.
export const STATUS_COLOR: Record<AtlasOwnedAircraft["status"], string> = {
  available: MAP_PALETTE.accent,
  in_flight: "#5ec47c",
  in_maintenance: "#e26464",
  committed: "#7d7d7d",
};

// Encode role as line color so the player can scan the chart for the kind of
// work available without reading any text.
export const ROLE_COLOR: Record<AtlasJob["role"], string> = {
  bush: "#5ec47c",
  air_taxi: "#d4a574",
  light_jet: "#a78bfa",
  open: "#7d7d7d",
};

// Ferries get their own color so a quick scan separates them from client work.
export const FERRY_LINE_COLOR = "#5da9d9";

// Fuel-price gradient endpoints. Mirrored by buildFuelPriceColorExpr; the
// legend uses these to draw the same gradient bar with live min/max labels.
export const FUEL_PRICE_GRADIENT = {
  cheap: "#5ec47c",
  mid: "#cfcfcf",
  expensive: "#e34d4d",
  noData: "#3a3a3a",
} as const;

// Single source of truth for how urgency drives job-line rendering. Both the
// map's MapLibre `match` expressions and the AtlasLegend's preview ticks
// read from this — without it the two visualisations drift apart silently
// (which is exactly what review-work caught the first time round).
//
// `legendWidth` / `legendOpacity` are intentionally a hair bolder than the
// map values: a 1.1px stroke at 0.4 opacity is barely visible inside a
// 22×8 SVG swatch on a dark background. The boost is proportional so the
// "critical >> flexible" ordering is preserved.
export const URGENCY_LINE_STYLE = [
  { urgency: "critical", mapWidth: 1.9, mapOpacity: 0.9, legendWidth: 2.4, legendOpacity: 0.9 },
  { urgency: "urgent", mapWidth: 1.7, mapOpacity: 0.8, legendWidth: 2.0, legendOpacity: 0.8 },
  { urgency: "standard", mapWidth: 1.4, mapOpacity: 0.6, legendWidth: 1.6, legendOpacity: 0.65 },
  { urgency: "flexible", mapWidth: 1.1, mapOpacity: 0.4, legendWidth: 1.2, legendOpacity: 0.45 },
] as const;
// Fallback used when MapLibre evaluates the `match` and finds an unknown
// urgency value. Centre of the table so the line still renders sensibly.
const URGENCY_FALLBACK_WIDTH = 1.4;
const URGENCY_FALLBACK_OPACITY = 0.6;

// Build a MapLibre `match` expression off URGENCY_LINE_STYLE for one of the
// numeric paint fields. Keeping this private to the module so callers can't
// accidentally read a stale array literal.
function urgencyMatchExpr(
  field: "mapWidth" | "mapOpacity",
  fallback: number,
): unknown {
  const expr: unknown[] = ["match", ["get", "urgency"]];
  for (const row of URGENCY_LINE_STYLE) {
    expr.push(row.urgency, row[field]);
  }
  expr.push(fallback);
  return expr;
}

// Resolve the paint color for a job under the current encoding. We compute
// up-front in the FC build step (rather than via a data-driven `match` in
// the paint expression) because each mode pulls from different sources —
// FC properties for fit, the dataset-wide rate range for $/nm — and
// MapLibre expressions can't reach the rate-range value cheaply. Cost is
// 30 lookups per atlas refresh, dwarfed by the maplibre source diff cost.
interface RateColorContext {
  // null when no jobs have a positive distance to anchor the gradient.
  lo: number;
  hi: number;
}

export function resolveJobPaintColor(
  job: AtlasJob,
  colorBy: AtlasJobColorBy,
  fitById: ReadonlyMap<number, AtlasJobFitStatus> | null,
  rateCtx: RateColorContext | null,
): string {
  // Ferry is its own visual class regardless of mode — it's a fundamental
  // category the player learned to recognize. Overriding it under "fit"
  // or "rate" would erase that signal for no clear benefit (ferries don't
  // even sit on the fit scoring pipeline the same way).
  if (job.jobType === "ferry") return FERRY_LINE_COLOR;

  if (colorBy === "fit") {
    const status = fitById?.get(job.id);
    return status ? FIT_COLOR[status] : FIT_UNKNOWN_COLOR;
  }

  if (colorBy === "rate") {
    if (!rateCtx || job.distanceNm <= 0) return RATE_GRADIENT.worst;
    const ratePerNm = job.pay / 100 / job.distanceNm; // $/nm
    const { lo, hi } = rateCtx;
    if (hi <= lo) return RATE_GRADIENT.mid;
    const t = Math.min(1, Math.max(0, (ratePerNm - lo) / (hi - lo)));
    // Two-stop linear interp through `mid` at t=0.5. Inlining keeps this
    // self-contained — bringing in a color-mix lib for one expression is
    // overkill.
    return mixColors(RATE_GRADIENT.worst, RATE_GRADIENT.best, t, RATE_GRADIENT.mid);
  }

  return ROLE_COLOR[job.role];
}

// Compute a 3-stop gradient sample at t∈[0,1] given lo/hi hex colors and
// an optional mid color. Returns "#rrggbb". The math is intentionally
// dumb — three-segment piecewise linear in sRGB. Good enough for a tactical
// dim/bright pop; not for color-science-grade gradients.
function mixColors(lo: string, hi: string, t: number, mid?: string): string {
  if (mid && t > 0 && t < 1) {
    if (t < 0.5) return mixTwo(lo, mid, t * 2);
    return mixTwo(mid, hi, (t - 0.5) * 2);
  }
  return mixTwo(lo, hi, t);
}

function mixTwo(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(bch)}`;
}

// Compute the $/nm lo/hi range across a job set. Null when no job has a
// positive distance. Used by the rate color resolver and exported for
// tests.
export function computeJobRateRange(jobs: AtlasJob[]): RateColorContext | null {
  const rates: number[] = [];
  for (const j of jobs) {
    if (j.jobType === "ferry") continue;
    if (j.distanceNm <= 0) continue;
    rates.push(j.pay / 100 / j.distanceNm);
  }
  if (rates.length === 0) return null;
  rates.sort((a, b) => a - b);
  return { lo: rates[0]!, hi: rates[rates.length - 1]! };
}


const PLAYER_GREEN = "#5ec47c";
// Tracked flight uses the same green as the player so the eye reads
// "you are here, live" without a new color in the palette.
const TRACKED_GREEN = "#5ec47c";

// ---------------------------------------------------------------------------
// Feature collection builders
// ---------------------------------------------------------------------------

function buildAirportFC(
  airports: AtlasAirport[],
  fuelType: "avgas" | "jet-a",
  reachable: ReadonlySet<string> | null,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: airports.map((a) => {
      // Use the chosen fuel type. If the airport doesn't sell it, the overlay
      // renders the marker as "no data" gray rather than guessing the other
      // fuel — that's a real signal to the player.
      const fuelPrice =
        fuelType === "jet-a" ? a.fuelPriceJetA : a.fuelPriceAvgas;
      // `inRange` is baked into the feature so paint expressions can dim
      // out-of-range airports with a single ["get", "inRange"] lookup. When
      // no anchor is supplied (`reachable` null) every airport is in range —
      // that's the "no fleet here" case where dimming makes no sense.
      const inRange = reachable == null || reachable.has(a.icao) ? 1 : 0;
      return {
        type: "Feature",
        id: a.icao,
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          icao: a.icao,
          name: a.name,
          size: a.size,
          radius: SIZE_RADIUS[a.size],
          radiusFuelOn: SIZE_RADIUS[a.size] * 1.3,
          haloRadius: SIZE_RADIUS[a.size] + 6,
          tierColor: SIZE_TIER_COLOR[a.size],
          fuelPrice: fuelPrice ?? null,
          inRange,
        },
      };
    }),
  };
}

function buildFlightFC(
  flights: AtlasRecentFlight[],
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: flights.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: {
        type: "LineString",
        coordinates: [
          [f.fromLon, f.fromLat],
          [f.toLon, f.toLat],
        ],
      },
      properties: { id: f.id, ageDays: f.ageDays },
    })),
  };
}

function buildOwnedFC(
  owned: AtlasOwnedAircraft[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: owned.map((a) => ({
      type: "Feature",
      id: a.id,
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        tailNumber: a.tailNumber,
        status: a.status,
        statusColor: STATUS_COLOR[a.status],
      },
    })),
  };
}

function buildJobLineFC(
  jobs: AtlasJob[],
  reachable: ReadonlySet<string> | null,
  colorBy: AtlasJobColorBy,
  fitById: ReadonlyMap<number, AtlasJobFitStatus> | null,
  rateCtx: RateColorContext | null,
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: jobs.map((j) => {
      // A job line is "in range" when its origin airport falls inside the
      // player's range from current position — the player's own aircraft can
      // ferry to origin without commercial repositioning. Out-of-range jobs
      // are still rentable from origin, so we dim rather than hide.
      const inRange =
        reachable == null || reachable.has(j.originIcao) ? 1 : 0;
      return {
        type: "Feature",
        id: j.id,
        geometry: {
          type: "LineString",
          coordinates: [
            [j.originLon, j.originLat],
            [j.destinationLon, j.destinationLat],
          ],
        },
        properties: {
          id: j.id,
          role: j.role,
          // `roleColor` keeps its historical name because three downstream
          // paint expressions read it. Under "fit" or "rate" modes the
          // value isn't role-derived any more — see resolveJobPaintColor.
          roleColor: resolveJobPaintColor(j, colorBy, fitById, rateCtx),
          urgency: j.urgency,
          requiredClass: j.requiredClass,
          distanceNm: j.distanceNm,
          jobType: j.jobType,
          inRange,
        },
      };
    }),
  };
}

function buildJobPointsFC(
  jobs: AtlasJob[],
  reachable: ReadonlySet<string> | null,
  colorBy: AtlasJobColorBy,
  fitById: ReadonlyMap<number, AtlasJobFitStatus> | null,
  rateCtx: RateColorContext | null,
): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const j of jobs) {
    const originInRange =
      reachable == null || reachable.has(j.originIcao) ? 1 : 0;
    const destInRange =
      reachable == null || reachable.has(j.destinationIcao) ? 1 : 0;
    const paint = resolveJobPaintColor(j, colorBy, fitById, rateCtx);
    features.push({
      type: "Feature",
      id: `${j.id}-o`,
      geometry: { type: "Point", coordinates: [j.originLon, j.originLat] },
      properties: {
        id: j.id,
        kind: "origin",
        role: j.role,
        roleColor: paint,
        requiredClass: j.requiredClass,
        distanceNm: j.distanceNm,
        inRange: originInRange,
      },
    });
    features.push({
      type: "Feature",
      id: `${j.id}-d`,
      geometry: {
        type: "Point",
        coordinates: [j.destinationLon, j.destinationLat],
      },
      properties: {
        id: j.id,
        kind: "destination",
        role: j.role,
        roleColor: paint,
        requiredClass: j.requiredClass,
        distanceNm: j.distanceNm,
        // For destinations the dim signal is whether their endpoint sits in
        // range — useful so a job from a reachable origin to an unreachable
        // destination still reads as partly-out-of-reach.
        inRange: destInRange,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildPlayerFC(
  player: AtlasPlayer | null,
): FeatureCollection<Point> {
  if (!player) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "player",
        geometry: {
          type: "Point",
          coordinates: [player.lon, player.lat],
        },
        properties: {},
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Range rings + reachability
// ---------------------------------------------------------------------------

// Mean Earth radius in nautical miles. Matches haversineNm in shared/jobs.
const EARTH_RADIUS_NM = 3440.065;
// Inner-ring shrink factor, matched to RANGE_RESERVE_FACTOR in
// packages/shared/src/aircraft/eligibility.ts. If that constant drifts, the
// "solid ring" on the atlas stops representing actual dispatch eligibility.
const RANGE_RESERVE_FACTOR = 1.15;
// 128 segments is smooth at all current zoom levels and cheap enough that we
// can rebuild on every range change (only happens when the player moves or
// fleet composition shifts). Doesn't yet handle antimeridian wrap — the N.
// Atlantic operating area doesn't need it.
const RANGE_RING_SEGMENTS = 128;

/**
 * Great-circle ring of points at `rangeNm` from (centerLat, centerLon).
 * Returns [lon, lat] pairs ready to drop into a GeoJSON LineString. Exported
 * for unit testing — the assertion is that every returned point is ~rangeNm
 * from the center under haversine.
 */
export function geodesicCircleCoords(
  centerLat: number,
  centerLon: number,
  rangeNm: number,
  segments: number = RANGE_RING_SEGMENTS,
): [number, number][] {
  const lat1 = (centerLat * Math.PI) / 180;
  const lon1 = (centerLon * Math.PI) / 180;
  const d = rangeNm / EARTH_RADIUS_NM;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const brng = (2 * Math.PI * i) / segments;
    const sinLat2 = sinLat1 * cosD + cosLat1 * sinD * Math.cos(brng);
    const lat2 = Math.asin(sinLat2);
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brng) * sinD * cosLat1,
        cosD - sinLat1 * sinLat2,
      );
    coords.push([
      ((lon2 * 180) / Math.PI + 540) % 360 - 180,
      (lat2 * 180) / Math.PI,
    ]);
  }
  return coords;
}

/**
 * Haversine distance between two points in nautical miles. Mirrored from
 * packages/shared/src/jobs/distance.ts; duplicated here so the map component
 * doesn't import server-internal packages.
 */
export function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/**
 * Set of airport ICAOs within the anchor's range. Used to bake `inRange` into
 * the airport / job feature collections so paint expressions can dim with a
 * single `["get", "inRange"]` lookup. Returns null when there's nothing
 * meaningful to compute — caller treats null as "no dimming".
 */
export function computeReachableIcaoSet(
  anchor: AtlasRangeAnchor | null,
  airports: AtlasAirport[],
  dimEnabled: boolean,
): ReadonlySet<string> | null {
  if (!dimEnabled || !anchor || anchor.rangeNm <= 0) return null;
  const out = new Set<string>();
  for (const a of airports) {
    if (
      haversineNm(anchor.lat, anchor.lon, a.lat, a.lon) <= anchor.rangeNm
    ) {
      out.add(a.icao);
    }
  }
  return out;
}

function buildRangeFC(
  anchor: AtlasRangeAnchor | null,
): FeatureCollection<LineString> {
  if (!anchor || anchor.rangeNm <= 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const outer = geodesicCircleCoords(anchor.lat, anchor.lon, anchor.rangeNm);
  const inner = geodesicCircleCoords(
    anchor.lat,
    anchor.lon,
    anchor.rangeNm / RANGE_RESERVE_FACTOR,
  );
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "range-outer",
        geometry: { type: "LineString", coordinates: outer },
        properties: { kind: "outer" },
      },
      {
        type: "Feature",
        id: "range-inner",
        geometry: { type: "LineString", coordinates: inner },
        properties: { kind: "inner" },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Day-night terminator
// ---------------------------------------------------------------------------

// Solar position from a UTC timestamp. Returns the subsolar longitude
// (degrees, -180..180) and declination (radians). Accuracy is ~±1° — fine
// for atmospheric shading; would not be acceptable for navigation.
export function solarPosition(simDateTimeMs: number): {
  declinationRad: number;
  subsolarLon: number;
} {
  const date = new Date(simDateTimeMs);
  // Day of year (1-based) for the declination model.
  const utcYearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((simDateTimeMs - utcYearStart) / 86_400_000);
  // Simple sinusoidal declination — peaks at +23.44° around Jun 21 and
  // -23.44° around Dec 21. Real declination is a touch more complex
  // (analemma) but the visual offset is sub-pixel at atlas zooms.
  const decDeg = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  // Subsolar longitude: 12:00 UTC corresponds to 0° (Greenwich), and the
  // earth rotates 15° per hour to the east, meaning the subsolar point
  // moves westward at 15°/hour relative to a fixed longitude grid. So at
  // 13:00 UTC the subsolar point is at -15°.
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  let subsolarLon = -((utcHours - 12) * 15);
  // Normalize into [-180, 180]. The atlas style wraps fine but the
  // builder's longitude indexing assumes the canonical range.
  subsolarLon = ((subsolarLon + 540) % 360) - 180;
  return {
    declinationRad: (decDeg * Math.PI) / 180,
    subsolarLon,
  };
}

// Latitude where the terminator crosses a given longitude, given the
// solar declination. The math: at sunrise/sunset the solar zenith is
// exactly 90°, so cos(z) = sin(δ)sin(φ) + cos(δ)cos(φ)cos(H) = 0, which
// rearranges to tan(φ) = -cos(H) / tan(δ). Returns null when the formula
// can't produce a meaningful latitude (near-zero declination, i.e. the
// equinoxes, when the terminator is essentially a great circle along a
// meridian and slicing by longitude makes no sense).
function terminatorLatAtLon(
  lonDeg: number,
  subsolarLonDeg: number,
  declinationRad: number,
): number | null {
  if (Math.abs(declinationRad) < 0.5 * (Math.PI / 180)) return null;
  const H = ((lonDeg - subsolarLonDeg) * Math.PI) / 180;
  const lat = Math.atan(-Math.cos(H) / Math.tan(declinationRad));
  return (lat * 180) / Math.PI;
}

// Build a fill polygon covering the night hemisphere. The strategy is to
// sample the terminator latitude at every longitude and close the
// polygon down to the pole that currently sits in night (south pole in
// NH summer, north pole in NH winter). Polar caps fall out naturally:
// the formula returns latitudes pinned near ±90 where the terminator
// asymptotes, and our closure point sits past them. Returns an empty
// collection at equinox when the math degenerates — losing the overlay
// for ~2 days a year is preferable to drawing a malformed polygon.
export function buildTerminatorFC(
  simDateTimeMs: number,
): FeatureCollection<Polygon> {
  const { declinationRad, subsolarLon } = solarPosition(simDateTimeMs);
  if (Math.abs(declinationRad) < 0.5 * (Math.PI / 180)) {
    return { type: "FeatureCollection", features: [] };
  }

  // Sample every 2° of longitude — 180 vertices, smooth at all zoom levels
  // and tiny on the wire. The polygon closes back to the start point
  // implicitly via the [lon, lat] of the loop boundary; we add the closure
  // pair explicitly so MapLibre treats it as a closed ring.
  const top: [number, number][] = [];
  for (let lonDeg = -180; lonDeg <= 180; lonDeg += 2) {
    const lat = terminatorLatAtLon(lonDeg, subsolarLon, declinationRad);
    if (lat == null) {
      // Equinox-guarded above; this is belt-and-braces for floating-point
      // edge cases right at the threshold.
      return { type: "FeatureCollection", features: [] };
    }
    top.push([lonDeg, lat]);
  }

  // Night-side pole: in NH summer (δ > 0), south pole is dark; in NH
  // winter, north pole is dark. Stay at ±85 not ±90 — Mercator projects
  // exact poles to infinity and the polygon would render as a triangle
  // stretching off-screen.
  const nightPoleLat = declinationRad > 0 ? -85 : 85;

  // Walk: terminator (east → west via the top array), then drop down to
  // the night-side pole and trace back along it (west → east), close.
  const ring: [number, number][] = [
    ...top,
    [180, nightPoleLat],
    [-180, nightPoleLat],
    [top[0]![0], top[0]![1]],
  ];

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {},
      },
    ],
  };
}

// Split the tracked-flight great-circle route into a flown segment (origin →
// current pos) and a remaining segment (current pos → destination). If we
// have no live position yet, the whole route renders as "remaining".
function buildTrackedLinesFC(
  flight: AtlasActiveTrackedFlight | null,
  pos: AtlasTrackedPosition | null,
): FeatureCollection<LineString> {
  if (!flight) return { type: "FeatureCollection", features: [] };

  const origin: [number, number] = [flight.originLon, flight.originLat];
  const dest: [number, number] = [flight.destinationLon, flight.destinationLat];

  if (!pos) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "tracked-remain",
          geometry: { type: "LineString", coordinates: [origin, dest] },
          properties: { kind: "remain" },
        },
      ],
    };
  }

  const here: [number, number] = [pos.lon, pos.lat];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "tracked-flown",
        geometry: { type: "LineString", coordinates: [origin, here] },
        properties: { kind: "flown" },
      },
      {
        type: "Feature",
        id: "tracked-remain",
        geometry: { type: "LineString", coordinates: [here, dest] },
        properties: { kind: "remain" },
      },
    ],
  };
}

function buildTrackedPointsFC(
  flight: AtlasActiveTrackedFlight | null,
): FeatureCollection<Point> {
  if (!flight) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "tracked-origin",
        geometry: {
          type: "Point",
          coordinates: [flight.originLon, flight.originLat],
        },
        properties: { kind: "origin", icao: flight.originIcao },
      },
      {
        type: "Feature",
        id: "tracked-dest",
        geometry: {
          type: "Point",
          coordinates: [flight.destinationLon, flight.destinationLat],
        },
        properties: { kind: "destination", icao: flight.destinationIcao },
      },
    ],
  };
}

function buildTrackedAircraftFC(
  pos: AtlasTrackedPosition | null,
): FeatureCollection<Point> {
  if (!pos) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "tracked-aircraft",
        geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
        properties: {
          heading: pos.headingDeg,
          onGround: pos.onGround,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Bounds: fit player + owned + airports that appear in any recent flight.
// ---------------------------------------------------------------------------

function computeBounds(data: AtlasData): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds();
  let any = false;

  if (data.player) {
    bounds.extend([data.player.lon, data.player.lat]);
    any = true;
  }
  for (const a of data.ownedAircraft) {
    bounds.extend([a.lon, a.lat]);
    any = true;
  }
  const operationalIcaos = new Set<string>();
  for (const f of data.recentFlights) {
    operationalIcaos.add(f.fromIcao);
    operationalIcaos.add(f.toIcao);
  }
  for (const a of data.airports) {
    if (operationalIcaos.has(a.icao)) {
      bounds.extend([a.lon, a.lat]);
      any = true;
    }
  }

  if (!any) {
    for (const a of data.airports) {
      bounds.extend([a.lon, a.lat]);
      any = true;
    }
  }
  return any ? bounds : null;
}

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------

interface ViewportInfo {
  zoom: number;
}

// Approximate scale at the current map center in nautical miles per 100 px.
function metersToNm(m: number): number {
  return m / 1852;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AtlasMap({
  data,
  visibleLayers,
  jobFilters,
  onFeatureClick,
  onFilteredJobsChange,
  fuelOverlayType = "jet-a",
  trackedPosition = null,
  rangeAnchor = null,
  focusPoint = null,
  jobColorBy = "role",
  jobFitById,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialFitDone = useRef(false);

  // Live refs feed the once-attached hover handlers without re-registering.
  // Keeping the handler stable matters because maplibre's `on(layerId, fn)`
  // doesn't deduplicate by reference — repeated registrations would leak.
  const jobByIdRef = useRef<Map<number, AtlasJob>>(new Map());
  const hoverCruiseRef = useRef<number | null>(null);
  // Popup instance for job hover labels; created once at map load.
  const jobPopupRef = useRef<maplibregl.Popup | null>(null);

  // Viewport HUD state
  const [viewport, setViewport] = useState<ViewportInfo | null>(null);
  const [scaleNm, setScaleNm] = useState<number>(0);

  const updateHud = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setViewport({ zoom: map.getZoom() });
    // Compute nm-per-100px at the center latitude.
    const center = map.getCenter();
    const a = map.project(center);
    const bp = map.project([
      center.lng + 0.5 * Math.cos((center.lat * Math.PI) / 180),
      center.lat,
    ]);
    const pxDist = Math.hypot(bp.x - a.x, bp.y - a.y);
    if (pxDist > 0) {
      const meters =
        0.5 *
        (Math.PI / 180) *
        6371000 *
        Math.cos((center.lat * Math.PI) / 180);
      const metersPerPx = meters / pxDist;
      setScaleNm(metersToNm(metersPerPx * 100));
    }
  }, []);

  // Mount / unmount the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    getMapStyle()
      .then((style) => {
        if (cancelled || !containerRef.current) return;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style,
          interactive: true,
          attributionControl: { compact: true },
          fadeDuration: 100,
          center: [-65, 45],
          zoom: 4,
          maxZoom: 11,
          minZoom: 2,
        });

        // Pin the view to a top-down ops console — no rotation, no pitch.
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();

        mapRef.current = map;

        map.on("load", () => {
          if (cancelled) return;
          registerImages(map);
          installSources(map);
          installLayers(map);
          attachClickHandlers(map, (ref) => onFeatureClick?.(ref));
          attachHoverCursors(map, jobByIdRef, hoverCruiseRef, jobPopupRef);
          updateHud();
          setReady(true);
        });

        map.on("move", updateHud);

        map.on("error", () => {
          if (cancelled) return;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setError("Map unavailable");
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      initialFitDone.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the job-by-id lookup and cruise speed in refs so hover handlers see
  // the current data without being re-attached on every render.
  useEffect(() => {
    const m = new Map<number, AtlasJob>();
    for (const j of data.jobs) m.set(j.id, j);
    jobByIdRef.current = m;
  }, [data.jobs]);
  useEffect(() => {
    hoverCruiseRef.current = rangeAnchor?.cruiseSpeedKts ?? null;
  }, [rangeAnchor]);

  // Rate-color gradient bounds. Recomputed only when jobs change; cheap.
  const rateCtx = useMemo(() => computeJobRateRange(data.jobs), [data.jobs]);

  // Reachable-airport set is recomputed whenever the anchor, dim toggle, or
  // airport set changes. Null = no dim, every feature stays at full opacity.
  const reachableSet = useMemo(
    () =>
      computeReachableIcaoSet(
        rangeAnchor,
        data.airports,
        visibleLayers.reachabilityDim,
      ),
    [rangeAnchor, data.airports, visibleLayers.reachabilityDim],
  );

  // Push data into sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(
      map,
      SRC_AIRPORTS,
      buildAirportFC(data.airports, fuelOverlayType, reachableSet),
    );
    setSourceData(map, SRC_FLIGHTS, buildFlightFC(data.recentFlights));
    setSourceData(map, SRC_OWNED, buildOwnedFC(data.ownedAircraft));
    setSourceData(
      map,
      SRC_JOBS_LINES,
      buildJobLineFC(
        data.jobs,
        reachableSet,
        jobColorBy,
        jobFitById ?? null,
        rateCtx,
      ),
    );
    setSourceData(
      map,
      SRC_JOBS_POINTS,
      buildJobPointsFC(
        data.jobs,
        reachableSet,
        jobColorBy,
        jobFitById ?? null,
        rateCtx,
      ),
    );
    setSourceData(map, SRC_PLAYER, buildPlayerFC(data.player));
    setSourceData(map, SRC_RANGE, buildRangeFC(rangeAnchor));
    // Terminator is driven by sim time, which lives on the player record.
    // No player → no terminator (the rare fresh-career / pre-init case).
    setSourceData(
      map,
      SRC_TERMINATOR,
      data.player
        ? buildTerminatorFC(data.player.simDateTime)
        : { type: "FeatureCollection", features: [] },
    );
    // Origin/destination dots track the atlas dataset (they only change when
    // the active flight starts or ends), so they live with the main `data`
    // effect. The route lines + moving aircraft are handled separately below
    // so a 1Hz position update doesn't rebuild every other source.
    setSourceData(
      map,
      SRC_TRACKED_POINTS,
      buildTrackedPointsFC(data.activeTrackedFlight),
    );

    if (!initialFitDone.current) {
      const bounds = computeBounds(data);
      if (bounds && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, animate: false, maxZoom: 7.5 });
      }
      initialFitDone.current = true;
      updateHud();
    }
  }, [
    data,
    ready,
    updateHud,
    fuelOverlayType,
    reachableSet,
    rangeAnchor,
    jobColorBy,
    jobFitById,
    rateCtx,
  ]);

  // Fly to a focus point when the parent requests it (search-box select,
  // etc.). The `key` field lets the same coordinates retrigger movement
  // when re-selected — react would otherwise skip the effect because the
  // shallow object identity hasn't changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusPoint) return;
    map.flyTo({
      center: [focusPoint.lon, focusPoint.lat],
      zoom: focusPoint.zoom ?? Math.max(map.getZoom(), 6.5),
      duration: 700,
      essential: true,
    });
  }, [focusPoint, ready]);

  // Live tracked-flight sources. Split out so the 1Hz position update only
  // diffs the two sources that actually move (route split + aircraft marker),
  // rather than rebuilding the entire atlas feature set every second.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(
      map,
      SRC_TRACKED_LINES,
      buildTrackedLinesFC(data.activeTrackedFlight, trackedPosition),
    );
    setSourceData(
      map,
      SRC_TRACKED_AIRCRAFT,
      buildTrackedAircraftFC(trackedPosition),
    );
  }, [data.activeTrackedFlight, trackedPosition, ready]);

  // Toggle layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const set = (layerId: string, visible: boolean) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(
        layerId,
        "visibility",
        visible ? "visible" : "none",
      );
    };

    set(L_AIRPORT_HALO, visibleLayers.airports);
    set(L_AIRPORT_CIRCLE, visibleLayers.airports);
    set(L_AIRPORT_LABEL, visibleLayers.airports);
    set(L_FLIGHT_GLOW, visibleLayers.recentFlights);
    set(L_FLIGHT_LINE, visibleLayers.recentFlights);
    set(L_OWNED_BG, visibleLayers.ownedAircraft);
    set(L_OWNED_ICON, visibleLayers.ownedAircraft);
    set(L_OWNED_LABEL, visibleLayers.ownedAircraft);
    set(L_JOB_LINE_HIT, visibleLayers.jobs);
    set(L_JOB_LINE, visibleLayers.jobs);
    set(L_JOB_ARROW, visibleLayers.jobs);
    set(L_JOB_ORIGIN, visibleLayers.jobs);
    set(L_JOB_DEST, visibleLayers.jobs);
    set(L_PLAYER_RING, visibleLayers.playerLocation);
    set(L_PLAYER_PULSE_A, visibleLayers.playerLocation);
    set(L_PLAYER_PULSE_B, visibleLayers.playerLocation);
    set(L_PLAYER_DOT, visibleLayers.playerLocation);
    // Tracked flight: the row only matters when an active tracked flight is
    // present, but we always honor the toggle so the player can hide it.
    const trackedOn =
      visibleLayers.trackedFlight && data.activeTrackedFlight != null;
    set(L_TRACKED_REMAIN, trackedOn);
    set(L_TRACKED_FLOWN_GLOW, trackedOn);
    set(L_TRACKED_FLOWN, trackedOn);
    set(L_TRACKED_ORIGIN, trackedOn);
    set(L_TRACKED_DEST, trackedOn);
    set(L_TRACKED_AIRCRAFT_HALO, trackedOn);
    set(L_TRACKED_AIRCRAFT_BG, trackedOn);
    set(L_TRACKED_AIRCRAFT_ICON, trackedOn);
    // Range rings — only meaningful when an anchor exists. The toggle still
    // applies (a player can hide them even when an anchor is available).
    const ringsOn = visibleLayers.rangeRings && rangeAnchor != null;
    set(L_RANGE_OUTER, ringsOn);
    set(L_RANGE_INNER, ringsOn);
    set(L_TERMINATOR, visibleLayers.nightShade);

    if (map.getLayer(L_AIRPORT_CIRCLE)) {
      const colorExpr = visibleLayers.fuelPrices
        ? buildFuelPriceColorExpr(data.airports, fuelOverlayType)
        : ["get", "tierColor"];
      map.setPaintProperty(L_AIRPORT_CIRCLE, "circle-color", colorExpr as never);
      map.setPaintProperty(
        L_AIRPORT_CIRCLE,
        "circle-stroke-color",
        visibleLayers.fuelPrices ? "#0a0a0a" : MAP_PALETTE.accent,
      );
      map.setPaintProperty(
        L_AIRPORT_CIRCLE,
        "circle-stroke-opacity",
        visibleLayers.fuelPrices ? 0.4 : 0.9,
      );
      // Bigger circles when the fuel overlay is on so the color is readable.
      map.setPaintProperty(
        L_AIRPORT_CIRCLE,
        "circle-radius",
        [
          "get",
          visibleLayers.fuelPrices ? "radiusFuelOn" : "radius",
        ] as never,
      );
    }
  }, [
    visibleLayers,
    data.airports,
    data.activeTrackedFlight,
    ready,
    fuelOverlayType,
    rangeAnchor,
  ]);

  // ----- Apply job filters via setFilter (no data refetch needed) -----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const filter = buildJobFilter(jobFilters);
    for (const layerId of [
      L_JOB_LINE_HIT,
      L_JOB_LINE,
      L_JOB_ARROW,
      L_JOB_ORIGIN,
      L_JOB_DEST,
    ]) {
      if (map.getLayer(layerId)) {
        // The filter expression is hand-built; the FilterSpecification union
        // is too narrow for that style, so we cast through `unknown`.
        map.setFilter(layerId, (filter ?? null) as never);
      }
    }

    // Report visible count back to the panel.
    if (onFilteredJobsChange) {
      const visible = data.jobs.filter((j) => jobMatchesFilter(j, jobFilters));
      onFilteredJobsChange(visible.length);
    }
  }, [jobFilters, data.jobs, ready, onFilteredJobsChange]);

  // ----- HUD actions -----

  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const fitBounds = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = computeBounds(data);
    if (b && !b.isEmpty()) {
      map.fitBounds(b, { padding: 80, animate: true, maxZoom: 7.5 });
    }
  };

  // ----- Render -----

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: MAP_PALETTE.background }}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {/* ---------- HUD overlays ---------- */}
      {ready && viewport && (
        <>
          {/* Top-left: a single compact ops badge with current zoom. */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-sm border border-amber-deep/40 bg-ink-900/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-callsign backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow shadow-[0_0_5px_rgba(212,165,116,0.6)]" />
            <span className="text-amber-glow">OPS · N. ATLANTIC</span>
            <span className="text-muted-faint">·</span>
            <span className="tabular-nums text-muted">
              Z{viewport.zoom.toFixed(1)}
            </span>
          </div>

          {/* Top-right: single-row feature tally. The player marker on the map
              is enough — no separate HOST pill. */}
          <div className="pointer-events-none absolute right-4 top-4 z-10 flex items-center divide-x divide-ink-600/70 rounded-sm border border-ink-600/70 bg-ink-900/70 font-mono text-[10px] uppercase tracking-callsign backdrop-blur-sm">
            <TallyCell label="STN" value={data.airports.length} />
            <TallyCell label="FLT" value={data.ownedAircraft.length} />
            <TallyCell label="REC" value={data.recentFlights.length} />
            <TallyCell label="JOB" value={data.jobs.length} />
          </div>

          {/* Bottom-left: scale only — the compass is dead weight on a
              non-rotating map. */}
          <div className="pointer-events-none absolute bottom-4 left-4 z-10">
            <ScaleBar nm={scaleNm} />
          </div>

          {/* Bottom-right: zoom cluster, lifted above the attribution. */}
          <div className="absolute bottom-10 right-4 z-10 flex flex-col gap-1">
            <ZoomButton title="Zoom in" onClick={zoomIn} symbol="+" />
            <ZoomButton title="Zoom out" onClick={zoomOut} symbol="−" />
            <ZoomButton title="Fit operational area" onClick={fitBounds} symbol="◇" />
          </div>
        </>
      )}

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="font-mono text-micro uppercase tracking-callsign text-amber-glow">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-glow shadow-[0_0_6px_rgba(212,165,116,0.7)] align-middle" />
            Acquiring tile mosaic…
          </span>
          <span className="font-mono text-[10px] uppercase tracking-callsign text-muted-faint">
            atlas / north atlantic sector
          </span>
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-micro uppercase tracking-callsign text-urgency-critical">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small HUD pieces
// ---------------------------------------------------------------------------

function TallyCell({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5 px-2.5 py-1">
      <span className="text-muted-faint">{label}</span>
      <span className="tabular-nums text-text">
        {String(value).padStart(2, "0")}
      </span>
    </span>
  );
}

function ScaleBar({ nm }: { nm: number }) {
  // Round to a clean tactical number.
  const target = roundScale(nm);
  const ratio = target / nm; // how many nm fit in 100px → bar width = 100 * ratio
  const width = Math.max(40, Math.min(160, 100 * ratio));
  return (
    <div className="flex flex-col items-start gap-1 rounded-sm border border-ink-600/80 bg-ink-900/70 px-2.5 py-1.5 backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-4 text-muted-faint">
        <span>scale</span>
        <span className="tabular-nums text-text">{target} nm</span>
      </div>
      <div className="relative h-1.5" style={{ width }}>
        <span className="absolute inset-y-0 left-0 w-px bg-amber-glow" />
        <span className="absolute inset-y-0 right-0 w-px bg-amber-glow" />
        <span className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-amber-deep" />
      </div>
    </div>
  );
}

function roundScale(nm: number): number {
  if (nm <= 0) return 1;
  const buckets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const b of buckets) if (nm <= b) return b;
  return 2000;
}

function ZoomButton({
  symbol,
  onClick,
  title,
}: {
  symbol: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-sm border border-ink-600/80 bg-ink-900/80 font-mono text-[14px] text-amber-glow backdrop-blur-sm transition-colors hover:border-amber-deep hover:bg-amber-glow/[0.08] hover:text-amber-warm"
    >
      {symbol}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sources / layers
// ---------------------------------------------------------------------------

const PLANE_IMAGE_ID = "atlas-plane";

function emptyFc<T extends FeatureCollection>(): T {
  return { type: "FeatureCollection", features: [] } as unknown as T;
}

// Register a plane silhouette as an SDF image so it can be tinted via
// `icon-color`. We rely on a canvas because OpenFreeMap's Noto Sans glyph
// set doesn't include the ✈ codepoint (U+2708).
function registerImages(map: MlMap) {
  if (map.hasImage(PLANE_IMAGE_ID)) return;
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Plane pointing up. Coordinates designed in a 40×40 box with 4px padding.
  ctx.fillStyle = "#ffffff"; // SDF treats alpha as the field; color is set by icon-color
  ctx.beginPath();
  // Fuselage tip
  ctx.moveTo(20, 4);
  // Right wing tip → wing root
  ctx.lineTo(36, 24);
  ctx.lineTo(23, 22);
  // Right tail
  ctx.lineTo(23, 30);
  ctx.lineTo(30, 33);
  ctx.lineTo(20, 31);
  // Left tail (mirror)
  ctx.lineTo(10, 33);
  ctx.lineTo(17, 30);
  ctx.lineTo(17, 22);
  // Left wing root → tip
  ctx.lineTo(4, 24);
  ctx.closePath();
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, size, size);
  map.addImage(
    PLANE_IMAGE_ID,
    {
      width: size,
      height: size,
      data: new Uint8Array(imageData.data.buffer),
    },
    { sdf: true },
  );
}

function installSources(map: MlMap) {
  map.addSource(SRC_AIRPORTS, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_FLIGHTS, {
    type: "geojson",
    data: emptyFc(),
    lineMetrics: true,
  });
  map.addSource(SRC_OWNED, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_JOBS_LINES, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_JOBS_POINTS, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_PLAYER, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_TRACKED_LINES, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_TRACKED_POINTS, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_TRACKED_AIRCRAFT, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_RANGE, { type: "geojson", data: emptyFc() });
  map.addSource(SRC_TERMINATOR, { type: "geojson", data: emptyFc() });
}

function installLayers(map: MlMap) {
  // ---- Day-night terminator ----
  // First layer in the stack so airports / routes / aircraft glyphs all
  // paint on top of the shaded night side. Opacity stays low (0.18) so
  // base map tiles remain legible — this is a context cue, not a primary
  // surface.
  map.addLayer({
    id: L_TERMINATOR,
    type: "fill",
    source: SRC_TERMINATOR,
    paint: {
      "fill-color": "#0b1a2a",
      "fill-opacity": 0.32,
      "fill-outline-color": "#1a2b3d",
    },
  });

  // ---- Flights: glow + dashed line, age controls opacity ----
  map.addLayer({
    id: L_FLIGHT_GLOW,
    type: "line",
    source: SRC_FLIGHTS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MAP_PALETTE.accent,
      "line-width": 5,
      "line-blur": 3,
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["get", "ageDays"],
        0,
        0.18,
        30,
        0.02,
      ],
    },
  });
  map.addLayer({
    id: L_FLIGHT_LINE,
    type: "line",
    source: SRC_FLIGHTS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MAP_PALETTE.accent,
      "line-width": 1.2,
      "line-dasharray": [2, 2],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["get", "ageDays"],
        0,
        0.85,
        30,
        0.1,
      ],
    },
  });

  // ---- Airports: faint halo ring (major only) + circle + ICAO label ----
  // Opacity multiplier used to dim out-of-range features. The `inRange`
  // property is 1 by default (no dim active) and 0 when the feature falls
  // outside the player's range. Composing this against any existing per-
  // feature opacity gives a single multiplicative dim that respects urgency,
  // age, and similar pre-existing modulations.
  const DIM_OPACITY = 0.22;
  const dimExpr = (visibleOpacity: number | unknown[]): unknown => [
    "*",
    visibleOpacity,
    ["case", ["==", ["get", "inRange"], 0], DIM_OPACITY, 1],
  ];

  map.addLayer({
    id: L_AIRPORT_HALO,
    type: "circle",
    source: SRC_AIRPORTS,
    filter: ["==", ["get", "size"], "major"],
    paint: {
      "circle-radius": ["get", "haloRadius"],
      "circle-color": "transparent",
      "circle-stroke-color": MAP_PALETTE.accent,
      "circle-stroke-width": 1,
      "circle-stroke-opacity": dimExpr(0.32) as never,
    },
  });
  map.addLayer({
    id: L_AIRPORT_CIRCLE,
    type: "circle",
    source: SRC_AIRPORTS,
    paint: {
      "circle-radius": ["get", "radius"],
      "circle-color": ["get", "tierColor"],
      "circle-stroke-width": 1,
      "circle-stroke-color": MAP_PALETTE.accent,
      "circle-stroke-opacity": dimExpr(0.9) as never,
      "circle-opacity": dimExpr(0.95) as never,
    },
  });
  map.addLayer({
    id: L_AIRPORT_LABEL,
    type: "symbol",
    source: SRC_AIRPORTS,
    layout: {
      "text-field": ["get", "icao"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-letter-spacing": 0.12,
    },
    paint: {
      "text-color": "#cfcfcf",
      "text-halo-color": MAP_PALETTE.background,
      "text-halo-width": 1.4,
      "text-opacity": dimExpr(1) as never,
    },
  });

  // ---- Range rings ----
  // Painted between airports and owned aircraft so the rings don't bury the
  // status discs but still sit on top of airport circles. Outer ring is the
  // catalog rangeNm (dashed, low-opacity amber); inner ring is rangeNm /
  // RANGE_RESERVE_FACTOR — the eligibility floor — drawn solid and a touch
  // brighter so the player reads it as "no diversion fuel needed."
  map.addLayer({
    id: L_RANGE_OUTER,
    type: "line",
    source: SRC_RANGE,
    filter: ["==", ["get", "kind"], "outer"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MAP_PALETTE.accent,
      "line-width": 1.1,
      "line-dasharray": [4, 4],
      "line-opacity": 0.45,
    },
  });
  map.addLayer({
    id: L_RANGE_INNER,
    type: "line",
    source: SRC_RANGE,
    filter: ["==", ["get", "kind"], "inner"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MAP_PALETTE.accent,
      "line-width": 1.4,
      "line-opacity": 0.7,
    },
  });

  // ---- Owned aircraft: status disc + plane glyph + tail label ----
  // The aircraft sits on the airport's lat/lon, so we offset the badge
  // horizontally in screen pixels so it doesn't stack on top of the airport
  // circle. circle-translate / text-translate apply at render time, so the
  // hit-testing on the click handler stays correct.
  const OWNED_OFFSET_PX: [number, number] = [16, 0];
  map.addLayer({
    id: L_OWNED_BG,
    type: "circle",
    source: SRC_OWNED,
    paint: {
      "circle-radius": 8,
      "circle-color": ["get", "statusColor"],
      "circle-opacity": 0.95,
      "circle-stroke-color": MAP_PALETTE.background,
      "circle-stroke-width": 1.5,
      "circle-translate": OWNED_OFFSET_PX,
    },
  });
  map.addLayer({
    id: L_OWNED_ICON,
    type: "symbol",
    source: SRC_OWNED,
    layout: {
      "icon-image": PLANE_IMAGE_ID,
      "icon-size": 0.34,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": MAP_PALETTE.background,
      "icon-translate": OWNED_OFFSET_PX,
    },
  });
  map.addLayer({
    id: L_OWNED_LABEL,
    type: "symbol",
    source: SRC_OWNED,
    layout: {
      "text-field": ["get", "tailNumber"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 9,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-letter-spacing": 0.1,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#e6c69a",
      "text-halo-color": MAP_PALETTE.background,
      "text-halo-width": 1.4,
      "text-translate": OWNED_OFFSET_PX,
    },
  });

  // ---- Jobs: route line + origin/destination dots ----
  // A wide invisible "hit" line so clicks/hovers register easily on thin
  // lines, then the visible line on top with role color and per-feature dash.
  map.addLayer({
    id: L_JOB_LINE_HIT,
    type: "line",
    source: SRC_JOBS_LINES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#000000",
      "line-opacity": 0.001,
      "line-width": 14,
    },
  });
  // Single job line layer. Urgency is encoded via line-width and opacity so
  // we don't need a data-driven dasharray expression (which is finicky in
  // MapLibre). Critical/urgent → wider + more opaque; flexible → thinner +
  // dimmer. Role color carries the doctrine signal.
  map.addLayer({
    id: L_JOB_LINE,
    type: "line",
    source: SRC_JOBS_LINES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "roleColor"],
      // Ferries get a longer dash pattern so they're visually distinct from
      // standard work even before the player notices the color shift.
      "line-dasharray": [
        "match",
        ["get", "jobType"],
        "ferry",
        ["literal", [5, 3]],
        ["literal", [3, 2]],
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        2.8,
        urgencyMatchExpr("mapWidth", URGENCY_FALLBACK_WIDTH) as never,
      ],
      "line-opacity": dimExpr([
        "case",
        ["boolean", ["feature-state", "hover"], false],
        1,
        urgencyMatchExpr("mapOpacity", URGENCY_FALLBACK_OPACITY),
      ]) as never,
    },
  });
  // Direction arrow. A single ▶ glyph sits at the midpoint of each job
  // line, auto-rotated along the segment so the player can read flight
  // direction at a glance instead of having to decode "filled dot = origin,
  // hollow ring = destination." `text-keep-upright: false` is critical:
  // without it, MapLibre flips the glyph for any line whose tangent points
  // leftward, which would make the arrow point at the origin for half the
  // board. Urgency drives size + opacity the same way it drives the line so
  // the arrow doesn't visually outweigh a low-priority job.
  //
  // The arrow does NOT participate in hover state — feature-state on symbol
  // layer text properties has been historically uneven across MapLibre
  // versions, and the hover affordance lives perfectly well on the line
  // beneath the arrow. Keeping the expression simple here means there's
  // nothing to silently fail at runtime.
  map.addLayer({
    id: L_JOB_ARROW,
    type: "symbol",
    source: SRC_JOBS_LINES,
    layout: {
      "symbol-placement": "line-center",
      "text-field": "▶",
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "match",
        ["get", "urgency"],
        "critical",
        14,
        "urgent",
        13,
        "standard",
        12,
        "flexible",
        11,
        12,
      ],
      "text-rotation-alignment": "map",
      "text-keep-upright": false,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      // Lift the glyph half an em above the line so it doesn't sit
      // directly on the dashes, where it can read as a marker instead of
      // an arrow. Negative Y in MapLibre's text-offset is "up".
      "text-offset": [0, -0.6],
    },
    paint: {
      "text-color": ["get", "roleColor"],
      "text-halo-color": MAP_PALETTE.background,
      "text-halo-width": 1.5,
      "text-halo-blur": 0.5,
      "text-opacity": dimExpr([
        "match",
        ["get", "urgency"],
        "critical",
        0.95,
        "urgent",
        0.9,
        "standard",
        0.75,
        "flexible",
        0.55,
        0.75,
      ]) as never,
    },
  });
  map.addLayer({
    id: L_JOB_ORIGIN,
    type: "circle",
    source: SRC_JOBS_POINTS,
    filter: ["==", ["get", "kind"], "origin"],
    paint: {
      "circle-radius": 3.5,
      "circle-color": ["get", "roleColor"],
      "circle-stroke-color": MAP_PALETTE.background,
      "circle-stroke-width": 1.4,
      "circle-opacity": dimExpr(0.9) as never,
    },
  });
  map.addLayer({
    id: L_JOB_DEST,
    type: "circle",
    source: SRC_JOBS_POINTS,
    filter: ["==", ["get", "kind"], "destination"],
    paint: {
      "circle-radius": 3,
      "circle-color": "transparent",
      "circle-stroke-color": ["get", "roleColor"],
      "circle-stroke-width": 1.4,
      // Stroke opacity (not fill) so the hollow-ring read survives the dim.
      "circle-stroke-opacity": dimExpr(1) as never,
    },
  });

  // ---- Player: static ring + two staggered radar pulses + solid dot ----
  map.addLayer({
    id: L_PLAYER_RING,
    type: "circle",
    source: SRC_PLAYER,
    paint: {
      "circle-radius": 11,
      "circle-color": "transparent",
      "circle-stroke-color": PLAYER_GREEN,
      "circle-stroke-width": 1,
      "circle-stroke-opacity": 0.5,
    },
  });
  map.addLayer({
    id: L_PLAYER_PULSE_A,
    type: "circle",
    source: SRC_PLAYER,
    paint: {
      "circle-radius": 11,
      "circle-color": "transparent",
      "circle-stroke-color": PLAYER_GREEN,
      "circle-stroke-width": 1.4,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: L_PLAYER_PULSE_B,
    type: "circle",
    source: SRC_PLAYER,
    paint: {
      "circle-radius": 11,
      "circle-color": "transparent",
      "circle-stroke-color": PLAYER_GREEN,
      "circle-stroke-width": 1.4,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: L_PLAYER_DOT,
    type: "circle",
    source: SRC_PLAYER,
    paint: {
      "circle-radius": 4.5,
      "circle-color": PLAYER_GREEN,
      "circle-stroke-color": MAP_PALETTE.background,
      "circle-stroke-width": 1.5,
    },
  });

  // ---- Tracked flight (live MSFS) ----
  // Remaining segment is rendered first so the flown segment + the aircraft
  // marker can sit on top of it. The flown segment is drawn as a soft glow
  // plus a solid line — the same idiom as the recent-flight layer, just
  // brighter to read as "live" rather than "history".
  map.addLayer({
    id: L_TRACKED_REMAIN,
    type: "line",
    source: SRC_TRACKED_LINES,
    filter: ["==", ["get", "kind"], "remain"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TRACKED_GREEN,
      "line-width": 1.4,
      "line-dasharray": [3, 3],
      "line-opacity": 0.55,
    },
  });
  map.addLayer({
    id: L_TRACKED_FLOWN_GLOW,
    type: "line",
    source: SRC_TRACKED_LINES,
    filter: ["==", ["get", "kind"], "flown"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TRACKED_GREEN,
      "line-width": 6,
      "line-blur": 4,
      "line-opacity": 0.25,
    },
  });
  map.addLayer({
    id: L_TRACKED_FLOWN,
    type: "line",
    source: SRC_TRACKED_LINES,
    filter: ["==", ["get", "kind"], "flown"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TRACKED_GREEN,
      "line-width": 2,
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: L_TRACKED_ORIGIN,
    type: "circle",
    source: SRC_TRACKED_POINTS,
    filter: ["==", ["get", "kind"], "origin"],
    paint: {
      "circle-radius": 4,
      "circle-color": TRACKED_GREEN,
      "circle-stroke-color": MAP_PALETTE.background,
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: L_TRACKED_DEST,
    type: "circle",
    source: SRC_TRACKED_POINTS,
    filter: ["==", ["get", "kind"], "destination"],
    paint: {
      "circle-radius": 4.5,
      "circle-color": "transparent",
      "circle-stroke-color": TRACKED_GREEN,
      "circle-stroke-width": 1.6,
      "circle-opacity": 1,
    },
  });
  // Aircraft disc + plane silhouette. The disc is a small dark backplate so
  // the green glyph stays legible over light terrain tiles.
  map.addLayer({
    id: L_TRACKED_AIRCRAFT_HALO,
    type: "circle",
    source: SRC_TRACKED_AIRCRAFT,
    paint: {
      "circle-radius": 14,
      "circle-color": TRACKED_GREEN,
      "circle-opacity": 0.12,
      "circle-stroke-color": TRACKED_GREEN,
      "circle-stroke-width": 1,
      "circle-stroke-opacity": 0.5,
    },
  });
  map.addLayer({
    id: L_TRACKED_AIRCRAFT_BG,
    type: "circle",
    source: SRC_TRACKED_AIRCRAFT,
    paint: {
      "circle-radius": 8,
      "circle-color": MAP_PALETTE.background,
      "circle-opacity": 0.85,
      "circle-stroke-color": TRACKED_GREEN,
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: L_TRACKED_AIRCRAFT_ICON,
    type: "symbol",
    source: SRC_TRACKED_AIRCRAFT,
    layout: {
      "icon-image": PLANE_IMAGE_ID,
      "icon-size": 0.4,
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": TRACKED_GREEN,
    },
  });

  // Animate the two staggered sonar pulses via rAF for smooth motion.
  const PERIOD_MS = 2400;
  let raf = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (!map.getLayer(L_PLAYER_PULSE_A)) return;
    const now = performance.now();
    const phaseA = (now % PERIOD_MS) / PERIOD_MS;
    const phaseB = ((now + PERIOD_MS / 2) % PERIOD_MS) / PERIOD_MS;
    applyPulse(map, L_PLAYER_PULSE_A, phaseA);
    applyPulse(map, L_PLAYER_PULSE_B, phaseB);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  map.once("remove", () => {
    stopped = true;
    cancelAnimationFrame(raf);
  });
}

function applyPulse(map: MlMap, layerId: string, phase: number) {
  // Radius grows from 6 to 32, opacity fades from 0.7 to 0.
  const radius = 6 + phase * 26;
  const opacity = 0.7 * (1 - phase);
  const strokeWidth = 1.6 - phase * 1.0;
  try {
    map.setPaintProperty(layerId, "circle-radius", radius);
    map.setPaintProperty(layerId, "circle-stroke-opacity", opacity);
    map.setPaintProperty(layerId, "circle-stroke-width", strokeWidth);
  } catch {
    // Layer was removed mid-frame.
  }
}

function setSourceData(
  map: MlMap,
  id: string,
  data: FeatureCollection<Point | LineString | Polygon>,
) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data as Feature | FeatureCollection);
}

// Build a MapLibre filter expression from a JobFilters object. Returns null
// when no filtering is needed so we can clear an existing filter.
function buildJobFilter(
  filters: AtlasJobFilters | undefined,
): unknown[] | null {
  if (!filters) return null;
  const clauses: unknown[] = [];
  const { distanceNm, classes } = filters;
  if (distanceNm.min > 0) {
    clauses.push([">=", ["get", "distanceNm"], distanceNm.min]);
  }
  if (distanceNm.max < 10000) {
    clauses.push(["<=", ["get", "distanceNm"], distanceNm.max]);
  }
  const restrictsClass = classes.length > 0 && !classes.includes("any");
  if (restrictsClass) {
    clauses.push([
      "in",
      ["get", "requiredClass"],
      ["literal", classes.filter((c) => c !== "any")],
    ]);
  }
  if (clauses.length === 0) return null;
  return ["all", ...clauses];
}

function jobMatchesFilter(
  job: AtlasJob,
  filters: AtlasJobFilters | undefined,
): boolean {
  if (!filters) return true;
  if (job.distanceNm < filters.distanceNm.min) return false;
  if (job.distanceNm > filters.distanceNm.max) return false;
  if (filters.classes.length > 0 && !filters.classes.includes("any")) {
    if (
      !filters.classes.includes(job.requiredClass as AtlasJobClassFilter)
    ) {
      return false;
    }
  }
  return true;
}

// Build a step expression from the actual price range in the current dataset
// for the chosen fuel type. Cheap = saturated green, median = neutral gray,
// expensive = saturated red. Adapts to the live data so the gradient stretches
// across whatever spread the player is looking at.
function buildFuelPriceColorExpr(
  airports: AtlasAirport[],
  fuelType: "avgas" | "jet-a",
): unknown {
  const range = computeFuelPriceRange(airports, fuelType);
  if (!range) return MAP_PALETTE.accent;

  const { lo, mid, hi } = range;
  return [
    "case",
    ["==", ["get", "fuelPrice"], null],
    FUEL_PRICE_GRADIENT.noData,
    [
      "interpolate",
      ["linear"],
      ["get", "fuelPrice"],
      lo,
      FUEL_PRICE_GRADIENT.cheap,
      mid,
      FUEL_PRICE_GRADIENT.mid,
      hi,
      FUEL_PRICE_GRADIENT.expensive,
    ],
  ];
}

export interface FuelPriceRange {
  lo: number;
  mid: number;
  hi: number;
}

export function computeFuelPriceRange(
  airports: AtlasAirport[],
  fuelType: "avgas" | "jet-a",
): FuelPriceRange | null {
  const prices = airports
    .map((a) => (fuelType === "jet-a" ? a.fuelPriceJetA : a.fuelPriceAvgas))
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const lo = prices[0]!;
  const hi = prices[prices.length - 1]!;
  // Use midpoint between min and max so the neutral midline lands on the
  // numerical middle of the gradient (not skewed by a long tail of cheap or
  // expensive outliers).
  const mid = (lo + hi) / 2;
  return { lo, mid, hi };
}

export function chooseFuelOverlayType(
  ownedAircraft: AtlasOwnedAircraft[],
): "avgas" | "jet-a" {
  // If the player owns any jet-A consumer, color by jet-A. Otherwise avgas.
  // Rental-only players get jet-A as the default since that's where serious
  // operating expense lives.
  if (ownedAircraft.some((a) => a.fuelType === "jet-a")) return "jet-a";
  if (ownedAircraft.some((a) => a.fuelType === "avgas")) return "avgas";
  return "jet-a";
}

// ---------------------------------------------------------------------------
// Job hover popup
// ---------------------------------------------------------------------------

// HTML content for the popup. Pure presentation; takes already-derived
// numbers so the hover handler can keep the lookup logic simple.
function buildJobPopupHtml(job: AtlasJob, cruiseKts: number | null): string {
  const payDollars = Math.round(job.pay / 100).toLocaleString();
  const ratePerNm =
    job.distanceNm > 0 ? (job.pay / 100 / job.distanceNm).toFixed(2) : null;
  const block =
    cruiseKts && cruiseKts > 0 && job.distanceNm > 0
      ? (() => {
          const hours = job.distanceNm / cruiseKts;
          const h = Math.floor(hours);
          const m = Math.round((hours - h) * 60);
          return `${h}h ${String(m).padStart(2, "0")}m`;
        })()
      : null;
  const urgencyAccent =
    job.urgency === "critical"
      ? "color:#e15c4f;"
      : job.urgency === "urgent"
        ? "color:#e6a64a;"
        : "color:#9a9a9a;";
  const idLabel = `#${String(job.id).padStart(5, "0")}`;
  const client = job.clientName ?? "Open Market";

  // We render bare HTML rather than React because maplibre's Popup mounts
  // outside our tree; styling through CSS class names doesn't survive the
  // popup's own theme CSS reset. The values escape via String() coercion
  // (pay/distance are numbers; clientName is the only string and is
  // source-trusted from the ALL_CLIENTS catalog).
  return `
    <div style="
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #d6d4d0;
      background: rgba(10,10,10,0.92);
      border: 1px solid rgba(212,165,116,0.45);
      border-radius: 2px;
      padding: 6px 8px;
      min-width: 180px;
      backdrop-filter: blur(4px);
    ">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <span style="color:#d4a574;">${idLabel}</span>
        <span style="${urgencyAccent}">${job.urgency}</span>
      </div>
      <div style="color:#cfcfcf;font-size:11px;letter-spacing:0.18em;margin-bottom:4px;">
        ${job.originIcao} → ${job.destinationIcao}
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;color:#bcb8b1;">
        <span>${job.distanceNm.toLocaleString()} nm</span>
        <span style="color:#d4a574;">$${payDollars}</span>
      </div>
      ${
        ratePerNm
          ? `<div style="display:flex;justify-content:space-between;gap:8px;color:#bcb8b1;margin-top:2px;">
              <span>$/nm</span>
              <span style="color:#d4a574;">$${ratePerNm}</span>
            </div>`
          : ""
      }
      ${
        block
          ? `<div style="display:flex;justify-content:space-between;gap:8px;color:#7d7d7d;margin-top:2px;">
              <span>est. block</span>
              <span>${block}</span>
            </div>`
          : ""
      }
      <div style="margin-top:4px;color:#7d7d7d;text-transform:none;letter-spacing:0;">
        ${client}
      </div>
    </div>
  `;
}

function attachClickHandlers(
  map: MlMap,
  emit: (ref: AtlasFeatureRef) => void,
) {
  const onClick = (
    layerId: string,
    handler: (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void,
  ) => {
    map.on("click", layerId, (e) => {
      handler(e as MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] });
    });
  };

  onClick(L_AIRPORT_CIRCLE, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const icao = f.properties?.icao as string;
    if (icao) emit({ type: "airport", icao });
  });
  onClick(L_OWNED_BG, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "aircraft", id });
  });
  onClick(L_OWNED_ICON, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "aircraft", id });
  });
  onClick(L_FLIGHT_LINE, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "flight", id });
  });
  onClick(L_FLIGHT_GLOW, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "flight", id });
  });
  onClick(L_JOB_LINE_HIT, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "job", id });
  });
  onClick(L_JOB_LINE, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "job", id });
  });
  onClick(L_JOB_ORIGIN, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "job", id });
  });
  onClick(L_JOB_DEST, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (Number.isFinite(id)) emit({ type: "job", id });
  });
}

function attachHoverCursors(
  map: MlMap,
  jobByIdRef: { current: Map<number, AtlasJob> },
  cruiseRef: { current: number | null },
  popupRef: { current: maplibregl.Popup | null },
) {
  const clickableLayers = [
    L_AIRPORT_CIRCLE,
    L_OWNED_BG,
    L_OWNED_ICON,
    L_FLIGHT_LINE,
    L_FLIGHT_GLOW,
    L_JOB_LINE_HIT,
    L_JOB_LINE,
    L_JOB_ORIGIN,
    L_JOB_DEST,
  ];
  for (const id of clickableLayers) {
    map.on("mouseenter", id, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", id, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // Job hover popup. The Popup is created lazily on first hover and then
  // re-used — addTo / remove is cheap, content rebuild is what does the
  // real work. closeButton off + closeOnClick off because we drive open /
  // close ourselves from mouseenter / mouseleave.
  const ensurePopup = (): maplibregl.Popup => {
    if (popupRef.current) return popupRef.current;
    const p = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: "left",
      // Offset so the tooltip doesn't sit directly under the cursor —
      // would cause flicker as the cursor moves into / out of the popup.
      offset: 14,
      maxWidth: "240px",
      className: "atlas-job-popup",
    });
    popupRef.current = p;
    return p;
  };

  // Job-line hover: emphasis via feature-state (existing) + popup overlay
  // (new). We pick the topmost feature from `e.features` so overlapping
  // routes don't flicker between identities as the cursor jitters.
  let hoveredJobId: number | null = null;
  const showPopup = (id: number, lngLat: maplibregl.LngLat) => {
    const job = jobByIdRef.current.get(id);
    if (!job) return;
    const html = buildJobPopupHtml(job, cruiseRef.current);
    const p = ensurePopup();
    p.setLngLat(lngLat).setHTML(html).addTo(map);
  };
  const hidePopup = () => {
    if (popupRef.current) popupRef.current.remove();
  };

  map.on("mousemove", L_JOB_LINE_HIT, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (!Number.isFinite(id)) return;
    if (id !== hoveredJobId) {
      if (hoveredJobId != null) {
        map.setFeatureState(
          { source: SRC_JOBS_LINES, id: hoveredJobId },
          { hover: false },
        );
      }
      hoveredJobId = id;
      map.setFeatureState(
        { source: SRC_JOBS_LINES, id: hoveredJobId },
        { hover: true },
      );
    }
    // Position-only updates on each mousemove keep the popup glued to the
    // cursor without re-running setHTML — much cheaper than tearing the
    // popup down and rebuilding it per pixel.
    if (popupRef.current && popupRef.current.isOpen()) {
      popupRef.current.setLngLat(e.lngLat);
    } else {
      showPopup(id, e.lngLat);
    }
  });
  map.on("mouseleave", L_JOB_LINE_HIT, () => {
    if (hoveredJobId != null) {
      map.setFeatureState(
        { source: SRC_JOBS_LINES, id: hoveredJobId },
        { hover: false },
      );
      hoveredJobId = null;
    }
    hidePopup();
  });
}
