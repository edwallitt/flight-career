import {
  ALL_CLIENTS,
  computeReachability,
  getClientById,
  runGenerationTick,
  type AircraftClass,
  type AirportLite,
  type GeneratedJob,
  type JobReachability,
  type Role,
} from "@flightcareer/shared";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
  reputation,
} from "../db/schema.js";

const TARGET_BOARD_SIZE = 12;
const SIM_MINUTES_PER_TICK = 30;

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

function buildAirportsLite(): AirportLite[] {
  return db.select().from(airports).all().map((a) => ({
    icao: a.icao,
    lat: a.lat,
    lon: a.lon,
    size: a.size,
    hasPavedRunway: a.hasPavedRunway,
  }));
}

function loadReputationByRole(): Record<Role, number> {
  const rows = db.select().from(reputation).all();
  const out: Record<Role, number> = { bush: 0, air_taxi: 0, light_jet: 0 };
  for (const row of rows) {
    if (ROLES.includes(row.scope as Role)) {
      out[row.scope as Role] = row.score;
    }
  }
  return out;
}

function loadReputationByClient(): Record<string, number> {
  const rows = db.select().from(reputation).all();
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.scope.startsWith("client:")) {
      out[row.scope.slice("client:".length)] = row.score;
    }
  }
  return out;
}

function currentBoardSize(): number {
  return db.select().from(jobs).where(eq(jobs.status, "open")).all().length;
}

function expireStaleJobs(simNow: number): number {
  const result = db
    .update(jobs)
    .set({ status: "expired" })
    .where(and(eq(jobs.status, "open"), lt(jobs.expiresAt, simNow)))
    .run();
  return Number(result.changes ?? 0);
}

function insertGenerated(generated: GeneratedJob[]): void {
  if (generated.length === 0) return;
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

export interface TickResult {
  expired: number;
  inserted: number;
}

export function tickJobGeneration(): TickResult {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) {
    return { expired: 0, inserted: 0 };
  }

  // Advance sim clock by 30 simulated minutes per tick. Without this, jobs
  // never age past their expiresAt and the board freezes once it fills.
  const simNow = careerRow.simDateTime + SIM_MINUTES_PER_TICK * 60_000;
  db.update(career).set({ simDateTime: simNow }).where(eq(career.id, 1)).run();

  const expired = expireStaleJobs(simNow);

  const airportsLite = buildAirportsLite();
  const generated = runGenerationTick(ALL_CLIENTS, {
    airports: airportsLite,
    reputationByRole: loadReputationByRole(),
    reputationByClient: loadReputationByClient(),
    simNow,
    rng: rngFromCryptoSeed(),
    currentBoardSize: currentBoardSize(),
    targetBoardSize: TARGET_BOARD_SIZE,
  });

  insertGenerated(generated);

  return { expired, inserted: generated.length };
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
}

function rowToListItem(row: typeof jobs.$inferSelect): JobListItem {
  const client = row.clientId ? getClientById(row.clientId) : undefined;
  let capabilities: string[] = [];
  try {
    capabilities = row.requiredCapabilitiesJson
      ? JSON.parse(row.requiredCapabilitiesJson)
      : [];
  } catch {
    capabilities = [];
  }
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: client?.name ?? null,
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
  };
}

export function getOpenJobs(): JobListItem[] {
  const rows = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .all();
  rows.sort((a, b) => b.generatedAt - a.generatedAt);
  return rows.map(rowToListItem);
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

  const enriched = items.map<JobListItemWithReachability>((job) => ({
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
  }));

  return { jobs: enriched, playerLocationIcao };
}

export interface JobDetail extends JobListItem {
  description: string;
  clientDescription: string | null;
  originName: string | null;
  destinationName: string | null;
}

export function getJobById(id: number): JobDetail | null {
  const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) return null;
  const list = rowToListItem(row);
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
    destinationName: destAp?.name ?? null,
  };
}
