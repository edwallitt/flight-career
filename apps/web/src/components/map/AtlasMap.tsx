import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, LineString } from "geojson";
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
}

export interface AtlasPlayer {
  currentLocationIcao: string;
  currentLocationName: string;
  lat: number;
  lon: number;
  simDateTime: number;
}

export interface AtlasData {
  airports: AtlasAirport[];
  ownedAircraft: AtlasOwnedAircraft[];
  recentFlights: AtlasRecentFlight[];
  jobs: AtlasJob[];
  player: AtlasPlayer | null;
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
}

export type AtlasJobClassFilter = "any" | AtlasJob["requiredClass"];

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
const L_JOB_ORIGIN = "l-job-origin";
const L_JOB_DEST = "l-job-dest";
const L_PLAYER_RING = "l-player-ring";
const L_PLAYER_PULSE_A = "l-player-pulse-a";
const L_PLAYER_PULSE_B = "l-player-pulse-b";
const L_PLAYER_DOT = "l-player-dot";

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

const STATUS_COLOR: Record<AtlasOwnedAircraft["status"], string> = {
  available: MAP_PALETTE.accent,
  in_flight: "#5ec47c",
  in_maintenance: "#e26464",
  committed: "#7d7d7d",
};

// Encode role as line color so the player can scan the chart for the kind of
// work available without reading any text.
const ROLE_COLOR: Record<AtlasJob["role"], string> = {
  bush: "#5ec47c",
  air_taxi: "#d4a574",
  light_jet: "#a78bfa",
  open: "#7d7d7d",
};


const PLAYER_GREEN = "#5ec47c";

// ---------------------------------------------------------------------------
// Feature collection builders
// ---------------------------------------------------------------------------

function buildAirportFC(
  airports: AtlasAirport[],
  fuelType: "avgas" | "jet-a",
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: airports.map((a) => {
      // Use the chosen fuel type. If the airport doesn't sell it, the overlay
      // renders the marker as "no data" gray rather than guessing the other
      // fuel — that's a real signal to the player.
      const fuelPrice =
        fuelType === "jet-a" ? a.fuelPriceJetA : a.fuelPriceAvgas;
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

function buildJobLineFC(jobs: AtlasJob[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: jobs.map((j) => ({
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
        roleColor: ROLE_COLOR[j.role],
        urgency: j.urgency,
        requiredClass: j.requiredClass,
        distanceNm: j.distanceNm,
      },
    })),
  };
}

function buildJobPointsFC(jobs: AtlasJob[]): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const j of jobs) {
    features.push({
      type: "Feature",
      id: `${j.id}-o`,
      geometry: { type: "Point", coordinates: [j.originLon, j.originLat] },
      properties: {
        id: j.id,
        kind: "origin",
        role: j.role,
        roleColor: ROLE_COLOR[j.role],
        requiredClass: j.requiredClass,
        distanceNm: j.distanceNm,
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
        roleColor: ROLE_COLOR[j.role],
        requiredClass: j.requiredClass,
        distanceNm: j.distanceNm,
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
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialFitDone = useRef(false);

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
          attachHoverCursors(map);
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

  // Push data into sources whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(
      map,
      SRC_AIRPORTS,
      buildAirportFC(data.airports, fuelOverlayType),
    );
    setSourceData(map, SRC_FLIGHTS, buildFlightFC(data.recentFlights));
    setSourceData(map, SRC_OWNED, buildOwnedFC(data.ownedAircraft));
    setSourceData(map, SRC_JOBS_LINES, buildJobLineFC(data.jobs));
    setSourceData(map, SRC_JOBS_POINTS, buildJobPointsFC(data.jobs));
    setSourceData(map, SRC_PLAYER, buildPlayerFC(data.player));

    if (!initialFitDone.current) {
      const bounds = computeBounds(data);
      if (bounds && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, animate: false, maxZoom: 7.5 });
      }
      initialFitDone.current = true;
      updateHud();
    }
  }, [data, ready, updateHud]);

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
    set(L_JOB_ORIGIN, visibleLayers.jobs);
    set(L_JOB_DEST, visibleLayers.jobs);
    set(L_PLAYER_RING, visibleLayers.playerLocation);
    set(L_PLAYER_PULSE_A, visibleLayers.playerLocation);
    set(L_PLAYER_PULSE_B, visibleLayers.playerLocation);
    set(L_PLAYER_DOT, visibleLayers.playerLocation);

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
  }, [visibleLayers, data.airports, ready, fuelOverlayType]);

  // ----- Apply job filters via setFilter (no data refetch needed) -----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const filter = buildJobFilter(jobFilters);
    for (const layerId of [
      L_JOB_LINE_HIT,
      L_JOB_LINE,
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
}

function installLayers(map: MlMap) {
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
      "circle-stroke-opacity": 0.32,
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
      "circle-stroke-opacity": 0.9,
      "circle-opacity": 0.95,
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
      "line-width": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        2.8,
        [
          "match",
          ["get", "urgency"],
          "critical",
          1.9,
          "urgent",
          1.7,
          "standard",
          1.4,
          "flexible",
          1.1,
          1.4,
        ],
      ],
      "line-opacity": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        1,
        [
          "match",
          ["get", "urgency"],
          "critical",
          0.9,
          "urgent",
          0.8,
          "standard",
          0.6,
          "flexible",
          0.4,
          0.6,
        ],
      ],
      "line-dasharray": [3, 2],
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
      "circle-opacity": 0.9,
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
      "circle-opacity": 1,
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
  data: FeatureCollection<Point | LineString>,
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
    "#3a3a3a",
    [
      "interpolate",
      ["linear"],
      ["get", "fuelPrice"],
      lo,
      "#5ec47c",
      mid,
      "#cfcfcf",
      hi,
      "#e34d4d",
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

function attachHoverCursors(map: MlMap) {
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

  // Job-line hover emphasis via feature-state. Using the wide hit layer means
  // we don't need pixel-perfect aim on a 1.5px line.
  let hoveredJobId: number | null = null;
  map.on("mousemove", L_JOB_LINE_HIT, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = Number(f.properties?.id);
    if (!Number.isFinite(id) || id === hoveredJobId) return;
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
  });
  map.on("mouseleave", L_JOB_LINE_HIT, () => {
    if (hoveredJobId != null) {
      map.setFeatureState(
        { source: SRC_JOBS_LINES, id: hoveredJobId },
        { hover: false },
      );
      hoveredJobId = null;
    }
  });
}
