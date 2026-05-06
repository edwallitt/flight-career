import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MlMap, LngLatBoundsLike } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { MAP_PALETTE, getMapStyle } from "../../lib/map/style.js";

export type MapMarkerKind = "origin" | "destination" | "current" | "aircraft";

export interface MapAirport {
  icao: string;
  lat: number;
  lon: number;
  label?: string;
  marker?: MapMarkerKind;
}

export interface MapRoute {
  fromIcao: string;
  toIcao: string;
  style?: "solid" | "dashed" | "dotted";
  // `ghost` renders muted gray (used for planned-but-diverted routes); the
  // default `primary` uses the brand accent.
  tone?: "primary" | "ghost";
}

export interface RouteMapProps {
  airports: MapAirport[];
  routes?: MapRoute[];
  height: number;
  className?: string;
  interactive?: boolean;
  paddingPx?: number;
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
}

const ROUTE_SOURCE_PRIMARY = "route-source-primary";
const ROUTE_SOURCE_GHOST = "route-source-ghost";
const ROUTE_LAYER_PRIMARY = "route-line-primary";
const ROUTE_LAYER_GHOST = "route-line-ghost";
const TILE_TIMEOUT_MS = 5000;
const GHOST_COLOR = "#5a5a5a";

function buildMarkerEl(kind: MapMarkerKind, label?: string): HTMLElement {
  // The wrap is a zero-size point at the lat/lon. Children are absolutely
  // positioned relative to it so the dot's center stays exactly on the
  // marker's anchor — anything else shifts the dot off the actual coord.
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = "0";
  wrap.style.height = "0";
  wrap.style.pointerEvents = "none";

  const dot = document.createElement("span");
  dot.style.position = "absolute";
  dot.style.left = "0";
  dot.style.top = "0";
  dot.style.transform = "translate(-50%, -50%)";
  dot.style.borderRadius = "50%";
  dot.style.boxSizing = "border-box";

  switch (kind) {
    case "origin":
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.background = MAP_PALETTE.accent;
      dot.style.border = `1px solid ${MAP_PALETTE.background}`;
      dot.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.6)";
      break;
    case "destination":
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.background = "transparent";
      dot.style.border = `2px solid ${MAP_PALETTE.accent}`;
      dot.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.6)";
      break;
    case "current":
      dot.style.width = "12px";
      dot.style.height = "12px";
      dot.style.background = "#5ec47c";
      dot.style.border = `1px solid ${MAP_PALETTE.background}`;
      dot.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.6), 0 0 6px rgba(94,196,124,0.6)";
      dot.style.animation = "routemap-pulse 1.8s ease-out infinite";
      break;
    case "aircraft": {
      // Lucide Plane icon (from lucide-react sources) rendered as SVG.
      dot.style.width = "16px";
      dot.style.height = "16px";
      dot.style.borderRadius = "0";
      dot.style.background = "transparent";
      dot.style.border = "none";
      dot.style.boxShadow = "none";
      dot.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
          stroke="${MAP_PALETTE.accent}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
        </svg>
      `;
      break;
    }
  }

  wrap.appendChild(dot);

  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    text.style.position = "absolute";
    text.style.left = "12px";
    text.style.top = "0";
    text.style.transform = "translateY(-50%)";
    text.style.fontFamily =
      "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
    text.style.fontSize = "10px";
    text.style.letterSpacing = "0.18em";
    text.style.textTransform = "uppercase";
    text.style.color = "#bdbdbd";
    text.style.textShadow =
      "0 0 2px #0a0a0a, 0 0 2px #0a0a0a, 0 0 4px #0a0a0a";
    text.style.whiteSpace = "nowrap";
    wrap.appendChild(text);
  }

  return wrap;
}

// Great-circle interpolation between two lon/lat points. n samples (inclusive).
function greatCirclePoints(
  from: [number, number],
  to: [number, number],
  n = 64,
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lon1, lat1] = from.map(toRad) as [number, number];
  const [lon2, lat2] = to.map(toRad) as [number, number];

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(a)));

  if (d < 1e-9) return [from, to];

  const points: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    points.push([toDeg(lon), toDeg(lat)]);
  }
  return points;
}

function ensurePulseKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("routemap-pulse-style")) return;
  const el = document.createElement("style");
  el.id = "routemap-pulse-style";
  el.textContent = `
    @keyframes routemap-pulse {
      0%   { box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 0 0 rgba(94,196,124,0.5); }
      70%  { box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 0 8px rgba(94,196,124,0); }
      100% { box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 0 0 rgba(94,196,124,0); }
    }
  `;
  document.head.appendChild(el);
}

function strokeForStyle(style: MapRoute["style"]): number[] | undefined {
  switch (style) {
    case "dashed":
      return [3, 2];
    case "dotted":
      return [0.5, 2];
    case "solid":
    default:
      return undefined;
  }
}

export function RouteMap({
  airports,
  routes = [],
  height,
  className,
  interactive = false,
  paddingPx = 32,
  initialCenter,
  initialZoom,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot inputs used during async setup so we can compare on cleanup.
  useEffect(() => {
    ensurePulseKeyframes();
    if (!containerRef.current) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    setReady(false);
    setError(null);

    getMapStyle()
      .then((style) => {
        if (cancelled || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style,
          interactive,
          attributionControl: false,
          fadeDuration: 0,
          center: initialCenter
            ? [initialCenter.lon, initialCenter.lat]
            : [0, 0],
          zoom: initialZoom ?? 1,
        });

        // Belt-and-suspenders: even with interactive:false, kill every handler.
        if (!interactive) {
          map.scrollZoom.disable();
          map.boxZoom.disable();
          map.dragPan.disable();
          map.dragRotate.disable();
          map.keyboard.disable();
          map.doubleClickZoom.disable();
          map.touchZoomRotate.disable();
          if (containerRef.current) {
            containerRef.current.style.cursor = "default";
          }
        }

        mapRef.current = map;

        timeoutId = setTimeout(() => {
          if (cancelled) return;
          if (!ready) {
            setError("Map unavailable");
          }
        }, TILE_TIMEOUT_MS);

        map.on("load", () => {
          if (cancelled) return;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          renderOverlays(map, airports, routes);
          fitToContent(map, airports, paddingPx, initialCenter, initialZoom);
          // Add markers after the map paints its first frame so they sit on top.
          markersRef.current = addMarkers(map, airports);
          setReady(true);
        });

        map.on("error", (e) => {
          // Tile errors are common when offline; show a polite fallback.
          // We don't tear down the map — partial tiles still look okay.
          if (cancelled) return;
          if (e.error?.message) {
            // Don't override a hard timeout error.
            setError((prev) => prev ?? "Map unavailable");
          }
        });
      })
      .catch(() => {
        if (cancelled) return;
        setError("Map unavailable");
      });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Re-init when the geometry changes. JSON.stringify keeps the deps shallow
    // while still reacting to new airports/routes.
    JSON.stringify(airports),
    JSON.stringify(routes),
    interactive,
    paddingPx,
    initialCenter?.lat,
    initialCenter?.lon,
    initialZoom,
  ]);

  return (
    <div
      className={[
        "relative overflow-hidden rounded-sm border border-ink-600",
        className ?? "",
      ].join(" ")}
      style={{ height, background: MAP_PALETTE.background }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          opacity: ready ? 1 : 0,
          transition: "opacity 150ms ease-out",
        }}
      />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
          loading map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-micro uppercase tracking-callsign text-muted-dim">
          {error}
        </div>
      )}
    </div>
  );
}

function fitToContent(
  map: MlMap,
  airports: MapAirport[],
  padding: number,
  initialCenter?: { lat: number; lon: number },
  initialZoom?: number,
) {
  if (initialCenter && initialZoom != null) {
    map.jumpTo({ center: [initialCenter.lon, initialCenter.lat], zoom: initialZoom });
    return;
  }
  if (airports.length === 0) return;
  if (airports.length === 1) {
    const a = airports[0]!;
    map.jumpTo({ center: [a.lon, a.lat], zoom: 5 });
    return;
  }
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const a of airports) {
    if (a.lon < minLon) minLon = a.lon;
    if (a.lon > maxLon) maxLon = a.lon;
    if (a.lat < minLat) minLat = a.lat;
    if (a.lat > maxLat) maxLat = a.lat;
  }
  const bounds: LngLatBoundsLike = [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
  map.fitBounds(bounds, { padding, animate: false, maxZoom: 9 });
}

function addMarkers(map: MlMap, airports: MapAirport[]): maplibregl.Marker[] {
  return airports.map((a) => {
    const kind: MapMarkerKind = a.marker ?? "destination";
    const el = buildMarkerEl(kind, a.label ?? a.icao);
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([a.lon, a.lat])
      .addTo(map);
    return marker;
  });
}

function renderOverlays(
  map: MlMap,
  airports: MapAirport[],
  routes: MapRoute[],
) {
  const byIcao = new Map(airports.map((a) => [a.icao, a]));

  const primaryFeatures: Feature<LineString>[] = [];
  const ghostFeatures: Feature<LineString>[] = [];
  for (const r of routes) {
    const from = byIcao.get(r.fromIcao);
    const to = byIcao.get(r.toIcao);
    if (!from || !to) continue;
    const coords = greatCirclePoints([from.lon, from.lat], [to.lon, to.lat]);
    const feat: Feature<LineString> = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { style: r.style ?? "solid" },
    };
    if (r.tone === "ghost") ghostFeatures.push(feat);
    else primaryFeatures.push(feat);
  }

  upsertRouteLayer(
    map,
    ROUTE_SOURCE_PRIMARY,
    ROUTE_LAYER_PRIMARY,
    {
      type: "FeatureCollection",
      features: primaryFeatures,
    },
    {
      color: MAP_PALETTE.accent,
      width: 1.6,
      opacity: 0.9,
      dash: strokeForStyle(routes.find((r) => r.tone !== "ghost")?.style ?? "solid"),
    },
  );

  upsertRouteLayer(
    map,
    ROUTE_SOURCE_GHOST,
    ROUTE_LAYER_GHOST,
    {
      type: "FeatureCollection",
      features: ghostFeatures,
    },
    {
      color: GHOST_COLOR,
      width: 1.2,
      opacity: 0.55,
      dash: [3, 3],
    },
    /* below */ ROUTE_LAYER_PRIMARY,
  );
}

function upsertRouteLayer(
  map: MlMap,
  sourceId: string,
  layerId: string,
  data: FeatureCollection<LineString>,
  style: { color: string; width: number; opacity: number; dash?: number[] },
  beforeLayerId?: string,
) {
  if (map.getSource(sourceId)) {
    (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data);
    return;
  }
  map.addSource(sourceId, { type: "geojson", data });
  const paint: Record<string, unknown> = {
    "line-color": style.color,
    "line-width": style.width,
    "line-opacity": style.opacity,
  };
  if (style.dash) paint["line-dasharray"] = style.dash;
  map.addLayer(
    {
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: paint as never,
    },
    beforeLayerId && map.getLayer(beforeLayerId) ? beforeLayerId : undefined,
  );
}
