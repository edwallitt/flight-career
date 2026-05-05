import type {
  AircraftClass,
  ClientDefinition,
  JobTemplate,
  PayloadType,
  Role,
  Urgency,
  WeatherSensitivity,
} from "../clients/types.js";
import { haversineNm } from "./distance.js";
import { calculatePay } from "./pay-calculator.js";

export interface AirportLite {
  icao: string;
  lat: number;
  lon: number;
  size: "major" | "regional" | "small" | "remote";
  hasPavedRunway: boolean;
}

export interface GenerationContext {
  airports: AirportLite[];
  reputationByRole: Record<Role, number>;
  reputationByClient: Record<string, number>;
  simNow: number;
  rng: () => number;
  currentBoardSize: number;
  targetBoardSize: number;
}

export interface GeneratedJob {
  clientId: string | null;
  role: Role | "open";
  originIcao: string;
  destinationIcao: string;
  payloadLbs: number;
  payloadType: PayloadType;
  paxCount: number | null;
  requiredClass: AircraftClass;
  requiredCapabilities: string[];
  pay: number;
  distanceNm: number;
  generatedAt: number;
  expiresAt: number;
  earliestDeparture: number | null;
  latestDeparture: number | null;
  urgency: Urgency;
  weatherSensitivity: WeatherSensitivity;
  legs: null;
  description: string;
}

const TICKS_PER_DAY = 48;
const HOUR_MS = 60 * 60 * 1000;

const URGENCY_EXPIRY_HOURS: Record<Urgency, number> = {
  critical: 2,
  urgent: 6,
  standard: 24,
  flexible: 72,
};

function pickInRange(
  rng: () => number,
  range: [number, number],
  integer = false,
): number {
  const [lo, hi] = range;
  const v = lo + rng() * (hi - lo);
  return integer ? Math.round(v) : v;
}

function pickFrom<T>(rng: () => number, items: T[]): T {
  if (items.length === 0) {
    throw new Error("pickFrom: empty list");
  }
  const idx = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[idx]!;
}

function weightedPick<T extends { weight: number }>(
  rng: () => number,
  items: T[],
): T {
  if (items.length === 0) {
    throw new Error("weightedPick: empty list");
  }
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it;
  }
  return items[items.length - 1]!;
}

function airportByIcao(
  airports: AirportLite[],
  icao: string,
): AirportLite | undefined {
  return airports.find((a) => a.icao === icao);
}

function filterToSeeded(
  candidates: string[],
  airports: AirportLite[],
): string[] {
  const known = new Set(airports.map((a) => a.icao));
  return candidates.filter((c) => known.has(c));
}

function computeDepartureWindow(
  urgency: Urgency,
  simNow: number,
  rng: () => number,
): { earliest: number | null; latest: number | null } {
  if (urgency === "critical" || urgency === "urgent") {
    const hours = 1 + rng() * 2;
    return { earliest: simNow, latest: simNow + hours * HOUR_MS };
  }
  return { earliest: null, latest: null };
}

function concretizeFromTemplate(
  client: ClientDefinition,
  template: JobTemplate,
  ctx: GenerationContext,
): GeneratedJob | null {
  const origins = filterToSeeded(
    template.routeTemplate.originCandidates,
    ctx.airports,
  );
  const destinations = filterToSeeded(
    template.routeTemplate.destinationCandidates,
    ctx.airports,
  );

  const originIcao = origins.length
    ? pickFrom(ctx.rng, origins)
    : client.homeBaseIcao;
  let destinationIcao = destinations.length
    ? pickFrom(ctx.rng, destinations)
    : client.homeBaseIcao;

  if (destinationIcao === originIcao) {
    const others = destinations.filter((d) => d !== originIcao);
    if (others.length === 0) return null;
    destinationIcao = pickFrom(ctx.rng, others);
  }

  const originAp = airportByIcao(ctx.airports, originIcao);
  const destAp = airportByIcao(ctx.airports, destinationIcao);
  if (!originAp || !destAp) return null;

  const payloadLbs = pickInRange(ctx.rng, template.payloadLbsRange, true);
  const paxCount = template.paxCountRange
    ? pickInRange(ctx.rng, template.paxCountRange, true)
    : null;

  const distanceNm = haversineNm(originAp, destAp);
  const isUnpavedRequired = template.requiredCapabilities.includes("unpaved");

  const pay = calculatePay({
    distanceNm,
    requiredClass: template.minClass,
    payloadLbs,
    urgency: template.urgency,
    weatherSensitivity: template.weatherSensitivity,
    isUnpavedRequired,
    isRemoteDestination: destAp.size === "remote",
    basePayMultiplier: template.basePayMultiplier,
    familiarityDiscount: 0,
  });

  const expiresAt =
    ctx.simNow + URGENCY_EXPIRY_HOURS[template.urgency] * HOUR_MS;
  const { earliest, latest } = computeDepartureWindow(
    template.urgency,
    ctx.simNow,
    ctx.rng,
  );

  return {
    clientId: client.id,
    role: client.role,
    originIcao,
    destinationIcao,
    payloadLbs,
    payloadType: template.payloadType,
    paxCount,
    requiredClass: template.minClass,
    requiredCapabilities: [...template.requiredCapabilities],
    pay,
    distanceNm: Math.round(distanceNm),
    generatedAt: ctx.simNow,
    expiresAt,
    earliestDeparture: earliest,
    latestDeparture: latest,
    urgency: template.urgency,
    weatherSensitivity: template.weatherSensitivity,
    legs: null,
    description: template.description({
      origin: originIcao,
      destination: destinationIcao,
    }),
  };
}

export function generateClientJobs(
  client: ClientDefinition,
  ctx: GenerationContext,
): GeneratedJob[] {
  const repInRole = ctx.reputationByRole[client.role] ?? 0;
  if (repInRole < client.reputationGateMin) return [];

  const month = new Date(ctx.simNow).getUTCMonth();
  const seasonal = client.seasonalMultipliers[month] ?? 1;
  const expectedPerDay = client.baseJobsPerDay * seasonal;
  const probPerTick = expectedPerDay / TICKS_PER_DAY;

  if (ctx.rng() > probPerTick) return [];

  const count = ctx.rng() < 0.1 ? 2 : 1;

  const premiumGate = (client.reputationGateMin + client.reputationGateMax) / 2;
  const premiumUnlocked =
    repInRole >= premiumGate && client.premiumTemplates.length > 0;

  const jobs: GeneratedJob[] = [];
  for (let i = 0; i < count; i++) {
    const usePremium = premiumUnlocked && ctx.rng() < 0.25;
    const pool = usePremium ? client.premiumTemplates : client.standardTemplates;
    if (pool.length === 0) continue;
    const template = weightedPick(ctx.rng, pool);
    const job = concretizeFromTemplate(client, template, ctx);
    if (job) jobs.push(job);
  }
  return jobs;
}

const OPEN_MARKET_CLASS_WEIGHTS: { value: AircraftClass; weight: number }[] = [
  { value: "SEP", weight: 50 },
  { value: "MEP", weight: 25 },
  { value: "SET", weight: 20 },
  { value: "JET", weight: 5 },
];

const OPEN_MARKET_PAYLOAD_RANGE: Record<AircraftClass, [number, number]> = {
  SEP: [100, 800],
  MEP: [200, 1500],
  SET: [400, 2000],
  JET: [200, 1800],
};

const AIRPORT_SIZE_WEIGHT: Record<AirportLite["size"], number> = {
  major: 1,
  regional: 2,
  small: 3,
  remote: 3,
};

function pickAirportBiased(
  rng: () => number,
  airports: AirportLite[],
  exclude?: string,
): AirportLite {
  const pool = exclude ? airports.filter((a) => a.icao !== exclude) : airports;
  const items = pool.map((a) => ({ value: a, weight: AIRPORT_SIZE_WEIGHT[a.size] }));
  const total = items.reduce((s, it) => s + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it.value;
  }
  return items[items.length - 1]!.value;
}

function buildOpenMarketJob(ctx: GenerationContext): GeneratedJob | null {
  if (ctx.airports.length < 2) return null;

  const requiredClass = weightedPick(ctx.rng, OPEN_MARKET_CLASS_WEIGHTS).value;

  const isCargo = ctx.rng() < 0.8;
  const payloadType: PayloadType = isCargo ? "cargo" : "pax";

  const payloadLbs = pickInRange(
    ctx.rng,
    OPEN_MARKET_PAYLOAD_RANGE[requiredClass],
    true,
  );

  let paxCount: number | null = null;
  if (!isCargo) {
    const cap = requiredClass === "SEP" ? 3 : requiredClass === "MEP" ? 5 : 8;
    paxCount = 1 + Math.floor(ctx.rng() * cap);
  }

  const urgency: Urgency = ctx.rng() < 0.7 ? "flexible" : "standard";
  const weatherSensitivity: WeatherSensitivity =
    ctx.rng() < 0.9 ? "none" : "mild";

  const origin = pickAirportBiased(ctx.rng, ctx.airports);
  const destination = pickAirportBiased(ctx.rng, ctx.airports, origin.icao);

  const distanceNm = haversineNm(origin, destination);

  const pay = calculatePay({
    distanceNm,
    requiredClass,
    payloadLbs,
    urgency,
    weatherSensitivity,
    isUnpavedRequired: false,
    isRemoteDestination: destination.size === "remote",
    basePayMultiplier: 0.85,
    familiarityDiscount: 0,
  });

  const description = isCargo
    ? `Cargo run, ${payloadLbs} lbs from ${origin.icao} to ${destination.icao}.`
    : `Passenger run, ${paxCount} pax from ${origin.icao} to ${destination.icao}.`;

  return {
    clientId: null,
    role: "open",
    originIcao: origin.icao,
    destinationIcao: destination.icao,
    payloadLbs,
    payloadType,
    paxCount,
    requiredClass,
    requiredCapabilities: [],
    pay,
    distanceNm: Math.round(distanceNm),
    generatedAt: ctx.simNow,
    expiresAt: ctx.simNow + 4 * HOUR_MS,
    earliestDeparture: null,
    latestDeparture: null,
    urgency,
    weatherSensitivity,
    legs: null,
    description,
  };
}

const MAX_OPEN_MARKET_PER_TICK = 3;

export function generateOpenMarketJobs(ctx: GenerationContext): GeneratedJob[] {
  const deficit = ctx.targetBoardSize - ctx.currentBoardSize;
  if (deficit <= 0) return [];
  const count = Math.min(deficit, MAX_OPEN_MARKET_PER_TICK);
  const jobs: GeneratedJob[] = [];
  for (let i = 0; i < count; i++) {
    const job = buildOpenMarketJob(ctx);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function runGenerationTick(
  clients: ClientDefinition[],
  ctx: GenerationContext,
): GeneratedJob[] {
  const jobs: GeneratedJob[] = [];
  for (const client of clients) {
    jobs.push(...generateClientJobs(client, ctx));
  }
  const projectedBoardSize = ctx.currentBoardSize + jobs.length;
  jobs.push(
    ...generateOpenMarketJobs({ ...ctx, currentBoardSize: projectedBoardSize }),
  );
  return jobs;
}
