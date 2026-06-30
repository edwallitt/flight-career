import {
  ALL_CLIENTS,
  computeJobFit,
  computeReachability,
  FAMILIARITY_WINDOW_SIM_DAYS,
  generateFerryJob,
  getClientById,
  haversineNm,
  routeKey,
  pickRecommendedJobId,
  reputationTier,
  runGenerationTick,
  type AircraftClass,
  type FerryAircraftType,
  type FerryAirportLite,
  type FitAirport,
  type FitOwnedAircraft,
  type FitRentalAircraft,
  type GeneratedFerry,
  type GeneratedJob,
  type JobFit,
  type JobReachability,
  type ReputationTier,
  type Role,
  priceFerryLeg,
} from "@flightcareer/shared";
import { and, count, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  flights,
  fuelPriceCurrent,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
  reputation,
} from "../db/schema.js";
import {
  DRIFT_INTERVAL_MS,
  ensureFuelPriceCurrent,
  processFuelDriftTick,
} from "./fuelDrift.js";

const TARGET_BOARD_SIZE = 12;

// Soft ceiling on the open board. Branded jobs are inserted unconditionally and
// persist far longer than open-market work (24–72h vs 4h), so without a ceiling
// the board accumulates well past the target — measured at 20–26 jobs in steady
// state. The generator caps branded + deficit-fill at this; only the home-origin
// floor may briefly overshoot it (and drains back as open-market jobs expire).
const MAX_BOARD_SIZE = 14;

// Floor on flyable branded jobs the board should surface. A brand-new save has
// no accumulated client work and the elapsed-based trickle is slow, so the first
// session would otherwise be a wall of anonymous open-market jobs. The generator
// force-surfaces flyable client work up to this floor from eligible, in-season
// clients. A no-op once branded work has accumulated past it.
const MIN_BRANDED_JOBS = 3;

// The world clock runs at 1× wall-clock time: each tick advances simDateTime
// by the real time elapsed since the last sync (Date.now() - lastClockSyncReal),
// so the world keeps moving whether the server is up or not — the first tick
// after a restart applies the whole offline gap in one step.
//
// Job generation, however, must not replay an entire offline gap: a two-day
// absence should leave a fresh board, not two days of accumulated contracts.
// We expire stale jobs against the full elapsed time but cap the *generation*
// window here; the size-capped open-market top-up refills the board the rest
// of the way over the next few ticks.
const MAX_GEN_ELAPSED_MS = 6 * 60 * 60 * 1000;

const SIM_DAY_MS = 24 * 60 * 60 * 1000;

// Ferries are their own content lane — they let the player fly (and get paid
// for) aircraft they don't own, so they should be a visible, persistent fixture
// of the board rather than whatever scraps are left after standard jobs fill
// up. We reserve a floor of ferry contracts and generate them BEFORE the
// standard top-up so the open-market step fills around them instead of crowding
// them out. MAX_FERRY_TOPUP_PER_TICK ramps them in over a few ticks rather than
// dumping the whole floor at once.
const FERRY_BOARD_TARGET = 4;
const MAX_FERRY_TOPUP_PER_TICK = 2;

const ROLES: Role[] = ["bush", "air_taxi", "light_jet"];

function rngFromCryptoSeed(): () => number {
  // Cheap deterministic-ish RNG seeded from time. Not for cryptographic use; the
  // generator just needs uniform numbers in [0, 1).
  let s = (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function buildAirportsLite(): FerryAirportLite[] {
  // FerryAirportLite is a structural superset of AirportLite (adds
  // hasMaintenance), so callers expecting AirportLite[] accept this directly
  // and we avoid scanning the airports table twice per tick.
  return db.select().from(airports).all().map((a) => ({
    icao: a.icao,
    lat: a.lat,
    lon: a.lon,
    size: a.size,
    hasPavedRunway: a.hasPavedRunway,
    hasMaintenance: a.hasMaintenance,
  }));
}

function buildFerryAircraftTypes(): Array<
  FerryAircraftType & { manufacturer: string; model: string }
> {
  return db
    .select()
    .from(aircraftTypes)
    .all()
    .map((t) => ({
      id: t.id,
      class: t.class,
      cruiseSpeedKts: t.cruiseSpeedKts,
      rangeNm: t.rangeNm,
      basePurchasePriceCents: t.basePurchasePrice,
      manufacturer: t.manufacturer,
      model: t.model,
    }));
}

function loadReputation(): {
  byRole: Record<Role, number>;
  byClient: Record<string, number>;
} {
  const rows = db.select().from(reputation).all();
  const byRole: Record<Role, number> = { bush: 0, air_taxi: 0, light_jet: 0 };
  const byClient: Record<string, number> = {};
  for (const row of rows) {
    if (ROLES.includes(row.scope as Role)) {
      byRole[row.scope as Role] = row.score;
    } else if (row.scope.startsWith("client:")) {
      byClient[row.scope.slice("client:".length)] = row.score;
    }
  }
  return { byRole, byClient };
}

function currentBoardSize(): number {
  const row = db
    .select({ n: count() })
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .get();
  return row?.n ?? 0;
}

function homeOriginJobCount(playerLocationIcao: string): number {
  const row = db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.status, "open"), eq(jobs.originIcao, playerLocationIcao)))
    .get();
  return row?.n ?? 0;
}

// Count of flyable branded jobs currently on the board — open client jobs whose
// required class the player can fly right now. Paired with MIN_BRANDED_JOBS so
// the generator's branded floor only tops up the genuine shortfall. When the
// player has no flyable classes (availableClasses undefined), every branded job
// counts, matching the generator's "flyable = anything" fallback.
function flyableBrandedJobCount(
  availableClasses: AircraftClass[] | undefined,
): number {
  const filters = [
    eq(jobs.status, "open"),
    isNotNull(jobs.clientId),
    ...(availableClasses && availableClasses.length > 0
      ? [inArray(jobs.requiredClass, availableClasses)]
      : []),
  ];
  const row = db
    .select({ n: count() })
    .from(jobs)
    .where(and(...filters))
    .get();
  return row?.n ?? 0;
}

// Player's recent flight count per directed route, for the familiarity ("milk
// run") pay discount. Counts flights that ended within the familiarity window
// off sim time, keyed by `routeKey(origin, dest)`. The generator turns each
// count into a discount; routes the player hasn't flown recently stay at full
// pay. Diversions count toward the route they were *dispatched* on (origin →
// planned destination), which is what the player chose to over-fly.
export function loadRouteFlightCounts(simNow: number): Record<string, number> {
  const windowStart = simNow - FAMILIARITY_WINDOW_SIM_DAYS * SIM_DAY_MS;
  const rows = db
    .select({
      origin: flights.originIcao,
      destination: flights.destinationIcao,
      n: count(),
    })
    .from(flights)
    .where(gte(flights.endedAt, windowStart))
    .groupBy(flights.originIcao, flights.destinationIcao)
    .all();
  const counts: Record<string, number> = {};
  for (const r of rows) counts[routeKey(r.origin, r.destination)] = r.n;
  return counts;
}

// Classes the player can actually fly right now: any aircraft they own that
// isn't sold, plus any rental sitting at their current airport. The generator
// uses this to bias the open-market class roll. Returns undefined when the
// player has zero options anywhere, which falls back to the default uniform
// weights — better than producing an empty board.
function loadPlayerAvailableClasses(
  playerLocationIcao: string,
): AircraftClass[] | undefined {
  const ownedRows = db
    .select({ cls: aircraftTypes.class })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .where(ne(ownedAircraft.status, "sold"))
    .all();
  const rentalRows = db
    .select({ cls: aircraftTypes.class })
    .from(rentalFleet)
    .innerJoin(aircraftTypes, eq(rentalFleet.aircraftTypeId, aircraftTypes.id))
    .where(eq(rentalFleet.airportIcao, playerLocationIcao))
    .all();
  const set = new Set<AircraftClass>();
  for (const r of ownedRows) set.add(r.cls);
  for (const r of rentalRows) set.add(r.cls);
  return set.size > 0 ? [...set] : undefined;
}

function expireStaleJobs(simNow: number): number {
  const result = db
    .update(jobs)
    .set({ status: "expired" })
    .where(and(eq(jobs.status, "open"), lt(jobs.expiresAt, simNow)))
    .run();
  return Number(result.changes ?? 0);
}

function insertFerries(ferries: GeneratedFerry[]): void {
  if (ferries.length === 0) return;
  for (const f of ferries) {
    if (!(f.distanceNm > 0)) {
      throw new Error(
        `Refusing to insert ferry with distanceNm=${f.distanceNm} (${f.originIcao} → ${f.destinationIcao})`,
      );
    }
  }
  db.insert(jobs)
    .values(
      ferries.map((f) => ({
        clientId: null,
        role: "open" as const,
        originIcao: f.originIcao,
        destinationIcao: f.destinationIcao,
        payloadLbs: f.payloadLbs,
        payloadType: "cargo" as const,
        paxCount: f.paxCount,
        requiredClass: f.minClass,
        requiredCapabilitiesJson: JSON.stringify([]),
        pay: f.payCents,
        generatedAt: f.generatedAt,
        // Reuse the latest-departure as expiry: ferries don't sit on the board
        // forever — once the dispatch window closes, the contract goes elsewhere.
        expiresAt: f.scheduleLatest,
        earliestDeparture: f.scheduleEarliest,
        latestDeparture: f.scheduleLatest,
        urgency: f.urgency,
        weatherSensitivity: f.weatherSensitivity,
        legsJson: null,
        description: f.description,
        distanceNm: f.distanceNm,
        status: "open" as const,
        jobType: "ferry" as const,
        ferryAircraftTypeId: f.ferryAircraftTypeId,
        ferryAircraftTail: f.ferryAircraftTail,
        ferrySource: f.ferrySource,
        ferryOwnerName: f.ferryOwnerName,
      })),
    )
    .run();
}

// Generate and insert N ferry jobs immediately, bypassing the standard tick's
// rollFerryCount probability. Used by the seed pre-warm so a brand-new career
// always sees ferry contracts on the board, not subject to RNG variance.
export function seedFerryJobs(
  count: number,
  simNow: number,
  rng: () => number,
): number {
  if (count <= 0) return 0;
  const airports = buildAirportsLite();
  const types = buildFerryAircraftTypes();
  const ferries: GeneratedFerry[] = [];
  for (let i = 0; i < count; i++) {
    const f = generateFerryJob({ airports, aircraftTypes: types, rng, simNow });
    if (f) ferries.push(f);
  }
  insertFerries(ferries);
  return ferries.length;
}

function currentFerryCount(): number {
  const row = db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.status, "open"), eq(jobs.jobType, "ferry")))
    .get();
  return row?.n ?? 0;
}

// Top the board up toward FERRY_BOARD_TARGET open ferry contracts, generating
// at most MAX_FERRY_TOPUP_PER_TICK per tick. Inserts the new ferries and
// returns them. Called BEFORE the standard generation/open-market step so the
// reserved ferry slots aren't consumed by the open-market deficit fill.
function topUpFerries(
  airportsLite: FerryAirportLite[],
  simNow: number,
  rng: () => number,
): GeneratedFerry[] {
  const deficit = Math.max(0, FERRY_BOARD_TARGET - currentFerryCount());
  const want = Math.min(deficit, MAX_FERRY_TOPUP_PER_TICK);
  if (want <= 0) return [];
  const ferryTypes = buildFerryAircraftTypes();
  const ferries: GeneratedFerry[] = [];
  for (let i = 0; i < want; i++) {
    const f = generateFerryJob({
      airports: airportsLite,
      aircraftTypes: ferryTypes,
      rng,
      simNow,
    });
    if (f) ferries.push(f);
  }
  insertFerries(ferries);
  return ferries;
}

function insertGenerated(generated: GeneratedJob[]): void {
  if (generated.length === 0) return;
  // Invariant: every persisted job has distanceNm > 0. The shared generator
  // computes distance via haversine for two distinct airports, so this should
  // never trip — but if it does, fail loud rather than silently writing zero.
  for (const j of generated) {
    if (!(j.distanceNm > 0)) {
      throw new Error(
        `Refusing to insert job with distanceNm=${j.distanceNm} (${j.originIcao} → ${j.destinationIcao})`,
      );
    }
  }
  db.insert(jobs)
    .values(
      generated.map((j) => ({
        clientId: j.clientId,
        role: j.role,
        originIcao: j.originIcao,
        destinationIcao: j.destinationIcao,
        payloadLbs: j.payloadLbs,
        payloadType: j.payloadType,
        paxCount: j.paxCount,
        requiredClass: j.requiredClass,
        requiredCapabilitiesJson: JSON.stringify(j.requiredCapabilities),
        pay: j.pay,
        generatedAt: j.generatedAt,
        expiresAt: j.expiresAt,
        earliestDeparture: j.earliestDeparture,
        latestDeparture: j.latestDeparture,
        urgency: j.urgency,
        weatherSensitivity: j.weatherSensitivity,
        legsJson: j.legs ? JSON.stringify(j.legs) : null,
        description: j.description,
        distanceNm: j.distanceNm,
        status: "open" as const,
      })),
    )
    .run();
}

// Heal jobs that were inserted before distance_nm was a populated column —
// they sit at distance 0 until expired. Recompute from airport coordinates
// for any open job older than 30 sim minutes that still reads zero.
function backfillZeroDistance(simNow: number): number {
  const STALE_MS = 30 * 60 * 1000;
  const candidates = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "open"),
        eq(jobs.distanceNm, 0),
        lt(jobs.generatedAt, simNow - STALE_MS),
      ),
    )
    .all();
  if (candidates.length === 0) return 0;
  const airportRows = db.select().from(airports).all();
  const byIcao = new Map<string, { lat: number; lon: number }>(
    airportRows.map((a) => [a.icao, { lat: a.lat, lon: a.lon }]),
  );
  let healed = 0;
  for (const job of candidates) {
    const o = byIcao.get(job.originIcao);
    const d = byIcao.get(job.destinationIcao);
    if (!o || !d) continue;
    const distance = Math.round(haversineNm(o, d));
    if (distance <= 0) continue;
    db.update(jobs)
      .set({ distanceNm: distance })
      .where(eq(jobs.id, job.id))
      .run();
    healed += 1;
  }
  return healed;
}

export interface TickResult {
  expired: number;
  inserted: number;
  fuelDrift: {
    fired: boolean;
    airportsUpdated: number;
    snapshotsCreated: number;
    shockSpawned: boolean;
    shocksExpired: number;
  };
}

// Fire fuelDrift any time enough sim time has elapsed since the last drift
// (6 sim hours = 12 generation ticks). Reads max(lastDriftAt) from the table
// to stay decoupled from any in-memory counters.
function maybeRunFuelDrift(simNow: number): TickResult["fuelDrift"] {
  ensureFuelPriceCurrent(simNow);
  const rows = db
    .select({ lastDriftAt: fuelPriceCurrent.lastDriftAt })
    .from(fuelPriceCurrent)
    .all();
  if (rows.length === 0) {
    return {
      fired: false,
      airportsUpdated: 0,
      snapshotsCreated: 0,
      shockSpawned: false,
      shocksExpired: 0,
    };
  }
  const latest = rows.reduce(
    (m, r) => (r.lastDriftAt > m ? r.lastDriftAt : m),
    0,
  );
  if (simNow - latest < DRIFT_INTERVAL_MS) {
    return {
      fired: false,
      airportsUpdated: 0,
      snapshotsCreated: 0,
      shockSpawned: false,
      shocksExpired: 0,
    };
  }
  const result = processFuelDriftTick(simNow);
  return {
    fired: true,
    airportsUpdated: result.airportsUpdated,
    snapshotsCreated: result.snapshotsCreated,
    shockSpawned: result.shockEvent != null,
    shocksExpired: result.shocksExpired,
  };
}

export function tickJobGeneration(): TickResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) {
    return {
      expired: 0,
      inserted: 0,
      fuelDrift: {
        fired: false,
        airportsUpdated: 0,
        snapshotsCreated: 0,
        shockSpawned: false,
        shocksExpired: 0,
      },
    };
  }

  // Advance the world clock by the real time elapsed since the last sync, so
  // it tracks wall-clock time 1× and absorbs any offline gap on the first tick
  // after boot. `Math.max(0, …)` guards against a backwards clock (NTP step,
  // manual change) freezing or rewinding the world.
  const realNow = Date.now();
  const realElapsed = Math.max(0, realNow - careerRow.lastClockSyncReal);
  const simNow = careerRow.simDateTime + realElapsed;

  // How much world time this pass generates for — clamped so a long offline
  // gap (or a big abstracted-travel jump) doesn't carpet the board. Measured
  // from the last generation point, not the last tick, so an abstracted-travel
  // jump still produces the work that "happened" while the player repositioned.
  const genElapsedMs = Math.min(
    MAX_GEN_ELAPSED_MS,
    Math.max(0, simNow - careerRow.lastGenSimTime),
  );

  db.update(career)
    .set({
      simDateTime: simNow,
      lastClockSyncReal: realNow,
      lastGenSimTime: simNow,
    })
    .where(eq(career.id, 1))
    .run();

  const expired = expireStaleJobs(simNow);
  backfillZeroDistance(simNow);
  const fuelDrift = maybeRunFuelDrift(simNow);

  const airportsLite = buildAirportsLite();
  const playerLocationIcao = careerRow.currentLocationIcao;
  const rng = rngFromCryptoSeed();
  const reputationMaps = loadReputation();
  const playerAvailableClasses = loadPlayerAvailableClasses(playerLocationIcao);

  // Ferries first: top the board up to the reserved ferry floor before the
  // standard generation runs. Because the open-market step fills toward
  // TARGET_BOARD_SIZE off the live board size, generating ferries now means it
  // fills *around* them rather than consuming the slots they'd otherwise take.
  const ferries = topUpFerries(airportsLite, simNow, rng);

  const generated = runGenerationTick(ALL_CLIENTS, {
    airports: airportsLite,
    reputationByRole: reputationMaps.byRole,
    reputationByClient: reputationMaps.byClient,
    simNow,
    genElapsedMs,
    rng,
    // Includes the ferries just inserted, so the open-market deficit fill
    // reserves their space instead of crowding them out.
    currentBoardSize: currentBoardSize(),
    targetBoardSize: TARGET_BOARD_SIZE,
    maxBoardSize: MAX_BOARD_SIZE,
    minBrandedJobs: MIN_BRANDED_JOBS,
    brandedJobCount: flyableBrandedJobCount(playerAvailableClasses),
    routeFlightCounts: loadRouteFlightCounts(simNow),
    playerLocationIcao,
    homeOriginJobCount: homeOriginJobCount(playerLocationIcao),
    playerAvailableClasses,
  });

  insertGenerated(generated);

  return {
    expired,
    inserted: generated.length + ferries.length,
    fuelDrift,
  };
}

// Run generation ticks until the open board reaches its target size, bounded
// by maxPasses. Used on boot: the single catch-up tick that absorbs an offline
// gap expires every short-window job against the *full* elapsed time but only
// refills the size-capped per-tick amount, so a player returning after an
// overnight gap would otherwise open to a half-empty board that dribbles back
// to target over the next few minutes of 30s ticks. This fills it in one pass.
// The first pass (if any) does the real clock catch-up; later passes advance
// the clock ~0 and add only the open-market/ferry top-ups (genElapsedMs ≈ 0,
// so no extra client jobs).
export function fillBoardToTarget(maxPasses = 8): void {
  for (
    let i = 0;
    i < maxPasses && currentBoardSize() < TARGET_BOARD_SIZE;
    i++
  ) {
    tickJobGeneration();
  }
}

export interface FerryAircraftSummary {
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: "SEP" | "MEP" | "SET" | "JET";
  cruiseSpeedKts: number;
  rangeNm: number;
  fuelType: "avgas" | "jet-a";
  // Carried so the job board can compute the ferry's net $/hr (fuel comes out
  // of the player's pocket on a ferry leg; the aircraft is supplied, but the
  // gas isn't).
  fuelBurnGph: number;
  tail: string;
}

export interface JobListItem {
  id: number;
  clientId: string | null;
  clientName: string | null;
  // The player's current standing with this client (null for ferries and
  // open-market jobs, which have no client relationship). Lets the board badge
  // a job with the relationship that's raising its pay.
  clientStanding: { tier: ReputationTier; score: number } | null;
  role: "bush" | "air_taxi" | "light_jet" | "open";
  originIcao: string;
  destinationIcao: string;
  payloadLbs: number;
  payloadType: "cargo" | "pax" | "medical" | "survey" | "mixed";
  paxCount: number | null;
  requiredClass: "SEP" | "MEP" | "SET" | "JET";
  requiredCapabilities: string[];
  pay: number;
  distanceNm: number;
  generatedAt: number;
  expiresAt: number;
  earliestDeparture: number | null;
  latestDeparture: number | null;
  urgency: "flexible" | "standard" | "urgent" | "critical";
  weatherSensitivity: "none" | "mild" | "strict";
  status: "open" | "accepted" | "in_progress" | "completed" | "expired" | "cancelled";
  jobType: "standard" | "ferry";
  ferrySource: "owner" | "dealer" | "operator" | null;
  ferryOwnerName: string | null;
  ferryAircraft: FerryAircraftSummary | null;
}

type AircraftTypeRow = typeof aircraftTypes.$inferSelect;

function rowToListItem(
  row: typeof jobs.$inferSelect,
  ferryTypeById: Map<string, AircraftTypeRow>,
  repByClient: Record<string, number>,
): JobListItem {
  const client = row.clientId ? getClientById(row.clientId) : undefined;
  let capabilities: string[] = [];
  try {
    capabilities = row.requiredCapabilitiesJson
      ? JSON.parse(row.requiredCapabilitiesJson)
      : [];
  } catch {
    capabilities = [];
  }
  const isFerry = row.jobType === "ferry";
  let ferryAircraft: FerryAircraftSummary | null = null;
  if (isFerry && row.ferryAircraftTypeId && row.ferryAircraftTail) {
    const t = ferryTypeById.get(row.ferryAircraftTypeId);
    if (t) {
      ferryAircraft = {
        aircraftTypeId: t.id,
        manufacturer: t.manufacturer,
        model: t.model,
        cls: t.class,
        cruiseSpeedKts: t.cruiseSpeedKts,
        rangeNm: t.rangeNm,
        fuelType: t.fuelType,
        fuelBurnGph: t.fuelBurnGph,
        tail: row.ferryAircraftTail,
      };
    }
  }
  const clientStanding =
    !isFerry && row.clientId
      ? (() => {
          const score = repByClient[row.clientId] ?? 0;
          return { tier: reputationTier(score), score };
        })()
      : null;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: isFerry ? row.ferryOwnerName : (client?.name ?? null),
    clientStanding,
    role: row.role,
    originIcao: row.originIcao,
    destinationIcao: row.destinationIcao,
    payloadLbs: row.payloadLbs,
    payloadType: row.payloadType,
    paxCount: row.paxCount,
    requiredClass: row.requiredClass,
    requiredCapabilities: capabilities,
    pay: row.pay,
    distanceNm: row.distanceNm,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
    earliestDeparture: row.earliestDeparture,
    latestDeparture: row.latestDeparture,
    urgency: row.urgency,
    weatherSensitivity: row.weatherSensitivity,
    status: row.status,
    jobType: row.jobType,
    ferrySource: row.ferrySource ?? null,
    ferryOwnerName: row.ferryOwnerName ?? null,
    ferryAircraft,
  };
}

function loadFerryTypeMap(
  rows: ReadonlyArray<typeof jobs.$inferSelect>,
): Map<string, AircraftTypeRow> {
  const ferryTypeIds = new Set<string>();
  for (const row of rows) {
    if (row.jobType === "ferry" && row.ferryAircraftTypeId) {
      ferryTypeIds.add(row.ferryAircraftTypeId);
    }
  }
  const map = new Map<string, AircraftTypeRow>();
  if (ferryTypeIds.size === 0) return map;
  const types = db
    .select()
    .from(aircraftTypes)
    .where(inArray(aircraftTypes.id, [...ferryTypeIds]))
    .all();
  for (const t of types) map.set(t.id, t);
  return map;
}

export function getOpenJobs(): JobListItem[] {
  const rows = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .all();
  rows.sort((a, b) => b.generatedAt - a.generatedAt);
  const ferryTypeById = loadFerryTypeMap(rows);
  const repByClient = loadReputation().byClient;
  return rows.map((row) => rowToListItem(row, ferryTypeById, repByClient));
}

export interface JobListItemWithReachability extends JobListItem {
  reachability: JobReachability;
  // Per-row fit summary used by the job board to render the compatibility
  // glyph + tooltip + pay/hour column without the player having to open the
  // drawer. Ferries are reported as "locked" when the player lacks the
  // class rating, "ready" when at the origin, and "reposition" otherwise —
  // the dispatched aircraft is supplied so payload/range checks don't apply.
  fit: JobFit;
}

export interface FleetReadoutAircraft {
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: AircraftClass;
  maxPayloadLbs: number;
  rangeNm: number;
  cruiseSpeedKts: number;
}

export interface FleetReadout {
  ownedHere: Array<FleetReadoutAircraft & { tailNumber: string }>;
  ownedElsewhere: number;
  rentalsHere: Array<FleetReadoutAircraft & { rentalRatePerHour: number }>;
}

// Compact active-job summary surfaced on the board so the UI can switch
// context without a second tRPC round-trip. The full ActiveJobSnapshot
// (drawer / in-flight surface needs it) stays at lifecycle.getActiveJob.
export interface JobBoardActiveJobSummary {
  jobId: number;
  state: "accepted" | "briefed" | "in_progress";
  originIcao: string;
  destinationIcao: string;
  clientName: string | null;
  jobType: "standard" | "ferry";
  // Sim-time ms at which the player would arrive at destinationIcao, given
  // cruise + distance. Null when we can't compute (no aircraft snapshot, no
  // cruise speed). Used to caption the rec card with something more concrete
  // than "after arrival".
  etaSimMs: number | null;
}

export interface JobBoardWithReachability {
  jobs: JobListItemWithReachability[];
  playerLocationIcao: string;
  simNow: number;
  fleet: FleetReadout;
  // The single "best for you" job. The web app highlights this row. null
  // when nothing scores well (e.g. board empty, or everything is locked /
  // expiring soon / weather-strict).
  recommendedJobId: number | null;
  // Set when the player has accepted/briefed/in-flight on a contract. When
  // present, recommendedJobId is computed from the active job's destination
  // (best $/hr awaiting you when you land), not your current physical
  // location. The web app uses this to render a slim banner above the rec
  // card so the board doesn't pretend you're free.
  activeJob: JobBoardActiveJobSummary | null;
}

export function getOpenJobsWithReachability(): JobBoardWithReachability {
  const items = getOpenJobs();

  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) {
    const emptyFit: JobFit = {
      status: "locked",
      reason: "No career",
      bestAircraftTypeId: null,
      bestCruiseSpeedKts: null,
      positioningDistanceNm: null,
      payHourCents: null,
      netPayHourCents: null,
      fuelCostCents: 0,
      rentalCostCents: 0,
    };
    return {
      jobs: items.map((j) => ({
        ...j,
        reachability: { status: "unreachable" },
        fit: emptyFit,
      })),
      playerLocationIcao: "",
      simNow: Date.now(),
      fleet: { ownedHere: [], ownedElsewhere: 0, rentalsHere: [] },
      recommendedJobId: null,
      activeJob: null,
    };
  }

  const playerLocationIcao = careerRow.currentLocationIcao;
  const simNow = careerRow.simDateTime;

  const ratingRows = db.select().from(ratings).all();
  const playerRatings: Record<AircraftClass, boolean> = {
    SEP: false,
    MEP: false,
    SET: false,
    JET: false,
  };
  for (const r of ratingRows) {
    playerRatings[r.class] = r.earned;
  }

  const ownedRows = db
    .select({ owned: ownedAircraft, type: aircraftTypes })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .where(ne(ownedAircraft.status, "sold"))
    .all();
  // Reachability context (range-only). Kept separate so the existing drawer
  // contract doesn't change shape.
  const ownedAircraftCtx = ownedRows.map(({ owned, type }) => ({
    aircraftTypeId: type.id,
    currentLocationIcao: owned.currentLocationIcao,
    cls: type.class,
    rangeNm: type.rangeNm,
    isAvailable: owned.status === "available",
  }));
  // Fit context — richer, includes payload, cruise, and unpaved capability,
  // plus the cost inputs (fuel burn + type, rental rate) that feed
  // netPayHourCents.
  const ownedAircraftFit: FitOwnedAircraft[] = ownedRows.map(
    ({ owned, type }) => ({
      aircraftTypeId: type.id,
      currentLocationIcao: owned.currentLocationIcao,
      cls: type.class,
      rangeNm: type.rangeNm,
      cruiseSpeedKts: type.cruiseSpeedKts,
      maxPayloadLbs: type.maxPayloadLbs,
      unpavedCapable: type.unpavedCapable,
      isAvailable: owned.status === "available",
      fuelBurnGph: type.fuelBurnGph,
      fuelType: type.fuelType,
    }),
  );

  const rentalRows = db
    .select({ rental: rentalFleet, type: aircraftTypes })
    .from(rentalFleet)
    .innerJoin(aircraftTypes, eq(rentalFleet.aircraftTypeId, aircraftTypes.id))
    .where(eq(rentalFleet.airportIcao, playerLocationIcao))
    .all();
  const rentalsAtPlayerLocation = rentalRows.map(({ type }) => ({
    aircraftTypeId: type.id,
    cls: type.class,
    rangeNm: type.rangeNm,
  }));
  const rentalsFit: FitRentalAircraft[] = rentalRows.map(({ type }) => ({
    aircraftTypeId: type.id,
    cls: type.class,
    rangeNm: type.rangeNm,
    cruiseSpeedKts: type.cruiseSpeedKts,
    maxPayloadLbs: type.maxPayloadLbs,
    unpavedCapable: type.unpavedCapable,
    fuelBurnGph: type.fuelBurnGph,
    fuelType: type.fuelType,
    rentalRatePerHour: type.rentalRatePerHour,
  }));

  // Live fuel prices at the player's location, both fuel types. Keyed
  // `${icao}:${fuelType}` to match what JobFitContext expects. Missing rows
  // (drift never ran, fuel type not stocked) fall through to the fit
  // calculator, which leaves fuelCostCents at 0 — better to under-cost than
  // surface a fake price.
  const fuelPriceRows = db
    .select()
    .from(fuelPriceCurrent)
    .where(eq(fuelPriceCurrent.airportIcao, playerLocationIcao))
    .all();
  const fuelPricesByIcao = new Map<string, number>();
  for (const r of fuelPriceRows) {
    fuelPricesByIcao.set(
      `${r.airportIcao}:${r.fuelType}`,
      r.currentPriceCents,
    );
  }

  const airportRows = db.select().from(airports).all();
  // Reachability uses lat/lon only; fit also needs the paved-runway flag so
  // it can require unpaved-capable aircraft for jobs that touch a dirt strip.
  const airportMap = new Map<string, { lat: number; lon: number }>(
    airportRows.map((a) => [a.icao, { lat: a.lat, lon: a.lon }]),
  );
  const fitAirportMap = new Map<string, FitAirport>(
    airportRows.map((a) => [
      a.icao,
      { lat: a.lat, lon: a.lon, hasPavedRunway: a.hasPavedRunway },
    ]),
  );

  const enriched = items.map<JobListItemWithReachability>((job) => {
    // Ferries don't need an owned/rental aircraft to reach the origin —
    // the contract aircraft is provided. Reachability collapses to a
    // commercial-travel question: are you at the origin or not?
    if (job.jobType === "ferry") {
      const hasRating = playerRatings[job.requiredClass];
      if (!hasRating) {
        return {
          ...job,
          reachability: { status: "unreachable" },
          fit: {
            status: "locked",
            reason: `Needs ${job.requiredClass} rating`,
            bestAircraftTypeId: job.ferryAircraft?.aircraftTypeId ?? null,
            bestCruiseSpeedKts: job.ferryAircraft?.cruiseSpeedKts ?? null,
            positioningDistanceNm: null,
            payHourCents: null,
            netPayHourCents: null,
            fuelCostCents: 0,
            rentalCostCents: 0,
          },
        };
      }
      const cruise = job.ferryAircraft?.cruiseSpeedKts ?? 0;
      // Net price the ferry leg using the player-location fuel price. Ferry
      // aircraft is supplied (no rental cost), but the player pays for the
      // gas to fly it.
      const ferryPrice =
        cruise > 0 && job.ferryAircraft
          ? priceFerryLeg(
              job.pay,
              job.distanceNm,
              cruise,
              job.ferryAircraft.fuelBurnGph,
              job.ferryAircraft.fuelType,
              playerLocationIcao,
              fuelPricesByIcao,
            )
          : null;
      if (job.originIcao === playerLocationIcao) {
        return {
          ...job,
          reachability: { status: "at_origin" },
          fit: {
            status: "ready",
            reason: "Ferry aircraft at origin",
            bestAircraftTypeId: job.ferryAircraft?.aircraftTypeId ?? null,
            bestCruiseSpeedKts: cruise || null,
            positioningDistanceNm: null,
            payHourCents: ferryPrice?.payHourCents ?? null,
            netPayHourCents: ferryPrice?.netPayHourCents ?? null,
            fuelCostCents: ferryPrice?.fuelCostCents ?? 0,
            rentalCostCents: 0,
          },
        };
      }
      const ap1 = airportMap.get(playerLocationIcao);
      const ap2 = airportMap.get(job.originIcao);
      const distance =
        ap1 && ap2 ? Math.round(haversineNm(ap1, ap2)) : undefined;
      // Ferries do not use the player's rentals for positioning — the
      // player buys a commercial ticket to the origin. So pay/hour for a
      // ferry leg is just the flight time, not flight + positioning.
      return {
        ...job,
        reachability: {
          status: "reposition_rental",
          ...(distance != null ? { positioningDistanceNm: distance } : {}),
        },
        fit: {
          status: "reposition",
          reason:
            distance != null ? `Travel ${distance} nm to origin` : "Travel to origin",
          bestAircraftTypeId: job.ferryAircraft?.aircraftTypeId ?? null,
          bestCruiseSpeedKts: cruise || null,
          positioningDistanceNm: distance ?? null,
          payHourCents: ferryPrice?.payHourCents ?? null,
          netPayHourCents: ferryPrice?.netPayHourCents ?? null,
          fuelCostCents: ferryPrice?.fuelCostCents ?? 0,
          rentalCostCents: 0,
        },
      };
    }

    const reachability = computeReachability(
      {
        originIcao: job.originIcao,
        requiredClass: job.requiredClass,
        requiredCapabilities: job.requiredCapabilities,
      },
      {
        playerLocationIcao,
        playerRatings,
        ownedAircraft: ownedAircraftCtx,
        rentalsAtPlayerLocation,
        airports: airportMap,
      },
    );

    const fit = computeJobFit(
      {
        originIcao: job.originIcao,
        destinationIcao: job.destinationIcao,
        distanceNm: job.distanceNm,
        payloadLbs: job.payloadLbs,
        requiredClass: job.requiredClass,
        requiredCapabilities: job.requiredCapabilities,
        pay: job.pay,
      },
      {
        playerLocationIcao,
        playerRatings,
        ownedAircraft: ownedAircraftFit,
        rentalsAtPlayerLocation: rentalsFit,
        airports: fitAirportMap,
        fuelPricesByIcao,
      },
    );

    return { ...job, reachability, fit };
  });

  // Fleet readout: what the player can fly *right now*, surfaced in the
  // strip above the filters so they don't have to remember payload/range
  // numbers while scanning the board.
  const ownedHere = ownedRows
    .filter(({ owned }) => owned.currentLocationIcao === playerLocationIcao)
    .map(({ owned, type }) => ({
      aircraftTypeId: type.id,
      manufacturer: type.manufacturer,
      model: type.model,
      cls: type.class,
      maxPayloadLbs: type.maxPayloadLbs,
      rangeNm: type.rangeNm,
      cruiseSpeedKts: type.cruiseSpeedKts,
      tailNumber: owned.tailNumber,
    }));
  const ownedElsewhere = ownedRows.filter(
    ({ owned }) => owned.currentLocationIcao !== playerLocationIcao,
  ).length;
  const rentalsHere = rentalRows.map(({ type }) => ({
    aircraftTypeId: type.id,
    manufacturer: type.manufacturer,
    model: type.model,
    cls: type.class,
    maxPayloadLbs: type.maxPayloadLbs,
    rangeNm: type.rangeNm,
    cruiseSpeedKts: type.cruiseSpeedKts,
    rentalRatePerHour: type.rentalRatePerHour,
  }));

  // Active job → board summary. The full snapshot lives at
  // lifecycle.getActiveJob; here we only need enough to drive the banner +
  // recommendation pivot. Inlined to avoid a circular import with the
  // lifecycle service (jobLifecycle/active.ts already depends on this file's
  // siblings).
  const activeJob: JobBoardActiveJobSummary | null = (() => {
    if (
      careerRow.activeJobId == null ||
      careerRow.activeFlightState == null
    ) {
      return null;
    }
    const jobRow = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, careerRow.activeJobId))
      .get();
    if (!jobRow) return null;
    // ETA: only meaningful when we know the cruise speed of the dispatched
    // aircraft. flightStartedAt + (distanceNm / cruise) is the in-flight ETA;
    // for accepted/briefed we use simNow + flight time as a proxy "would
    // arrive in X" hint.
    let etaSimMs: number | null = null;
    const typeId = (() => {
      if (
        careerRow.activeAircraftSource === "owned" &&
        careerRow.activeAircraftOwnedId != null
      ) {
        const ownedRow = db
          .select()
          .from(ownedAircraft)
          .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
          .get();
        return ownedRow?.aircraftTypeId ?? null;
      }
      return careerRow.activeAircraftRentalTypeId ?? null;
    })();
    if (typeId) {
      const t = db
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, typeId))
        .get();
      if (t && t.cruiseSpeedKts > 0) {
        const flightHrs = jobRow.distanceNm / t.cruiseSpeedKts;
        const start = careerRow.flightStartedAt ?? simNow;
        etaSimMs = Math.round(start + flightHrs * 60 * 60 * 1000);
      }
    }
    return {
      jobId: jobRow.id,
      state: careerRow.activeFlightState,
      originIcao: jobRow.originIcao,
      destinationIcao: jobRow.destinationIcao,
      clientName: jobRow.ferryOwnerName ?? null,
      jobType: jobRow.jobType,
      etaSimMs,
    };
  })();

  // Hydrate a friendlier client name from the client registry when we have
  // an id, falling back to the ferry-owner name already on the row.
  if (activeJob && activeJob.clientName == null) {
    const jobRow = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, activeJob.jobId))
      .get();
    if (jobRow?.clientId) {
      const client = getClientById(jobRow.clientId);
      if (client) activeJob.clientName = client.name;
    }
  }

  const recommendedJobId = pickRecommendedJobId(
    enriched.map((j) => ({
      id: j.id,
      originIcao: j.originIcao,
      fit: j.fit,
      expiresAt: j.expiresAt,
      weatherSensitivity: j.weatherSensitivity,
    })),
    {
      playerLocationIcao,
      simNow,
      ...(activeJob
        ? { pivotOriginIcao: activeJob.destinationIcao }
        : {}),
    },
  );

  return {
    jobs: enriched,
    playerLocationIcao,
    simNow,
    fleet: { ownedHere, ownedElsewhere, rentalsHere },
    recommendedJobId,
    activeJob,
  };
}

export interface JobDetail extends JobListItem {
  description: string;
  clientDescription: string | null;
  originName: string | null;
  originLat: number | null;
  originLon: number | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLon: number | null;
}

export function getJobById(id: number): JobDetail | null {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) return null;
  const ferryTypeById = loadFerryTypeMap([row]);
  const list = rowToListItem(row, ferryTypeById, loadReputation().byClient);
  const client = row.clientId ? getClientById(row.clientId) : undefined;
  const originAp = db
    .select()
    .from(airports)
    .where(eq(airports.icao, row.originIcao))
    .get();
  const destAp = db
    .select()
    .from(airports)
    .where(eq(airports.icao, row.destinationIcao))
    .get();

  return {
    ...list,
    description: row.description,
    clientDescription: client?.description ?? null,
    originName: originAp?.name ?? null,
    originLat: originAp?.lat ?? null,
    originLon: originAp?.lon ?? null,
    destinationName: destAp?.name ?? null,
    destinationLat: destAp?.lat ?? null,
    destinationLon: destAp?.lon ?? null,
  };
}
