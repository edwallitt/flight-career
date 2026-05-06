import { ALL_CLIENTS } from "@flightcareer/shared";
import { desc, eq, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  flights,
  jobs,
  ownedAircraft,
} from "../db/schema.js";
import { fuelPriceCentsPerGal } from "./jobLifecycle.js";
import { getSimNow } from "./logbook.js";

const RECENT_FLIGHT_WINDOW_DAYS = 30;
const RECENT_FLIGHT_WINDOW_MS = RECENT_FLIGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MAX_JOBS = 30;

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

export function getAtlasData(): AtlasData {
  const simNow = getSimNow();

  const airportRows = db.select().from(airports).all();

  // TODO: Wire up periodic fuel_price_snapshots ticks (random walk every
  // ~6 sim hours). For now we compute prices on-the-fly from the static
  // multiplier so the Atlas can render a meaningful overlay; prices won't
  // drift over time yet.
  const atlasAirports: AtlasAirport[] = airportRows.map((a) => ({
    icao: a.icao,
    name: a.name,
    country: a.country,
    region: a.region,
    lat: a.lat,
    lon: a.lon,
    size: a.size,
    longestRunwayFt: a.longestRunwayFt,
    fuelPriceAvgas: a.hasAvgas
      ? fuelPriceCentsPerGal("avgas", a.baseFuelMultiplier)
      : null,
    fuelPriceJetA: a.hasJetA
      ? fuelPriceCentsPerGal("jet-a", a.baseFuelMultiplier)
      : null,
    hasMaintenance: a.hasMaintenance,
    hasFbo: a.hasFbo,
  }));

  const airportByIcao = new Map(atlasAirports.map((a) => [a.icao, a]));

  const ownedRows = db
    .select({ owned: ownedAircraft, type: aircraftTypes, ap: airports })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .innerJoin(airports, eq(ownedAircraft.currentLocationIcao, airports.icao))
    .all();

  const atlasOwned: AtlasOwnedAircraft[] = ownedRows.map(({ owned, type, ap }) => ({
    id: owned.id,
    tailNumber: owned.tailNumber,
    aircraftTypeLabel: `${type.manufacturer} ${type.model}`,
    aircraftClass: type.class,
    currentLocationIcao: owned.currentLocationIcao,
    currentLocationName: ap.name,
    lat: ap.lat,
    lon: ap.lon,
    status: owned.status,
    airframeHours: owned.airframeHours,
    engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
    tboHours: type.tboHours,
  }));

  const flightCutoff = simNow - RECENT_FLIGHT_WINDOW_MS;
  const flightRows = db
    .select({
      flight: flights,
      rentalType: aircraftTypes,
    })
    .from(flights)
    .leftJoin(aircraftTypes, eq(flights.rentalAircraftTypeId, aircraftTypes.id))
    .where(gte(flights.endedAt, flightCutoff))
    .orderBy(desc(flights.endedAt))
    .all();

  // Resolve owned-aircraft labels separately (a left join chain on the same
  // table gets noisy; one extra fetch keeps it readable).
  const ownedById = new Map<number, { type: typeof aircraftTypes.$inferSelect }>();
  if (flightRows.some((r) => r.flight.ownedAircraftId != null)) {
    const ownedFlightRows = db
      .select({ owned: ownedAircraft, type: aircraftTypes })
      .from(ownedAircraft)
      .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
      .all();
    for (const r of ownedFlightRows) ownedById.set(r.owned.id, { type: r.type });
  }

  const recentFlights: AtlasRecentFlight[] = [];
  for (const { flight, rentalType } of flightRows) {
    const from = airportByIcao.get(flight.originIcao);
    const to = airportByIcao.get(flight.destinationIcao);
    if (!from || !to) continue;

    let label = "Aircraft";
    if (flight.ownedAircraftId != null) {
      const o = ownedById.get(flight.ownedAircraftId);
      if (o) label = `${o.type.manufacturer} ${o.type.model}`;
    } else if (rentalType) {
      label = `${rentalType.manufacturer} ${rentalType.model}`;
    }

    const ageMs = Math.max(0, simNow - flight.endedAt);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    recentFlights.push({
      id: flight.id,
      fromIcao: flight.originIcao,
      toIcao: flight.destinationIcao,
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
      endedAt: flight.endedAt,
      ageDays,
      netCents: flight.totalRevenue - flight.totalCost,
      blockTimeMinutes: flight.blockTimeMinutes,
      aircraftLabel: label,
    });
  }

  const jobRows = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .orderBy(desc(jobs.generatedAt))
    .limit(MAX_JOBS)
    .all();

  const clientById = new Map(ALL_CLIENTS.map((c) => [c.id, c]));

  const atlasJobs: AtlasJob[] = [];
  for (const j of jobRows) {
    const origin = airportByIcao.get(j.originIcao);
    const dest = airportByIcao.get(j.destinationIcao);
    if (!origin || !dest) continue;
    const client = j.clientId ? clientById.get(j.clientId) : undefined;
    atlasJobs.push({
      id: j.id,
      originIcao: j.originIcao,
      originLat: origin.lat,
      originLon: origin.lon,
      originName: origin.name,
      destinationIcao: j.destinationIcao,
      destinationLat: dest.lat,
      destinationLon: dest.lon,
      destinationName: dest.name,
      distanceNm: Math.round(j.distanceNm),
      role: j.role,
      requiredClass: j.requiredClass,
      urgency: j.urgency,
      weatherSensitivity: j.weatherSensitivity,
      pay: j.pay,
      clientId: j.clientId,
      clientName: client?.name ?? null,
      description: j.description,
    });
  }

  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  let player: AtlasPlayer | null = null;
  if (careerRow) {
    const ap = airportByIcao.get(careerRow.currentLocationIcao);
    if (ap) {
      player = {
        currentLocationIcao: careerRow.currentLocationIcao,
        currentLocationName: ap.name,
        lat: ap.lat,
        lon: ap.lon,
        simDateTime: careerRow.simDateTime,
      };
    }
  }

  return {
    airports: atlasAirports,
    ownedAircraft: atlasOwned,
    recentFlights,
    jobs: atlasJobs,
    player,
  };
}
