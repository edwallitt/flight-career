import type { AircraftClass, Urgency, WeatherSensitivity } from "../clients/types.js";
import { generateTailNumber } from "../marketplace/generator.js";
import { haversineNm } from "./distance.js";

export type FerrySourceType = "owner" | "dealer" | "operator";

export interface FerryAirportLite {
  icao: string;
  size: "major" | "regional" | "small" | "remote";
  lat: number;
  lon: number;
  hasPavedRunway: boolean;
  hasMaintenance: boolean;
}

export interface FerryAircraftType {
  id: string;
  class: AircraftClass;
  cruiseSpeedKts: number;
  rangeNm: number;
  basePurchasePriceCents: number;
}

export interface FerryGenerationContext {
  airports: FerryAirportLite[];
  aircraftTypes: FerryAircraftType[];
  rng: () => number;
  simNow: number;
}

export interface GeneratedFerry {
  jobType: "ferry";
  ferryAircraftTypeId: string;
  ferryAircraftTail: string;
  ferrySource: FerrySourceType;
  ferryOwnerName: string;
  clientName: string;
  originIcao: string;
  destinationIcao: string;
  distanceNm: number;
  minClass: AircraftClass;
  payCents: number;
  payloadLbs: number;
  paxCount: number | null;
  scheduleEarliest: number;
  scheduleLatest: number;
  generatedAt: number;
  urgency: Urgency;
  weatherSensitivity: WeatherSensitivity;
  description: string;
}

const HOUR_MS = 60 * 60 * 1000;

// Tunable: split of ferry source types.
const SOURCE_WEIGHTS: { value: FerrySourceType; weight: number }[] = [
  { value: "owner", weight: 40 },
  { value: "dealer", weight: 25 },
  { value: "operator", weight: 35 },
];

// Tunable: aircraft class distribution within ferries.
const FERRY_CLASS_WEIGHTS: { value: AircraftClass; weight: number }[] = [
  { value: "SEP", weight: 35 },
  { value: "MEP", weight: 25 },
  { value: "SET", weight: 25 },
  { value: "JET", weight: 15 },
];

// Tunable: pay scaling. Base flat fee + per-nm rate, in dollars.
export const FERRY_PAY = {
  SEP: { base: 150, perNm: 0.8 },
  MEP: { base: 350, perNm: 1.5 },
  SET: { base: 800, perNm: 3.5 },
  JET: { base: 2000, perNm: 8.0 },
} as const;

// Source × class affinity. Owners tend to fly piston/turbine singles; dealers
// span everything; operators concentrate on charter aircraft (SET/JET).
const SOURCE_CLASS_BIAS: Record<FerrySourceType, Record<AircraftClass, number>> = {
  owner: { SEP: 1.6, MEP: 1.3, SET: 0.8, JET: 0.3 },
  dealer: { SEP: 1.0, MEP: 1.0, SET: 1.0, JET: 1.0 },
  operator: { SEP: 0.3, MEP: 0.6, SET: 1.4, JET: 1.7 },
};

// Operators / dealers don't reposition aircraft to remote bush strips.
const SIZE_WEIGHT_BY_CLASS: Record<
  AircraftClass,
  Record<FerryAirportLite["size"], number>
> = {
  SEP: { major: 2, regional: 3, small: 2, remote: 1 },
  MEP: { major: 3, regional: 3, small: 2, remote: 0.5 },
  SET: { major: 4, regional: 3, small: 1, remote: 0.1 },
  JET: { major: 5, regional: 2, small: 0.2, remote: 0 },
};

const OWNER_FIRST_NAMES = [
  "Mr.",
  "Ms.",
  "Mr.",
  "Ms.",
  "Mr.",
  "Dr.",
];
const OWNER_SURNAMES = [
  "Chen",
  "Patterson",
  "Walsh",
  "Okafor",
  "Rivera",
  "Sundqvist",
  "Khoury",
  "Moreau",
  "Petrov",
  "Bellamy",
  "Tanaka",
  "Hoffmann",
  "Lindqvist",
  "Brennan",
];

const DEALER_NAMES = [
  "ABC Aviation Sales",
  "Maritime Aircraft Brokers",
  "Atlantic Sky Group",
  "Cardinal Aircraft Trading",
  "Northwind Aviation Sales",
  "Pacific Aero Brokers",
  "Highland Aviation Group",
  "Skybridge Aircraft",
];

const OPERATOR_NAMES = [
  "Premium Charter Group",
  "Boston Executive Air",
  "Coastal Charter Services",
  "Summit Jet Operations",
  "Regency Air Charter",
  "Aurora Charter",
  "Northbound Executive Air",
  "Sentinel Charter Group",
];

function weightedPick<T>(rng: () => number, items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it.value;
  }
  return items[items.length - 1]!.value;
}

function pickFrom<T>(rng: () => number, items: T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

function generateOwnerName(rng: () => number, source: FerrySourceType): string {
  if (source === "dealer") return pickFrom(rng, DEALER_NAMES);
  if (source === "operator") return pickFrom(rng, OPERATOR_NAMES);
  const honorific = pickFrom(rng, OWNER_FIRST_NAMES);
  const surname = pickFrom(rng, OWNER_SURNAMES);
  return `${honorific} ${surname}`;
}

function pickClassForSource(
  rng: () => number,
  source: FerrySourceType,
): AircraftClass {
  const items = FERRY_CLASS_WEIGHTS.map((c) => ({
    value: c.value,
    weight: c.weight * SOURCE_CLASS_BIAS[source][c.value],
  }));
  return weightedPick(rng, items);
}

function pickOriginForClass(
  rng: () => number,
  airports: FerryAirportLite[],
  cls: AircraftClass,
): FerryAirportLite | null {
  const sizeWeights = SIZE_WEIGHT_BY_CLASS[cls];
  // Jets/turbines need real runways. Filter out anything unsuitable upfront so
  // we don't accidentally weight remote strips into the lottery.
  const minRunway = cls === "JET" ? 4500 : cls === "SET" ? 3000 : 0;
  const eligible = airports.filter((a) => {
    if (cls === "JET" && !a.hasPavedRunway) return false;
    // Use longestRunwayFt from airport rows where available; FerryAirportLite
    // doesn't carry runway length to keep its surface narrow, so we lean on
    // airport size as a proxy for capability.
    if (minRunway > 0 && a.size === "remote") return false;
    return true;
  });
  if (eligible.length === 0) return null;
  const items = eligible.map((a) => ({
    value: a,
    weight: Math.max(0.01, sizeWeights[a.size]),
  }));
  return weightedPick(rng, items);
}

function pickDestination(
  rng: () => number,
  airports: FerryAirportLite[],
  origin: FerryAirportLite,
  cls: AircraftClass,
  maxDistanceNm: number,
): FerryAirportLite | null {
  const sizeWeights = SIZE_WEIGHT_BY_CLASS[cls];
  const candidates = airports
    .filter((a) => a.icao !== origin.icao)
    .filter((a) => {
      if (cls === "JET" && !a.hasPavedRunway) return false;
      if (cls === "JET" && a.size === "remote") return false;
      const d = haversineNm(origin, a);
      return d > 0 && d <= maxDistanceNm;
    });
  if (candidates.length === 0) return null;
  const items = candidates.map((a) => ({
    value: a,
    weight: Math.max(0.01, sizeWeights[a.size]),
  }));
  return weightedPick(rng, items);
}

function scheduleWindow(
  distanceNm: number,
  rng: () => number,
  simNow: number,
): {
  earliest: number;
  latest: number;
  urgency: Urgency;
} {
  const earliest = simNow + 1 * HOUR_MS;
  let windowHours: number;
  if (distanceNm < 200) {
    windowHours = 24 + rng() * 24;
  } else if (distanceNm < 500) {
    windowHours = 12 + rng() * 12;
  } else {
    windowHours = 8 + rng() * 8;
  }
  const isUrgent = rng() < 0.05;
  if (isUrgent) windowHours = Math.min(windowHours, 6);
  const urgency: Urgency = isUrgent
    ? "urgent"
    : windowHours >= 24
      ? "flexible"
      : "standard";
  return {
    earliest,
    latest: earliest + windowHours * HOUR_MS,
    urgency,
  };
}

function describeFerry(
  source: FerrySourceType,
  ownerName: string,
  modelLabel: string,
  tail: string,
  origin: string,
  destination: string,
): string {
  if (source === "owner") {
    return `Owner ${ownerName} requires ferry pilot to relocate the ${modelLabel} (tail ${tail}) from ${origin} to ${destination}.`;
  }
  if (source === "dealer") {
    return `${ownerName} contracted ferry — ${modelLabel} (tail ${tail}) needs to be at ${destination}. Pre-sale logistics.`;
  }
  return `${ownerName} pre-positioning — ${modelLabel} (tail ${tail}) required at ${destination} for charter operations.`;
}

export interface FerryAircraftWithModel extends FerryAircraftType {
  manufacturer?: string;
  model?: string;
}

export function generateFerryJob(
  ctx: FerryGenerationContext,
): GeneratedFerry | null {
  if (ctx.airports.length < 2 || ctx.aircraftTypes.length === 0) return null;

  const source = weightedPick(ctx.rng, SOURCE_WEIGHTS);
  const targetClass = pickClassForSource(ctx.rng, source);

  const typesInClass = ctx.aircraftTypes.filter((t) => t.class === targetClass);
  if (typesInClass.length === 0) return null;
  const aircraftType = pickFrom(ctx.rng, typesInClass);

  const origin = pickOriginForClass(ctx.rng, ctx.airports, targetClass);
  if (!origin) return null;

  // Cap the ferry distance at 85% of the aircraft's spec range so the
  // physical flight is always achievable on a single tank.
  const maxDistanceNm = aircraftType.rangeNm * 0.85;
  const destination = pickDestination(
    ctx.rng,
    ctx.airports,
    origin,
    targetClass,
    maxDistanceNm,
  );
  if (!destination) return null;

  const distanceNm = Math.round(haversineNm(origin, destination));
  if (distanceNm <= 0) return null;

  const tail = generateTailNumber(ctx.rng);
  const ownerName = generateOwnerName(ctx.rng, source);

  const payTable = FERRY_PAY[targetClass];
  const baseDollars = payTable.base + distanceNm * payTable.perNm;
  // ±10% variance.
  const variance = 0.9 + ctx.rng() * 0.2;
  const payCents = Math.round(baseDollars * variance) * 100;

  const window = scheduleWindow(distanceNm, ctx.rng, ctx.simNow);

  // Reposition flights are unloaded — design caps at 200 lbs max (paperwork,
  // tools, a small overnight bag).
  const payloadLbs = Math.round(ctx.rng() * 50);

  // Charter operators run on tighter weather minima; owners are typically
  // VFR-flexible.
  let weatherSensitivity: WeatherSensitivity = "mild";
  if (source === "operator" && (targetClass === "SET" || targetClass === "JET")) {
    weatherSensitivity = ctx.rng() < 0.4 ? "strict" : "mild";
  }

  const modelLabel =
    "model" in aircraftType && typeof aircraftType.model === "string"
      ? aircraftType.model
      : aircraftType.id;
  const description = describeFerry(
    source,
    ownerName,
    modelLabel,
    tail,
    origin.icao,
    destination.icao,
  );

  return {
    jobType: "ferry",
    ferryAircraftTypeId: aircraftType.id,
    ferryAircraftTail: tail,
    ferrySource: source,
    ferryOwnerName: ownerName,
    clientName: ownerName,
    originIcao: origin.icao,
    destinationIcao: destination.icao,
    distanceNm,
    minClass: targetClass,
    payCents,
    payloadLbs,
    paxCount: null,
    scheduleEarliest: window.earliest,
    scheduleLatest: window.latest,
    generatedAt: ctx.simNow,
    urgency: window.urgency,
    weatherSensitivity,
    description,
  };
}

export const FERRY_VOICE_PROFILES: Record<
  FerrySourceType,
  {
    dispatcherTemplate: string;
    personalityPrompt: string;
    sampleNote: string;
  }
> = {
  owner: {
    dispatcherTemplate: "{ownerName}",
    personalityPrompt:
      "A private aircraft owner — the actual owner of the plane. Personal, sometimes slightly possessive about their aircraft. Will occasionally mention the aircraft fondly, give specific instructions about quirks. Friendly but particular.",
    sampleNote:
      "She's been hangared all winter. Treat her gently on first start — sometimes the alternator hesitates. I'll meet you at the destination for the keys.",
  },
  dealer: {
    dispatcherTemplate: "{ownerName}",
    personalityPrompt:
      "An aircraft dealer/broker. Business-focused, efficient, treats the aircraft as inventory. Mentions logistics and timing more than aircraft character. Emphasizes that the buyer or next operator is waiting.",
    sampleNote:
      "Buyer wants delivery by 1700 tomorrow at the latest. Aircraft is on the ramp, paperwork is in the cabin. Just get her there.",
  },
  operator: {
    dispatcherTemplate: "Operations · {ownerName}",
    personalityPrompt:
      "Charter operations dispatch. Corporate, precise, time-conscious. Uses operational language ('positioning,' 'crew swap,' 'utilization'). The aircraft needs to be at the destination for a downstream commercial flight.",
    sampleNote:
      "Need {tail} at destination by 2200 hours for a 0700 charter departure tomorrow. Standard pre-position. Confirm wheels up time once airborne.",
  },
};
