import {
  ALL_CLIENTS,
  computeReachability,
  generateFerryJob,
  getClientById,
  haversineNm,
  runGenerationTick,
  type AircraftClass,
  type FerryAircraftType,
  type FerryAirportLite,
  type GeneratedFerry,
  type GeneratedJob,
  type JobReachability,
  type Role,
} from "@flightcareer/shared";
import { and, count, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
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
const SIM_MINUTES_PER_TICK = 30;

// Tunable: target proportion of new jobs that are ferry/repositioning jobs.
const FERRY_JOB_PROPORTION = 0.3;

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

function rollFerryCount(
  standardCount: number,
  deficit: number,
  rng: () => number,
): number {
  if (deficit <= 0) return 0;
  // Solve f / (s + f) = p ⇒ f = s · p / (1−p). The fractional part rounds
  // stochastically so the long-run mix tracks FERRY_JOB_PROPORTION.
  const ratio = FERRY_JOB_PROPORTION / (1 - FERRY_JOB_PROPORTION);
  const target = standardCount * ratio;
  const whole = Math.floor(target);
  const frac = target - whole;
  let count = whole + (rng() < frac ? 1 : 0);
  // Quiet ticks (board near full, no standard jobs created) still occasionally
  // surface a ferry — without this the board can sit ferry-free for a while.
  if (standardCount === 0 && rng() < FERRY_JOB_PROPORTION) count = 1;
  return Math.max(0, Math.min(deficit, count));
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

  // Advance sim clock by 30 simulated minutes per tick. Without this, jobs
  // never age past their expiresAt and the board freezes once it fills.
  const simNow = careerRow.simDateTime + SIM_MINUTES_PER_TICK * 60_000;
  db.update(career).set({ simDateTime: simNow }).where(eq(career.id, 1)).run();

  const expired = expireStaleJobs(simNow);
  backfillZeroDistance(simNow);
  const fuelDrift = maybeRunFuelDrift(simNow);

  const airportsLite = buildAirportsLite();
  const playerLocationIcao = careerRow.currentLocationIcao;
  const rng = rngFromCryptoSeed();
  const reputationMaps = loadReputation();
  const generated = runGenerationTick(ALL_CLIENTS, {
    airports: airportsLite,
    reputationByRole: reputationMaps.byRole,
    reputationByClient: reputationMaps.byClient,
    simNow,
    rng,
    currentBoardSize: currentBoardSize(),
    targetBoardSize: TARGET_BOARD_SIZE,
    playerLocationIcao,
    homeOriginJobCount: homeOriginJobCount(playerLocationIcao),
  });

  insertGenerated(generated);

  // Mix in ferry/repositioning jobs to about FERRY_JOB_PROPORTION of new jobs.
  // Capped to remaining board deficit so a busy board doesn't blow past target.
  // currentBoardSize() re-queries post-insert so it already includes the
  // standard jobs we just persisted — don't double-subtract.
  const remainingDeficit = Math.max(
    0,
    TARGET_BOARD_SIZE - currentBoardSize(),
  );
  const ferryCount = rollFerryCount(generated.length, remainingDeficit, rng);
  const ferries: GeneratedFerry[] = [];
  if (ferryCount > 0) {
    const ferryTypes = buildFerryAircraftTypes();
    for (let i = 0; i < ferryCount; i++) {
      const f = generateFerryJob({
        airports: airportsLite,
        aircraftTypes: ferryTypes,
        rng,
        simNow,
      });
      if (f) ferries.push(f);
    }
    insertFerries(ferries);
  }

  return {
    expired,
    inserted: generated.length + ferries.length,
    fuelDrift,
  };
}

export interface FerryAircraftSummary {
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: "SEP" | "MEP" | "SET" | "JET";
  cruiseSpeedKts: number;
  rangeNm: number;
  fuelType: "avgas" | "jet-a";
  tail: string;
}

export interface JobListItem {
  id: number;
  clientId: string | null;
  clientName: string | null;
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
        tail: row.ferryAircraftTail,
      };
    }
  }
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: isFerry ? row.ferryOwnerName : (client?.name ?? null),
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
  return rows.map((row) => rowToListItem(row, ferryTypeById));
}

export interface JobListItemWithReachability extends JobListItem {
  reachability: JobReachability;
}

export interface JobBoardWithReachability {
  jobs: JobListItemWithReachability[];
  playerLocationIcao: string;
}

export function getOpenJobsWithReachability(): JobBoardWithReachability {
  const items = getOpenJobs();

  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) {
    return {
      jobs: items.map((j) => ({ ...j, reachability: { status: "unreachable" } })),
      playerLocationIcao: "",
    };
  }

  const playerLocationIcao = careerRow.currentLocationIcao;

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
  const ownedAircraftCtx = ownedRows.map(({ owned, type }) => ({
    aircraftTypeId: type.id,
    currentLocationIcao: owned.currentLocationIcao,
    cls: type.class,
    rangeNm: type.rangeNm,
    isAvailable: owned.status === "available",
  }));

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

  const airportRows = db.select().from(airports).all();
  const airportMap = new Map<string, { lat: number; lon: number }>(
    airportRows.map((a) => [a.icao, { lat: a.lat, lon: a.lon }]),
  );

  const enriched = items.map<JobListItemWithReachability>((job) => {
    // Ferries don't need an owned/rental aircraft to reach the origin —
    // the contract aircraft is provided. Reachability collapses to a
    // commercial-travel question: are you at the origin or not?
    if (job.jobType === "ferry") {
      if (!playerRatings[job.requiredClass]) {
        return { ...job, reachability: { status: "unreachable" } };
      }
      if (job.originIcao === playerLocationIcao) {
        return { ...job, reachability: { status: "at_origin" } };
      }
      const ap1 = airportMap.get(playerLocationIcao);
      const ap2 = airportMap.get(job.originIcao);
      const distance =
        ap1 && ap2
          ? Math.round(haversineNm(ap1, ap2))
          : undefined;
      return {
        ...job,
        reachability: {
          status: "reposition_rental",
          ...(distance != null ? { positioningDistanceNm: distance } : {}),
        },
      };
    }
    return {
      ...job,
      reachability: computeReachability(
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
      ),
    };
  });

  return { jobs: enriched, playerLocationIcao };
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
  const list = rowToListItem(row, ferryTypeById);
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
