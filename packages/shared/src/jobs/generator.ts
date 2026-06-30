import type {
  AircraftClass,
  ClientDefinition,
  JobTemplate,
  PayloadType,
  Role,
  Urgency,
  WeatherSensitivity,
} from "../clients/types.js";
import {
  jobFrequencyMultiplierForScore,
  loyaltyBonusForScore,
} from "../career/reputation.js";
import { haversineNm } from "./distance.js";
import {
  calculatePay,
  familiarityDiscountForCount,
  routeKey,
} from "./pay-calculator.js";

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
  // World-time elapsed (sim ms) that this generation pass represents. The
  // world clock runs at 1× real time, so a background tick every 30 real
  // seconds carries genElapsedMs ≈ 30_000; a tick right after a long offline
  // gap or an abstracted-travel jump carries much more. Client job rates are
  // scaled by this so generation tracks elapsed world time rather than a fixed
  // ticks-per-day assumption. The server clamps it on catch-up so a multi-day
  // absence doesn't flood the board.
  genElapsedMs: number;
  rng: () => number;
  currentBoardSize: number;
  targetBoardSize: number;
  // Player's current airport. When set, the generator forces at least one
  // open-market job per tick to depart from here whenever the projected
  // board would otherwise have zero home-origin jobs. Without this, the
  // open-market origin bias (which de-weights majors) leaves players at
  // big airports stranded with no eligible work.
  playerLocationIcao?: string;
  // Count of jobs already on the board that depart from playerLocationIcao.
  // Used together with `playerLocationIcao` to decide whether the home-job
  // guarantee needs to fire this tick.
  homeOriginJobCount?: number;
  // Aircraft classes the player can actually fly right now — union of owned
  // aircraft classes and rental classes available at their current airport.
  // When set, the open-market generator biases its class roll toward these
  // so a starter SEP pilot doesn't see a board full of jet contracts, and the
  // client-job admission biases the same way (see `runGenerationTick`). Pass
  // undefined (or omit) to keep the old uniform-by-weight behaviour, which
  // is what the seed pre-warm and unit tests do.
  playerAvailableClasses?: AircraftClass[];
  // Soft ceiling on total open jobs. Client (branded) jobs are inserted
  // unconditionally and persist far longer than open-market work, so without a
  // ceiling the board accumulates well past `targetBoardSize`. Branded and
  // deficit-fill open-market jobs respect this cap; only the home-origin floor
  // may briefly overshoot it (see `generateOpenMarketJobs`). Omit for no cap
  // (the back-compat default used by unit tests and the seed pre-warm).
  maxBoardSize?: number;
  // Floor on how many *flyable* branded jobs the board should hold. A fresh
  // save has no accumulated client work, and the elapsed-based trickle is slow,
  // so the first session would otherwise show a wall of anonymous open-market
  // jobs. When the board is short, the generator force-surfaces flyable client
  // work from eligible, in-season clients (weighted by their job rate, so
  // seasonality still holds). Omit/0 to disable (the default).
  minBrandedJobs?: number;
  // Count of flyable branded jobs already on the board, paired with
  // `minBrandedJobs` to decide the shortfall the floor must cover.
  brandedJobCount?: number;
  // Player's recent flight count per directed route (`routeKey(o, d)` →
  // flights flown within the familiarity window). Drives the anti-"milk run"
  // familiarity discount on a job's pay. Omit for no discount (the back-compat
  // default used by unit tests and the seed pre-warm).
  routeFlightCounts?: Record<string, number>;
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Safety cap on how many jobs a single client can spawn in one generation
// pass. With elapsed-based rates a long catch-up window could otherwise ask
// for a whole week of a client's jobs at once; the board's size cap would
// trim them anyway, but bounding here keeps a single client from dominating.
const MAX_CLIENT_JOBS_PER_GEN = 3;

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

  // Loyalty pay bonus: standing with this client raises the pay on its jobs,
  // baked into the board number here so it equals the eventual payout.
  const clientRep = ctx.reputationByClient[client.id] ?? 0;
  const pay = calculatePay({
    distanceNm,
    requiredClass: template.minClass,
    payloadLbs,
    urgency: template.urgency,
    weatherSensitivity: template.weatherSensitivity,
    isUnpavedRequired,
    isRemoteDestination: destAp.size === "remote",
    basePayMultiplier: template.basePayMultiplier,
    familiarityDiscount: familiarityDiscountForCount(
      ctx.routeFlightCounts?.[routeKey(originIcao, destinationIcao)] ?? 0,
    ),
    loyaltyBonus: loyaltyBonusForScore(clientRep),
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
  // Priority work: High+ standing with this client multiplies its job rate.
  const clientRep = ctx.reputationByClient[client.id] ?? 0;
  const expectedPerDay =
    client.baseJobsPerDay *
    seasonal *
    jobFrequencyMultiplierForScore(clientRep);
  // Expected jobs for the elapsed world-time window. At 1× real time a 30s
  // background tick yields a tiny fraction (≈ expectedPerDay × 30s/day), so
  // most ticks produce nothing and a client surfaces work every few hours —
  // matching its baseJobsPerDay over a real day.
  const expected = expectedPerDay * (ctx.genElapsedMs / DAY_MS);
  if (expected <= 0) return [];

  // Sample an integer job count from the (possibly fractional) expectation:
  // the whole part fires for sure, the fractional part is a coin flip. Bounded
  // so a long catch-up window can't have one client carpet the board.
  const whole = Math.floor(expected);
  const frac = expected - whole;
  let count = whole + (ctx.rng() < frac ? 1 : 0);
  if (count <= 0) return [];
  count = Math.min(count, MAX_CLIENT_JOBS_PER_GEN);

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

// Multipliers applied to the base open-market class weights when
// `playerAvailableClasses` is provided. Classes the player can fly are 2x
// more likely; classes they can't are 0.5x. Some residual weight on
// out-of-reach classes keeps aspirational jobs visible without flooding the
// board. With SEP-only at start this yields ~80% SEP, ~10% MEP, ~8% SET,
// ~2% JET — most of the top-up is flyable, but the player still sees the
// occasional reminder that upgrades exist.
const AVAILABLE_CLASS_MULTIPLIER = 2;
const UNAVAILABLE_CLASS_MULTIPLIER = 0.5;

function classWeightsForPlayer(
  availableClasses: AircraftClass[] | undefined,
): { value: AircraftClass; weight: number }[] {
  if (!availableClasses || availableClasses.length === 0) {
    return OPEN_MARKET_CLASS_WEIGHTS;
  }
  const available = new Set(availableClasses);
  return OPEN_MARKET_CLASS_WEIGHTS.map(({ value, weight }) => ({
    value,
    weight:
      weight *
      (available.has(value)
        ? AVAILABLE_CLASS_MULTIPLIER
        : UNAVAILABLE_CLASS_MULTIPLIER),
  }));
}

const OPEN_MARKET_PAYLOAD_RANGE: Record<AircraftClass, [number, number]> = {
  SEP: [100, 800],
  MEP: [200, 1500],
  SET: [400, 2000],
  JET: [200, 1800],
};

// Open-market origins are biased toward smaller fields so the board feels
// like bush/regional work rather than hub-to-hub airline runs. Majors are
// de-weighted but not punished — a player based at a major (e.g. CYHZ) still
// sees a fair share of jobs originate where they are, which together with the
// home-origin floor below keeps repositioning from dominating the early game.
const AIRPORT_SIZE_WEIGHT: Record<AirportLite["size"], number> = {
  major: 2,
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

function buildOpenMarketJob(
  ctx: GenerationContext,
  forceOriginIcao?: string,
): GeneratedJob | null {
  if (ctx.airports.length < 2) return null;

  const requiredClass = weightedPick(
    ctx.rng,
    classWeightsForPlayer(ctx.playerAvailableClasses),
  ).value;

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

  const origin = forceOriginIcao
    ? airportByIcao(ctx.airports, forceOriginIcao) ??
      pickAirportBiased(ctx.rng, ctx.airports)
    : pickAirportBiased(ctx.rng, ctx.airports);
  const destination = pickAirportBiased(ctx.rng, ctx.airports, origin.icao);

  const distanceNm = haversineNm(origin, destination);

  const rawPay = calculatePay({
    distanceNm,
    requiredClass,
    payloadLbs,
    urgency,
    weatherSensitivity,
    isUnpavedRequired: false,
    isRemoteDestination: destination.size === "remote",
    basePayMultiplier: 0.85,
    familiarityDiscount: familiarityDiscountForCount(
      ctx.routeFlightCounts?.[routeKey(origin.icao, destination.icao)] ?? 0,
    ),
    // Open-market jobs have no client relationship → no loyalty bonus.
    loyaltyBonus: 0,
  });
  const pay = Math.max(OPEN_MARKET_PAY_FLOOR_CENTS, rawPay);

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

// Keep at least this many jobs on the board departing from the player's
// current airport. Branded home-base clients (e.g. Maritime Cargo at CYHZ)
// usually cover this on their own, but when they're quiet — early game, off
// season, or a player parked at a field with no resident client — the
// open-market step backfills home-origin jobs up to this floor so the player
// always has flyable work without first paying to reposition.
const MIN_HOME_ORIGIN_JOBS = 3;

// Open-market jobs have a $400 (40,000¢) pay floor. Below this, even a short
// hop in a wet rental loses money once reposition + landing fees are counted.
// Branded clients keep their own pay scales.
const OPEN_MARKET_PAY_FLOOR_CENTS = 40_000;

export function generateOpenMarketJobs(ctx: GenerationContext): GeneratedJob[] {
  const maxBoard = ctx.maxBoardSize ?? Infinity;
  const jobs: GeneratedJob[] = [];
  let projected = ctx.currentBoardSize;
  let made = 0;

  // Home-airport floor: guarantee flyable departures from the player's current
  // field. Without this, the major-de-weighted origin pick leaves players at
  // big airports (or quiet fields) with little to fly out — and once branded
  // work fills the board the deficit step below never runs, so a player who
  // just repositioned to a client-less field would be stranded until jobs age
  // out. The floor therefore runs *regardless of the deficit* and may briefly
  // push the board past the soft ceiling; the overshoot is bounded by
  // MIN_HOME_ORIGIN_JOBS and drains as short-lived open-market jobs expire.
  const homeForced = ctx.playerLocationIcao
    ? Math.max(0, MIN_HOME_ORIGIN_JOBS - (ctx.homeOriginJobCount ?? 0))
    : 0;
  for (let i = 0; i < homeForced && made < MAX_OPEN_MARKET_PER_TICK; i++) {
    const job = buildOpenMarketJob(ctx, ctx.playerLocationIcao);
    if (job) {
      jobs.push(job);
      projected++;
      made++;
    }
  }

  // General deficit fill toward target — respects the soft ceiling and shares
  // the per-tick open-market budget with the home floor above.
  while (
    projected < ctx.targetBoardSize &&
    projected < maxBoard &&
    made < MAX_OPEN_MARKET_PER_TICK
  ) {
    const job = buildOpenMarketJob(ctx);
    if (!job) break;
    jobs.push(job);
    projected++;
    made++;
  }
  return jobs;
}

// Force one flyable branded job from an eligible, in-season client, weighted by
// each client's current job rate so seasonality and reputation gating still
// shape which client surfaces. Used by the new-player branded floor. Returns
// null when no eligible flyable client exists (e.g. every flyable client is
// out of season), in which case the floor simply can't be met this tick.
function forceFlyableBrandedJob(
  clients: ClientDefinition[],
  ctx: GenerationContext,
  isFlyable: (cls: AircraftClass) => boolean,
): GeneratedJob | null {
  const month = new Date(ctx.simNow).getUTCMonth();
  const eligible = clients
    .map((client) => {
      const repInRole = ctx.reputationByRole[client.role] ?? 0;
      if (repInRole < client.reputationGateMin) return null;
      const seasonal = client.seasonalMultipliers[month] ?? 1;
      if (seasonal <= 0) return null;
      const templates = client.standardTemplates.filter((t) =>
        isFlyable(t.minClass),
      );
      if (templates.length === 0) return null;
      const clientRep = ctx.reputationByClient[client.id] ?? 0;
      const weight =
        client.baseJobsPerDay *
        seasonal *
        jobFrequencyMultiplierForScore(clientRep);
      if (weight <= 0) return null;
      return { client, templates, weight };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (eligible.length === 0) return null;
  const chosen = weightedPick(ctx.rng, eligible);
  const template = weightedPick(ctx.rng, chosen.templates);
  return concretizeFromTemplate(chosen.client, template, ctx);
}

export function runGenerationTick(
  clients: ClientDefinition[],
  ctx: GenerationContext,
): GeneratedJob[] {
  const maxBoard = ctx.maxBoardSize ?? Infinity;
  const isFlyable = (cls: AircraftClass): boolean =>
    !ctx.playerAvailableClasses ||
    ctx.playerAvailableClasses.length === 0 ||
    ctx.playerAvailableClasses.includes(cls);

  let projected = ctx.currentBoardSize;
  let homeCount = ctx.homeOriginJobCount ?? 0;
  const jobs: GeneratedJob[] = [];

  const admit = (job: GeneratedJob, cap: number): void => {
    if (projected >= cap) return;
    jobs.push(job);
    projected++;
    if (
      ctx.playerLocationIcao != null &&
      job.originIcao === ctx.playerLocationIcao
    ) {
      homeCount++;
    }
  };

  // 1. Branded candidates from every eligible client (the elapsed-based trickle).
  const candidates: GeneratedJob[] = [];
  for (const client of clients) {
    candidates.push(...generateClientJobs(client, ctx));
  }

  // 2. Admit branded in priority order. Flyable client work fills up to the
  // soft ceiling; jobs the player can't fly yet are admitted only into the
  // lower "aspirational" band (below target) so a low-tier board surfaces the
  // occasional upgrade-teaser without drowning in untakeable contracts.
  for (const job of candidates) {
    if (isFlyable(job.requiredClass)) admit(job, maxBoard);
  }
  for (const job of candidates) {
    if (!isFlyable(job.requiredClass)) admit(job, ctx.targetBoardSize);
  }

  // 3. New-player branded floor: top up flyable client work to the minimum so a
  // fresh save shows real clients, not a wall of anonymous jobs. No-op once the
  // board has accumulated enough branded work (established players).
  const minBranded = ctx.minBrandedJobs ?? 0;
  if (minBranded > 0) {
    const flyableBrandedOnBoard =
      (ctx.brandedJobCount ?? 0) +
      jobs.filter((j) => isFlyable(j.requiredClass)).length;
    let shortfall = Math.min(
      minBranded - flyableBrandedOnBoard,
      maxBoard - projected,
    );
    while (shortfall-- > 0) {
      const job = forceFlyableBrandedJob(clients, ctx, isFlyable);
      if (!job) break;
      admit(job, maxBoard);
    }
  }

  // 4. Home-origin floor + open-market deficit fill, off the post-branded board
  // size and home count so the open-market step doesn't double-count a home job
  // a client already produced this tick.
  jobs.push(
    ...generateOpenMarketJobs({
      ...ctx,
      currentBoardSize: projected,
      homeOriginJobCount: homeCount,
    }),
  );
  return jobs;
}
