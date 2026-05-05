import {
  rankCandidates,
  type AircraftCandidate,
  type EligibilityAirport,
  type JobRequirements,
  type PlayerState,
  type RankedCandidate,
  haversineNm,
} from "@flightcareer/shared";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
} from "../db/schema.js";

export interface CandidateDisplay {
  manufacturer: string;
  model: string;
  cruiseSpeedKts: number;
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
  rentalRatePerHour: number;
}

export interface RankedCandidateWithDisplay extends RankedCandidate {
  display: CandidateDisplay;
}

export interface CandidatesForJobResult {
  jobId: number;
  job: JobRequirements;
  player: PlayerState;
  ranked: RankedCandidateWithDisplay[];
}

function loadPlayer(): PlayerState | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;

  const ratingRows = db.select().from(ratings).all();
  const r: PlayerState["ratings"] = {
    SEP: false,
    MEP: false,
    SET: false,
    JET: false,
  };
  for (const row of ratingRows) {
    r[row.class] = row.earned;
  }
  return { ratings: r, currentLocationIcao: careerRow.currentLocationIcao };
}

function loadAirportMap(): Map<string, EligibilityAirport> {
  const rows = db.select().from(airports).all();
  return new Map(
    rows.map((a) => [
      a.icao,
      {
        icao: a.icao,
        hasPavedRunway: a.hasPavedRunway,
        longestRunwayFt: a.longestRunwayFt,
      },
    ]),
  );
}

function jobRequirements(
  row: typeof jobs.$inferSelect,
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
): JobRequirements {
  let caps: string[] = [];
  try {
    caps = row.requiredCapabilitiesJson
      ? JSON.parse(row.requiredCapabilitiesJson)
      : [];
  } catch {
    caps = [];
  }
  return {
    originIcao: row.originIcao,
    destinationIcao: row.destinationIcao,
    distanceNm: haversineNm(
      { lat: originLat, lon: originLon },
      { lat: destLat, lon: destLon },
    ),
    payloadLbs: row.payloadLbs,
    requiredClass: row.requiredClass,
    requiredCapabilities: caps,
  };
}

function loadCandidates(
  jobOriginIcao: string,
  playerLocationIcao: string,
): AircraftCandidate[] {
  // Owned aircraft, joined with their type. Available means status === 'available'.
  const ownedRows = db
    .select({ owned: ownedAircraft, type: aircraftTypes })
    .from(ownedAircraft)
    .innerJoin(aircraftTypes, eq(ownedAircraft.aircraftTypeId, aircraftTypes.id))
    .all();

  const owned: AircraftCandidate[] = ownedRows.map(({ owned, type }) => ({
    source: "owned",
    ownedAircraftId: owned.id,
    aircraftTypeId: type.id,
    tailNumber: owned.tailNumber,
    currentLocationIcao: owned.currentLocationIcao,
    cls: type.class,
    rangeNm: type.rangeNm,
    maxPayloadLbs: type.maxPayloadLbs,
    unpavedCapable: type.unpavedCapable,
    isAvailable: owned.status === "available",
  }));

  // Rentals at the player's current location AND the job's origin (deduped).
  const wantedAirports = Array.from(
    new Set([playerLocationIcao, jobOriginIcao]),
  );
  const rentalRows = db
    .select({ rental: rentalFleet, type: aircraftTypes })
    .from(rentalFleet)
    .innerJoin(aircraftTypes, eq(rentalFleet.aircraftTypeId, aircraftTypes.id))
    .where(
      wantedAirports.length === 1
        ? eq(rentalFleet.airportIcao, wantedAirports[0]!)
        : or(
            ...wantedAirports.map((a) => eq(rentalFleet.airportIcao, a)),
          ),
    )
    .all();

  const rentals: AircraftCandidate[] = rentalRows.map(({ rental, type }) => ({
    source: "rental",
    ownedAircraftId: null,
    aircraftTypeId: type.id,
    tailNumber: null,
    currentLocationIcao: rental.airportIcao,
    cls: type.class,
    rangeNm: type.rangeNm,
    maxPayloadLbs: type.maxPayloadLbs,
    unpavedCapable: type.unpavedCapable,
    isAvailable: true,
  }));

  // Dedup rentals: a player's location and job origin can overlap, and both
  // queries return rows for the same (airport, type) pair. Dedup on
  // (airport, typeId).
  const seen = new Set<string>();
  const rentalsDedup = rentals.filter((r) => {
    const k = `${r.currentLocationIcao}::${r.aircraftTypeId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return [...owned, ...rentalsDedup];
}

export async function getCandidatesForJob(
  jobId: number,
): Promise<CandidatesForJobResult | null> {
  const jobRow = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!jobRow) return null;

  const player = loadPlayer();
  if (!player) return null;

  const endpointIcaos = [jobRow.originIcao, jobRow.destinationIcao];
  const endpointRows = db
    .select()
    .from(airports)
    .where(inArray(airports.icao, endpointIcaos))
    .all();
  const origin = endpointRows.find((a) => a.icao === jobRow.originIcao);
  const dest = endpointRows.find((a) => a.icao === jobRow.destinationIcao);
  if (!origin || !dest) return null;

  const job = jobRequirements(jobRow, origin.lat, origin.lon, dest.lat, dest.lon);

  const airportMap = loadAirportMap();
  const candidates = loadCandidates(job.originIcao, player.currentLocationIcao);
  const ranked = rankCandidates(candidates, job, player, airportMap);

  // Build a typeId -> display lookup once.
  const typeRows = db.select().from(aircraftTypes).all();
  const displayByTypeId = new Map<string, CandidateDisplay>();
  for (const t of typeRows) {
    displayByTypeId.set(t.id, {
      manufacturer: t.manufacturer,
      model: t.model,
      cruiseSpeedKts: t.cruiseSpeedKts,
      fuelBurnGph: t.fuelBurnGph,
      fuelType: t.fuelType,
      rentalRatePerHour: t.rentalRatePerHour,
    });
  }
  const rankedWithDisplay: RankedCandidateWithDisplay[] = ranked.map((r) => ({
    ...r,
    display: displayByTypeId.get(r.candidate.aircraftTypeId) ?? {
      manufacturer: "",
      model: r.candidate.aircraftTypeId,
      cruiseSpeedKts: 0,
      fuelBurnGph: 0,
      fuelType: "avgas",
      rentalRatePerHour: 0,
    },
  }));

  return { jobId, job, player, ranked: rankedWithDisplay };
}
