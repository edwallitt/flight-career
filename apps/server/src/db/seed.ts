import { eq } from "drizzle-orm";
import { calculatePay, haversineNm } from "@flightcareer/shared";
import { db } from "./client.js";
import {
  aircraftListings,
  aircraftTypes,
  airports,
  career,
  jobs,
  ownedAircraft,
  ratings,
  rentalFleet,
  reputation,
} from "./schema.js";
import { aircraftSeed } from "./seed-data/aircraft.js";
import { airportSeed } from "./seed-data/airports.js";
import { ensureFuelPriceCurrent } from "../services/fuelDrift.js";
import { seedFerryJobs, tickJobGeneration } from "../services/jobBoard.js";
import { refreshMarketplace, rngFromSeed } from "../services/marketplace.js";

const RATING_CLASSES = ["SEP", "MEP", "SET", "JET"] as const;
const ROLE_SCOPES = ["bush", "air_taxi", "light_jet"] as const;

// Role reputation starts at 0 — a player who has never flown in a role hasn't
// earned standing in it. Tier display treats 0 as NOVICE. Cancel penalties
// can't drag the score below 0, but that floor is fine: a player with no
// reputation to lose simply hasn't built any yet.
const STARTING_ROLE_REPUTATION = 0;

// Rental availability rules. Order matters only for readability — types are
// deduplicated below before insertion.
const BASE_RENTAL_TYPES = ["c172", "bonanza_g36", "da40"] as const;
const SMALL_RENTAL_TYPES = ["c172", "bonanza_g36"] as const;
const MEP_RENTAL_TYPES = ["baron_g58", "da42"] as const;
const SET_RENTAL_TYPES = ["caravan", "kodiak"] as const;
const TBM_RENTAL_TYPES = ["tbm930"] as const;
const MAJOR_ONLY_RENTAL_TYPES = [
  "pc12",
  "cj4",
  "phenom300",
  "vision_jet",
] as const;

function rentalTypesFor(
  size: string,
  longestRunwayFt: number,
  hasPavedRunway: boolean,
): string[] {
  // Small fields with a paved runway long enough for trainers get a tiny
  // fleet so the player isn't stranded after diverting to one.
  if (size === "small") {
    if (hasPavedRunway && longestRunwayFt >= 3500) {
      return [...SMALL_RENTAL_TYPES];
    }
    return [];
  }

  if (size !== "major" && size !== "regional") return [];

  const types = new Set<string>(BASE_RENTAL_TYPES);

  // All regionals (and majors) get an MEP option.
  for (const id of MEP_RENTAL_TYPES) types.add(id);

  if (longestRunwayFt >= 4500) {
    for (const id of SET_RENTAL_TYPES) types.add(id);
  }
  if (longestRunwayFt >= 5500) {
    for (const id of TBM_RENTAL_TYPES) types.add(id);
  }

  if (size === "major") {
    for (const id of MAJOR_ONLY_RENTAL_TYPES) types.add(id);
  }
  return [...types];
}

// Inserts a guaranteed first-flight job: Maritime Cargo Express CYHZ → CYAW.
// 14 nm short hop, light parcel cargo, well within a C172's range and payload.
// Uses the shared pay calculator with the same multipliers as the standard
// MCE short-hop template so the math stays consistent.
function seedFirstFlightJob(simNow: number): void {
  const HOUR_MS = 60 * 60 * 1000;
  const cyhz = airportSeed.find((a) => a.icao === "CYHZ");
  const cyaw = airportSeed.find((a) => a.icao === "CYAW");
  if (!cyhz || !cyaw) return;

  const distanceNm = haversineNm(
    { lat: cyhz.lat, lon: cyhz.lon },
    { lat: cyaw.lat, lon: cyaw.lon },
  );
  const payloadLbs = 140;
  const pay = calculatePay({
    distanceNm,
    requiredClass: "SEP",
    payloadLbs,
    urgency: "standard",
    weatherSensitivity: "mild",
    isUnpavedRequired: false,
    isRemoteDestination: false,
    basePayMultiplier: 8.0,
    familiarityDiscount: 0,
  });

  db.insert(jobs)
    .values({
      clientId: "maritime_cargo",
      role: "bush",
      originIcao: "CYHZ",
      destinationIcao: "CYAW",
      payloadLbs,
      payloadType: "cargo",
      paxCount: null,
      requiredClass: "SEP",
      requiredCapabilitiesJson: JSON.stringify([]),
      pay,
      generatedAt: simNow,
      expiresAt: simNow + 24 * HOUR_MS,
      earliestDeparture: null,
      latestDeparture: null,
      urgency: "standard",
      weatherSensitivity: "mild",
      legsJson: null,
      description:
        "Short courier hop down to Shearwater — quick parcel transfer for the harbour office.",
      distanceNm: Math.round(distanceNm),
      status: "open",
    })
    .run();
}

async function seed() {
  // Catalogs: idempotent — re-running is a no-op.
  if (airportSeed.length > 0) {
    db.insert(airports).values(airportSeed).onConflictDoNothing().run();
  }
  if (aircraftSeed.length > 0) {
    db.insert(aircraftTypes).values(aircraftSeed).onConflictDoNothing().run();
  }

  // Ratings: one row per class. SEP starts earned, others not.
  const now = Date.now();
  const ratingRows = RATING_CLASSES.map((cls) => ({
    class: cls,
    earned: cls === "SEP",
    earnedAt: cls === "SEP" ? now : null,
    hoursInClass: 0,
  }));
  db.insert(ratings).values(ratingRows).onConflictDoNothing().run();

  // Role reputation rows at a baseline score. Idempotent — re-running won't
  // overwrite a player's earned score.
  const reputationRows = ROLE_SCOPES.map((scope) => ({
    scope,
    score: STARTING_ROLE_REPUTATION,
    updatedAt: now,
  }));
  db.insert(reputation).values(reputationRows).onConflictDoNothing().run();

  // Career singleton — only seed if id=1 doesn't exist. New player gets a
  // small inheritance: $60k cash and grandfather's C172, both narrated in the
  // first-run welcome modal on the web side.
  const STARTER_HOME_ICAO = "CYHZ";
  const existing = db.select().from(career).where(eq(career.id, 1)).get();
  if (!existing) {
    db.insert(career)
      .values({
        id: 1,
        pilotName: "Pilot",
        cash: 6_000_000,
        currentLocationIcao: STARTER_HOME_ICAO,
        simDateTime: now,
        lastPlayedAt: now,
        startedAt: now,
      })
      .run();

    // Grandfather's C172 — well-flown, recently inspected, fuelled. Tail
    // number "C-GPOP" carries the narrative.
    const SIM_DAY_MS = 24 * 60 * 60 * 1000;
    const c172 = aircraftSeed.find((a) => a.id === "c172");
    if (c172) {
      const daysSinceAnnual = 90;
      db.insert(ownedAircraft)
        .values({
          tailNumber: "C-GPOP",
          aircraftTypeId: "c172",
          currentLocationIcao: STARTER_HOME_ICAO,
          airframeHours: 8500,
          engineHoursSinceOverhaul: 800,
          hoursSince100hr: 25,
          hoursSinceAnnual: daysSinceAnnual,
          annualDueAt: now + (365 - daysSinceAnnual) * SIM_DAY_MS,
          fuelOnBoardGal: c172.fuelCapacityGal ?? 56,
          status: "available",
          purchasedAt: now,
          purchasePrice: 0,
          loanId: null,
          nextMonthlyCostAt: now + 30 * SIM_DAY_MS,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  // Rental fleets at every major/regional airport. Idempotent via the unique
  // (airport_icao, aircraft_type_id) index + onConflictDoNothing.
  const rentalRows: { airportIcao: string; aircraftTypeId: string }[] = [];
  for (const ap of airportSeed) {
    for (const typeId of rentalTypesFor(
      ap.size,
      ap.longestRunwayFt,
      ap.hasPavedRunway,
    )) {
      rentalRows.push({ airportIcao: ap.icao, aircraftTypeId: typeId });
    }
  }
  if (rentalRows.length > 0) {
    db.insert(rentalFleet).values(rentalRows).onConflictDoNothing().run();
  }

  // Marketplace: only seed initial listings if the table is empty.
  const existingListings = db.select().from(aircraftListings).all().length;
  if (existingListings === 0) {
    refreshMarketplace(24, rngFromSeed(0x5eed_0001));
  }

  // Fuel-price drift state. Idempotent — only inserts (airport, fuel_type)
  // combinations that don't already exist.
  const careerSimNow =
    db.select({ simDateTime: career.simDateTime }).from(career).where(eq(career.id, 1)).get()
      ?.simDateTime ?? now;
  ensureFuelPriceCurrent(careerSimNow);

  // Pre-warm the dispatch board so the first launch isn't an empty screen.
  // Each tick advances sim time by 30 minutes and may emit 0-N jobs; running
  // a handful of ticks reliably fills the board to roughly its target size.
  // The home-airport guarantee ensures at least one job per tick departs
  // from the player's current location.
  const openJobCount = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .all().length;
  if (openJobCount === 0) {
    seedFirstFlightJob(careerSimNow);
    // Guarantee ferry contracts on a fresh board. The pre-warm ticks below also
    // roll ferries probabilistically (FERRY_JOB_PROPORTION ~30%), but that's
    // RNG-dependent — a new career could open with zero ferries. Pre-seeding a
    // baseline removes that variance so the player always sees the third
    // career path on day one.
    seedFerryJobs(4, careerSimNow, rngFromSeed(0x5eed_FE22));
    for (let i = 0; i < 6; i++) tickJobGeneration();
  }

  const counts = {
    aircraftTypes: db.select().from(aircraftTypes).all().length,
    airports: db.select().from(airports).all().length,
    ratings: db.select().from(ratings).all().length,
    reputation: db.select().from(reputation).all().length,
    career: db.select().from(career).all().length,
    rentalFleet: db.select().from(rentalFleet).all().length,
    aircraftListings: db.select().from(aircraftListings).all().length,
  };
  console.log("Seed complete:", counts);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
