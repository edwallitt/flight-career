import type { AircraftClass } from "../clients/types.js";
import { priceAircraft, type ConditionGrade } from "./pricing.js";

export interface ListingAirport {
  icao: string;
  size: "major" | "regional" | "small" | "remote";
  hasMaintenance: boolean;
}

export interface ListingAircraftType {
  id: string;
  class: AircraftClass;
  basePurchasePriceCents: number;
  tboHours: number;
}

export interface ListingGenerationContext {
  airports: ListingAirport[];
  aircraftTypes: ListingAircraftType[];
  rng: () => number;
  simNow: number;
}

export interface GeneratedListing {
  aircraftTypeId: string;
  tailNumber: string;
  locationIcao: string;
  airframeHours: number;
  engineHoursSinceOverhaul: number;
  hoursSince100hr: number;
  hoursSinceAnnual: number;
  askingPriceCents: number;
  conditionGrade: ConditionGrade;
  listedAt: number;
  expiresAt: number;
  descriptionShort: string | null;
}

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

const AIRPORT_SIZE_WEIGHT: Record<ListingAirport["size"], number> = {
  major: 4,
  regional: 3,
  small: 1,
  remote: 0.3,
};

const CONDITION_WEIGHTS: { value: ConditionGrade; weight: number }[] = [
  { value: "pristine", weight: 5 },
  { value: "excellent", weight: 25 },
  { value: "good", weight: 45 },
  { value: "fair", weight: 20 },
  { value: "project", weight: 5 },
];

const CLASS_WEIGHTS: { value: AircraftClass; weight: number }[] = [
  { value: "SEP", weight: 8 },
  { value: "MEP", weight: 5 },
  { value: "SET", weight: 5 },
  { value: "JET", weight: 2 },
];

const DESCRIPTION_NOTES = [
  "Recent annual completed",
  "New tires",
  "Glass panel upgrade",
  "Hangared from new",
  "Single owner",
  "Recent prop overhaul",
  "Pristine logbooks",
];

function pickWeighted<T>(
  rng: () => number,
  items: { value: T; weight: number }[],
): T {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it.value;
  }
  return items[items.length - 1]!.value;
}

function pickInRange(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function pickAirport(
  rng: () => number,
  airports: ListingAirport[],
): ListingAirport {
  const items = airports.map((a) => ({
    value: a,
    weight: AIRPORT_SIZE_WEIGHT[a.size] * (a.hasMaintenance ? 2 : 1),
  }));
  return pickWeighted(rng, items);
}

const N_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude I and O for realism
const C_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function pickChar(rng: () => number, alphabet: string): string {
  return alphabet.charAt(Math.floor(rng() * alphabet.length));
}

export function generateTailNumber(rng: () => number): string {
  if (rng() < 0.7) {
    // N-number: "N" + 3 digits + 2 letters
    const digits = Math.floor(100 + rng() * 900);
    const a = pickChar(rng, N_LETTERS);
    const b = pickChar(rng, N_LETTERS);
    return `N${digits}${a}${b}`;
  }
  // Canadian: "C-F" + 3 letters
  const a = pickChar(rng, C_LETTERS);
  const b = pickChar(rng, C_LETTERS);
  const c = pickChar(rng, C_LETTERS);
  return `C-F${a}${b}${c}`;
}

function pickAirframeHours(
  cls: AircraftClass,
  rng: () => number,
): number {
  const roll = rng();
  let lo = 0;
  let hi = 0;
  if (cls === "SEP" || cls === "MEP") {
    if (roll < 0.6) {
      lo = 1500;
      hi = 6000;
    } else if (roll < 0.9) {
      lo = 500;
      hi = 1500;
    } else {
      lo = 0;
      hi = 500;
    }
  } else if (cls === "SET") {
    if (roll < 0.5) {
      lo = 1000;
      hi = 5000;
    } else if (roll < 0.85) {
      lo = 200;
      hi = 1000;
    } else {
      lo = 0;
      hi = 200;
    }
  } else {
    // JET
    if (roll < 0.4) {
      lo = 800;
      hi = 3500;
    } else if (roll < 0.8) {
      lo = 200;
      hi = 800;
    } else {
      lo = 0;
      hi = 200;
    }
  }
  return Math.round(pickInRange(rng, lo, hi));
}

function pickDescription(
  rng: () => number,
  conditionGrade: ConditionGrade,
  engineHoursSinceOverhaul: number,
  tboHours: number,
): string | null {
  if (conditionGrade === "project") {
    return "Project — needs work";
  }
  if (engineHoursSinceOverhaul > tboHours * 0.85) {
    if (rng() < 0.6) return "Engine due for overhaul";
  }
  if (rng() < 0.05) return "Motivated seller";
  if (rng() < 0.3) {
    const idx = Math.floor(rng() * DESCRIPTION_NOTES.length);
    return DESCRIPTION_NOTES[idx]!;
  }
  return null;
}

export function generateListing(
  typeId: string,
  ctx: ListingGenerationContext,
): GeneratedListing {
  const type = ctx.aircraftTypes.find((t) => t.id === typeId);
  if (!type) {
    throw new Error(`generateListing: unknown aircraft type ${typeId}`);
  }
  if (ctx.airports.length === 0) {
    throw new Error("generateListing: no airports available");
  }

  const airport = pickAirport(ctx.rng, ctx.airports);
  const tailNumber = generateTailNumber(ctx.rng);
  const airframeHours = pickAirframeHours(type.class, ctx.rng);

  // Older airframes tend to have engines deeper into TBO.
  const ageBias = Math.min(1, airframeHours / 5000);
  const engineRoll = ctx.rng();
  const engineFraction = engineRoll * (0.4 + 0.55 * ageBias);
  const engineHoursSinceOverhaul = Math.round(
    Math.min(type.tboHours * 0.95, type.tboHours * engineFraction),
  );

  const hoursSince100hr = Math.round(pickInRange(ctx.rng, 0, 95));
  const hoursSinceAnnual = Math.round(pickInRange(ctx.rng, 0, 340));
  const conditionGrade = pickWeighted(ctx.rng, CONDITION_WEIGHTS);

  const pricing = priceAircraft({
    basePurchasePriceCents: type.basePurchasePriceCents,
    airframeHours,
    engineHoursSinceOverhaul,
    tboHours: type.tboHours,
    hoursSinceAnnual,
    hoursSince100hr,
    conditionGrade,
  });

  const expiresInDays = 7 + ctx.rng() * 23; // 7–30 days
  const expiresAt = ctx.simNow + Math.round(expiresInDays * SIM_DAY_MS);

  const descriptionShort = pickDescription(
    ctx.rng,
    conditionGrade,
    engineHoursSinceOverhaul,
    type.tboHours,
  );

  return {
    aircraftTypeId: type.id,
    tailNumber,
    locationIcao: airport.icao,
    airframeHours,
    engineHoursSinceOverhaul,
    hoursSince100hr,
    hoursSinceAnnual,
    askingPriceCents: pricing.askingPriceCents,
    conditionGrade,
    listedAt: ctx.simNow,
    expiresAt,
    descriptionShort,
  };
}

function pickType(
  rng: () => number,
  types: ListingAircraftType[],
): ListingAircraftType | null {
  if (types.length === 0) return null;
  const targetClass = pickWeighted(rng, CLASS_WEIGHTS);
  const inClass = types.filter((t) => t.class === targetClass);
  const pool = inClass.length > 0 ? inClass : types;
  return pool[Math.floor(rng() * pool.length)] ?? null;
}

export function generateListingBatch(
  count: number,
  ctx: ListingGenerationContext,
): GeneratedListing[] {
  const out: GeneratedListing[] = [];
  for (let i = 0; i < count; i++) {
    const type = pickType(ctx.rng, ctx.aircraftTypes);
    if (!type) break;
    out.push(generateListing(type.id, ctx));
  }
  return out;
}
