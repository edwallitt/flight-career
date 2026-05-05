import { eq } from "drizzle-orm";
import { db } from "./client.js";
import {
  aircraftListings,
  aircraftTypes,
  airports,
  career,
  ratings,
  rentalFleet,
  reputation,
} from "./schema.js";
import { aircraftSeed } from "./seed-data/aircraft.js";
import { airportSeed } from "./seed-data/airports.js";
import { refreshMarketplace, rngFromSeed } from "../services/marketplace.js";

const RATING_CLASSES = ["SEP", "MEP", "SET", "JET"] as const;
const ROLE_SCOPES = ["bush", "air_taxi", "light_jet"] as const;

// A meaningful starting baseline for role reputation. With a 0–100 cap, a
// score of 0 makes early cancel penalties no-ops because the floor pins
// them. 25 leaves headroom for the first few cancellation hits to actually
// register, while staying below the typical premium-template gates.
const STARTING_ROLE_REPUTATION = 25;

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

  // Career singleton — only seed if id=1 doesn't exist.
  const existing = db.select().from(career).where(eq(career.id, 1)).get();
  if (!existing) {
    db.insert(career)
      .values({
        id: 1,
        pilotName: "Pilot",
        cash: 1_500_000,
        currentLocationIcao: "CYHZ",
        simDateTime: now,
        lastPlayedAt: now,
        startedAt: now,
      })
      .run();
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
