import {
  assessRisk,
  haversineNm,
  recommendedFuelUplift,
  type RiskTier,
} from "@flightcareer/shared";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
} from "../../db/schema.js";
import {
  ABORT_REP_PENALTY,
  REP_HIT_BY_STATE,
  activeAircraftType,
  fuelPriceCentsPerGal,
  recommendedFuelGallons,
} from "./shared.js";

export interface ActiveAircraftInfo {
  source: "owned" | "rental" | "ferry";
  aircraftTypeId: string;
  manufacturer: string;
  model: string;
  cls: "SEP" | "MEP" | "SET" | "JET";
  cruiseSpeedKts: number;
  fuelBurnGph: number;
  fuelType: "avgas" | "jet-a";
  fuelCapacityGal: number;
  // For owned aircraft this is what's actually in the tanks. For rentals the
  // wet rate covers fuel and the aircraft is conceptually delivered full —
  // we surface fuelCapacityGal here so the UI can show "starts full".
  currentFuelGal: number;
  rangeNm: number;
  maxPayloadLbs: number;
  rentalRatePerHour: number;
  ownedAircraftId: number | null;
  tailNumber: string | null;
  currentLocationIcao: string;
}

export interface ActiveJobFerryInfo {
  source: "owner" | "dealer" | "operator";
  ownerName: string;
  tail: string;
}

export interface ActiveJobSnapshot {
  state: "accepted" | "briefed" | "in_progress";
  job: {
    id: number;
    clientId: string | null;
    role: "bush" | "air_taxi" | "light_jet" | "open";
    jobType: "standard" | "ferry";
    ferry: ActiveJobFerryInfo | null;
    originIcao: string;
    originName: string;
    destinationIcao: string;
    destinationName: string;
    distanceNm: number;
    payloadLbs: number;
    payloadType: "cargo" | "pax" | "medical" | "survey" | "mixed";
    paxCount: number | null;
    requiredClass: "SEP" | "MEP" | "SET" | "JET";
    pay: number;
    description: string;
    urgency: "flexible" | "standard" | "urgent" | "critical";
    expiresAt: number;
    earliestDeparture: number | null;
    latestDeparture: number | null;
    acceptedAt: number | null;
  };
  aircraft: ActiveAircraftInfo;
  briefedFuelGallons: number | null;
  briefedFuelCostCents: number | null;
  fuelPriceCentsPerGal: number;
  recommendedFuelGallons: number;
  // Recommended uplift (gallons) given current fuel state and the trip — the
  // UI seeds the input from this. Always 0 for rentals (no uplift step).
  recommendedFuelUpliftGallons: number;
  // Reputation deltas the player will pay if they cancel from this state.
  // Server is the single source of truth — UI reads this rather than
  // hardcoding the numbers.
  cancelPenalty: { role: number; client: number };
  // Maintenance risk for owned aircraft. Null for rentals.
  risk: ActiveJobRiskInfo | null;
}

export interface ActiveJobRiskInfo {
  tier: RiskTier;
  factors: Array<{ description: string; severity: string }>;
  cannotDispatch: boolean;
  cannotDispatchReason: string | null;
}

export function getActiveJob(): ActiveJobSnapshot | null {
  const careerRow = db.select().from(career).where(eq(career.id, 1)).get();
  if (!careerRow) return null;
  if (
    careerRow.activeJobId == null ||
    careerRow.activeFlightState == null ||
    careerRow.activeAircraftSource == null
  ) {
    return null;
  }

  const jobRow = db
    .select()
    .from(jobs)
    .where(eq(jobs.id, careerRow.activeJobId))
    .get();
  if (!jobRow) return null;

  const origin = db
    .select()
    .from(airports)
    .where(eq(airports.icao, jobRow.originIcao))
    .get();
  const dest = db
    .select()
    .from(airports)
    .where(eq(airports.icao, jobRow.destinationIcao))
    .get();
  if (!origin || !dest) return null;

  const typeId = activeAircraftType(careerRow);
  if (!typeId) return null;
  const typeRow = db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, typeId))
    .get();
  if (!typeRow) return null;

  let ownedAircraftId: number | null = null;
  let tailNumber: string | null = null;
  let aircraftLocation = careerRow.currentLocationIcao;
  let risk: ActiveJobRiskInfo | null = null;
  // Owned aircraft: show actual on-board fuel. Rental: conceptually full at
  // delivery, so we report capacity for the briefing's range/reserves math.
  let currentFuelGal = typeRow.fuelCapacityGal;
  if (
    careerRow.activeAircraftSource === "owned" &&
    careerRow.activeAircraftOwnedId != null
  ) {
    const ownedRow = db
      .select()
      .from(ownedAircraft)
      .where(eq(ownedAircraft.id, careerRow.activeAircraftOwnedId))
      .get();
    if (ownedRow) {
      ownedAircraftId = ownedRow.id;
      tailNumber = ownedRow.tailNumber;
      aircraftLocation = ownedRow.currentLocationIcao;
      currentFuelGal = ownedRow.fuelOnBoardGal;
      // Risk assessment is only meaningful pre-flight. Once the flight is
      // in_progress the hours haven't been added yet, so the figures here
      // would be stale by the time anything renders them.
      if (careerRow.activeFlightState !== "in_progress") {
        const daysSinceAnnual =
          365 +
          Math.max(
            0,
            (careerRow.simDateTime - ownedRow.annualDueAt) /
              (24 * 60 * 60 * 1000),
          );
        const assessment = assessRisk({
          hoursSince100hr: ownedRow.hoursSince100hr,
          hoursSinceAnnual: daysSinceAnnual,
          engineHoursSinceOverhaul: ownedRow.engineHoursSinceOverhaul,
          tboHours: typeRow.tboHours,
          airframeHours: ownedRow.airframeHours,
        });
        risk = {
          tier: assessment.tier,
          factors: assessment.factors.map((f) => ({
            description: f.description,
            severity: f.severity,
          })),
          cannotDispatch: assessment.cannotDispatch,
          cannotDispatchReason: assessment.cannotDispatchReason ?? null,
        };
      }
    }
  }

  const distanceNm = haversineNm(
    { lat: origin.lat, lon: origin.lon },
    { lat: dest.lat, lon: dest.lon },
  );

  const recommended = recommendedFuelGallons(
    distanceNm,
    typeRow.cruiseSpeedKts,
    typeRow.fuelBurnGph,
  );
  const recommendedUplift =
    careerRow.activeAircraftSource === "rental" ||
    careerRow.activeAircraftSource === "ferry"
      ? 0
      : recommendedFuelUplift({
          distanceNm,
          cruiseSpeedKts: typeRow.cruiseSpeedKts,
          fuelBurnGph: typeRow.fuelBurnGph,
          fuelCapacityGal: typeRow.fuelCapacityGal,
          currentFuelGal,
        });

  // Cancel penalty surfaced to the UI depends on lifecycle state. accepted/
  // briefed use the cancel magnitudes; in_progress uses the abort magnitudes
  // (a different code path, but the player sees one "back out" cost).
  // Ferries have no client/role to upset, so cancelling is consequence-free.
  const penalty: { role: number; client: number } =
    careerRow.activeAircraftSource === "ferry"
      ? { role: 0, client: 0 }
      : careerRow.activeFlightState === "in_progress"
        ? ABORT_REP_PENALTY
        : REP_HIT_BY_STATE[careerRow.activeFlightState];

  const ferryInfo: ActiveJobFerryInfo | null =
    jobRow.jobType === "ferry" &&
    jobRow.ferrySource &&
    jobRow.ferryOwnerName &&
    jobRow.ferryAircraftTail
      ? {
          source: jobRow.ferrySource,
          ownerName: jobRow.ferryOwnerName,
          tail: jobRow.ferryAircraftTail,
        }
      : null;

  return {
    state: careerRow.activeFlightState,
    job: {
      id: jobRow.id,
      clientId: jobRow.clientId,
      role: jobRow.role,
      jobType: jobRow.jobType,
      ferry: ferryInfo,
      originIcao: jobRow.originIcao,
      originName: origin.name,
      destinationIcao: jobRow.destinationIcao,
      destinationName: dest.name,
      distanceNm,
      payloadLbs: jobRow.payloadLbs,
      payloadType: jobRow.payloadType,
      paxCount: jobRow.paxCount,
      requiredClass: jobRow.requiredClass,
      pay: jobRow.pay,
      description: jobRow.description,
      urgency: jobRow.urgency,
      expiresAt: jobRow.expiresAt,
      earliestDeparture: jobRow.earliestDeparture,
      latestDeparture: jobRow.latestDeparture,
      acceptedAt: jobRow.acceptedAt,
    },
    aircraft: {
      source: careerRow.activeAircraftSource,
      aircraftTypeId: typeRow.id,
      manufacturer: typeRow.manufacturer,
      model: typeRow.model,
      cls: typeRow.class,
      cruiseSpeedKts: typeRow.cruiseSpeedKts,
      fuelBurnGph: typeRow.fuelBurnGph,
      fuelType: typeRow.fuelType,
      fuelCapacityGal: typeRow.fuelCapacityGal,
      currentFuelGal,
      rangeNm: typeRow.rangeNm,
      maxPayloadLbs: typeRow.maxPayloadLbs,
      rentalRatePerHour: typeRow.rentalRatePerHour,
      ownedAircraftId,
      tailNumber,
      currentLocationIcao: aircraftLocation,
    },
    briefedFuelGallons: careerRow.briefedFuelGallons ?? null,
    briefedFuelCostCents: careerRow.briefedFuelCostCents ?? null,
    fuelPriceCentsPerGal: fuelPriceCentsPerGal(
      typeRow.fuelType,
      origin.icao,
      origin.baseFuelMultiplier,
    ),
    recommendedFuelGallons: recommended,
    recommendedFuelUpliftGallons: recommendedUplift,
    cancelPenalty: { role: penalty.role, client: penalty.client },
    risk,
  };
}
