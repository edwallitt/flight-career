import {
  assessRisk,
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
  fuelCapacityGal: number;
  fuelType: "avgas" | "jet-a";
  rentalRatePerHour: number;
}

// Fuel snapshot per ranked candidate. Rentals are conceptually full (the wet
// rate covers fuel), so the UI can render a "fueled at start" label without
// needing to track per-rental state.
export interface CandidateFuelInfo {
  source: "owned" | "rental";
  currentFuelGal: number;
  fuelCapacityGal: number;
  estimatedRangeNm: number;
  // null for rentals — they don't have a maintenance/fuel state to flag.
  // For owned: 'sufficient' | 'top_up' | 'insufficient' for the trip.
  status: "sufficient" | "top_up" | "insufficient" | "rental";
}

export interface RankedCandidateWithDisplay extends RankedCandidate {
  display: CandidateDisplay;
  fuel: CandidateFuelInfo;
  cannotDispatchReason?: string;
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
  const tboByTypeId = new Map<string, number>();
  const typeById = new Map<string, typeof aircraftTypes.$inferSelect>();
  for (const t of typeRows) {
    displayByTypeId.set(t.id, {
      manufacturer: t.manufacturer,
      model: t.model,
      cruiseSpeedKts: t.cruiseSpeedKts,
      fuelBurnGph: t.fuelBurnGph,
      fuelCapacityGal: t.fuelCapacityGal,
      fuelType: t.fuelType,
      rentalRatePerHour: t.rentalRatePerHour,
    });
    tboByTypeId.set(t.id, t.tboHours);
    typeById.set(t.id, t);
  }

  // Owned aircraft maintenance state — used to attach CANNOT_DISPATCH for
  // aircraft past hard limits.
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  const simNow = careerRow?.simDateTime ?? Date.now();
  const ownedRows = db.select().from(ownedAircraft).all();
  const ownedById = new Map<number, typeof ownedAircraft.$inferSelect>();
  for (const o of ownedRows) ownedById.set(o.id, o);

  const rankedWithDisplay: RankedCandidateWithDisplay[] = ranked.map((r) => {
    const display = displayByTypeId.get(r.candidate.aircraftTypeId) ?? {
      manufacturer: "",
      model: r.candidate.aircraftTypeId,
      cruiseSpeedKts: 0,
      fuelBurnGph: 0,
      fuelCapacityGal: 0,
      fuelType: "avgas" as const,
      rentalRatePerHour: 0,
    };
    const t = typeById.get(r.candidate.aircraftTypeId);
    const fuelCapacity = t?.fuelCapacityGal ?? 0;
    const fuelBurn = t?.fuelBurnGph ?? 0;
    const cruise = t?.cruiseSpeedKts ?? 0;

    // Operational range estimate: usable fuel (after a 45-min reserve) at
    // cruise burn. For owned uses actual on-board fuel; rentals are full.
    const reserveGal = 0.75 * fuelBurn;
    let currentFuelGal = fuelCapacity;
    if (r.candidate.source === "owned" && r.candidate.ownedAircraftId != null) {
      const owned = ownedById.get(r.candidate.ownedAircraftId);
      if (owned) currentFuelGal = owned.fuelOnBoardGal;
    }
    const usableGal = Math.max(0, currentFuelGal - reserveGal);
    const estimatedRangeNm =
      fuelBurn > 0 && cruise > 0 ? (usableGal / fuelBurn) * cruise : 0;

    let fuelStatus: CandidateFuelInfo["status"] = "rental";
    if (r.candidate.source === "owned") {
      // Threshold: comfortable for the trip with 45-min reserve. The
      // recommended-uplift logic in jobLifecycle does the same comparison
      // but with a 5% contingency — keep this lighter so "top_up" doesn't
      // trip on every borderline trip.
      if (estimatedRangeNm < job.distanceNm) {
        fuelStatus = "insufficient";
      } else if (estimatedRangeNm < job.distanceNm * 1.1) {
        fuelStatus = "top_up";
      } else {
        fuelStatus = "sufficient";
      }
    }
    const fuel: CandidateFuelInfo = {
      source: r.candidate.source,
      currentFuelGal,
      fuelCapacityGal: fuelCapacity,
      estimatedRangeNm,
      status: fuelStatus,
    };

    let eligibility = r.eligibility;
    let preferenceScore = r.preferenceScore;
    let cannotDispatchReason: string | undefined;
    if (r.candidate.source === "owned" && r.candidate.ownedAircraftId != null) {
      const owned = ownedById.get(r.candidate.ownedAircraftId);
      const tboHours = tboByTypeId.get(r.candidate.aircraftTypeId) ?? 0;
      if (owned && tboHours > 0) {
        const daysSinceAnnual =
          365 + Math.max(0, (simNow - owned.annualDueAt) / (24 * 60 * 60 * 1000));
        const assessment = assessRisk({
          hoursSince100hr: owned.hoursSince100hr,
          hoursSinceAnnual: daysSinceAnnual,
          engineHoursSinceOverhaul: owned.engineHoursSinceOverhaul,
          tboHours,
          airframeHours: owned.airframeHours,
        });
        if (assessment.cannotDispatch) {
          eligibility = {
            eligible: false,
            reasons: [...eligibility.reasons, "CANNOT_DISPATCH"],
          };
          // Match the ineligible-candidate sentinel score from rankCandidates
          // so post-rank demotions sort below truly-eligible candidates.
          preferenceScore = -1000;
          cannotDispatchReason = assessment.cannotDispatchReason;
        }
      }
    }

    return {
      ...r,
      eligibility,
      preferenceScore,
      display,
      fuel,
      ...(cannotDispatchReason ? { cannotDispatchReason } : {}),
    };
  });

  // Re-sort: post-processing may have demoted some candidates from eligible
  // to ineligible. Without this, demoted owned aircraft keep their high
  // pre-rank score and float above truly eligible options in the UI.
  rankedWithDisplay.sort((a, b) => b.preferenceScore - a.preferenceScore);

  return { jobId, job, player, ranked: rankedWithDisplay };
}
