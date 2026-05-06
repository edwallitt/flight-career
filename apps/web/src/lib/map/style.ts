import type {
  StyleSpecification,
  LayerSpecification,
} from "maplibre-gl";

// Color palette matching the app's "operations-room dispatch terminal" theme.
// Keep in lockstep with tailwind tokens (ink-*, amber-*) where it matters.
//
// Contrast targets:
//   background (deep) → water (cool ink) → land (warm grey) → landAlt (slightly
//   lighter for parks). The ~12-step gap between water and land is what makes
//   coastlines legible without breaking the dark theme.
export const MAP_PALETTE = {
  // Surfaces
  background: "#0a0a0a",
  land: "#222222",
  landAlt: "#272727", // parks / green space, a hair lighter than land
  water: "#0d1622", // cool indigo-grey, clearly cooler than land
  waterDeep: "#070d18",
  // Edges
  border: "#3a3a3a",
  borderStrong: "#4a4a4a",
  coast: "#3a4452", // subtle cool outline at the land/water boundary
  // Linework
  road: "#3a3a3a",
  roadMinor: "#2a2a2a",
  buildingFill: "#2a2a2a",
  airportSurface: "#4a4a4a",
  // Text
  text: "#b0b0b0",
  textMuted: "#7a7a7a",
  textFaint: "#5a5a5a",
  textHalo: "#000000",
  // Brand accent (mirrors tailwind amber-glow / amber-deep)
  accent: "#d4a574",
  accentDeep: "#7a5a32",
} as const;

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

let cachedStylePromise: Promise<StyleSpecification> | null = null;

export function getMapStyle(): Promise<StyleSpecification> {
  if (!cachedStylePromise) {
    cachedStylePromise = loadDarkLibertyStyle().catch((err) => {
      // Reset cache on failure so a later mount can retry.
      cachedStylePromise = null;
      throw err;
    });
  }
  return cachedStylePromise;
}

export async function loadDarkLibertyStyle(): Promise<StyleSpecification> {
  const response = await fetch(STYLE_URL);
  if (!response.ok) {
    throw new Error(`Failed to load map style: ${response.status}`);
  }
  const style = (await response.json()) as StyleSpecification;
  return applyDarkOverrides(style);
}

function idMatches(id: string, ...needles: string[]): boolean {
  const lower = id.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function applyDarkOverrides(style: StyleSpecification): StyleSpecification {
  const next: StyleSpecification = {
    ...style,
    layers: style.layers.map((layer) => overrideLayer(layer)),
  };

  // Force a deep, uniform background even if the source style omits one.
  const hasBackground = next.layers.some((l) => l.type === "background");
  if (!hasBackground) {
    next.layers = [
      {
        id: "background",
        type: "background",
        paint: { "background-color": MAP_PALETTE.background },
      },
      ...next.layers,
    ];
  }

  return next;
}

// Drop only the granular / noisy categories — keep everything else (cities,
// towns, country/state, water bodies). The ops view wants the chart to feel
// rooted in real geography without competing labels at every village.
const DROP_LABEL_PATTERNS = [
  "village",
  "hamlet",
  "suburb",
  "quarter",
  "neighbourhood",
  "neighborhood",
  "poi",
  "housenumber",
  "transit",
  "rail",
  "station",
  "park_label",
  "school",
  "hospital",
  "place_other",
  "place_4", // tilezen/openfreemap sometimes uses zoom-tier suffixes
  "place_5",
  "place_6",
];

function overrideLayer(layer: LayerSpecification): LayerSpecification {
  const id = layer.id;

  if (layer.type === "background") {
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        "background-color": MAP_PALETTE.background,
      },
    };
  }

  // Hillshade/raster layers leak terrain texture — flatten them entirely.
  if (layer.type === "raster") {
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        "raster-opacity": 0,
      },
    };
  }
  if (layer.type === "hillshade") {
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#000000",
        "hillshade-accent-color": "#000000",
        "hillshade-exaggeration": 0,
      },
    };
  }

  if (layer.type === "fill") {
    let color: string = MAP_PALETTE.land;
    let isWater = false;
    if (idMatches(id, "water", "ocean", "sea", "lake", "river_polygon")) {
      color = MAP_PALETTE.water;
      isWater = true;
    } else if (idMatches(id, "building")) {
      color = MAP_PALETTE.buildingFill;
    } else if (
      idMatches(id, "aeroway", "airport", "runway", "apron", "taxiway")
    ) {
      color = MAP_PALETTE.airportSurface;
    } else if (idMatches(id, "park", "wood", "forest", "glacier")) {
      // Allow these to be a hair lighter than land for subtle texture.
      color = MAP_PALETTE.landAlt;
    } else {
      // landuse, landcover, earth, residential, industrial, etc.
      color = MAP_PALETTE.land;
    }
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        "fill-color": color,
        // Water polygons get a clearly visible coastline so the land/sea
        // boundary reads at a glance. Land polygons stay flat so the surface
        // reads as one charted ground tone.
        "fill-outline-color": isWater
          ? MAP_PALETTE.coast
          : idMatches(id, "building")
            ? MAP_PALETTE.border
            : color,
        "fill-opacity": idMatches(id, "building") ? 0.5 : 1,
      },
    };
  }

  if (layer.type === "line") {
    let color: string = MAP_PALETTE.roadMinor;
    let width: number | undefined;
    if (idMatches(id, "water", "river", "stream", "canal", "waterway")) {
      color = MAP_PALETTE.waterDeep;
    } else if (
      idMatches(id, "boundary_country", "admin_country", "country")
    ) {
      color = MAP_PALETTE.borderStrong;
      width = 0.7;
    } else if (idMatches(id, "boundary", "admin", "state")) {
      color = MAP_PALETTE.border;
      width = 0.5;
    } else if (idMatches(id, "aeroway", "runway", "taxiway")) {
      color = MAP_PALETTE.airportSurface;
    } else if (idMatches(id, "motorway", "trunk", "primary")) {
      color = MAP_PALETTE.road;
    } else {
      // Suppress ALL minor / tertiary roads — they were the main source of
      // bright noise in earlier renders.
      return {
        ...layer,
        layout: { ...(layer.layout ?? {}), visibility: "none" },
      } as LayerSpecification;
    }
    const paint: Record<string, unknown> = {
      ...(layer.paint ?? {}),
      "line-color": color,
    };
    if (width != null) paint["line-width"] = width;
    return {
      ...layer,
      paint,
    } as LayerSpecification;
  }

  if (layer.type === "symbol") {
    const lower = id.toLowerCase();
    const dropped = DROP_LABEL_PATTERNS.some((p) => lower.includes(p));
    if (dropped) {
      return {
        ...layer,
        layout: { ...(layer.layout ?? {}), visibility: "none" },
      } as LayerSpecification;
    }
    const isCountry = lower.includes("country");
    const isCapital =
      lower.includes("capital") ||
      lower.includes("state") ||
      lower.includes("province");
    const isCity =
      lower.includes("city") ||
      (lower.includes("place") && !lower.includes("place_t"));
    const isWater =
      lower.includes("ocean") ||
      lower.includes("sea") ||
      lower.includes("marine") ||
      lower.includes("water");

    let color: string = MAP_PALETTE.textMuted;
    if (isCountry || isCapital) color = MAP_PALETTE.text;
    else if (isCity) color = MAP_PALETTE.text;
    else if (isWater) color = MAP_PALETTE.textMuted;
    else color = MAP_PALETTE.textFaint;

    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        "text-color": color,
        "text-halo-color": MAP_PALETTE.textHalo,
        "text-halo-width": 1.4,
        "icon-opacity": 0,
      },
    } as LayerSpecification;
  }

  return layer;
}
