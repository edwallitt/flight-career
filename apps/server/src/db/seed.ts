import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { aircraftTypes, airports, career, ratings } from "./schema.js";
import { aircraftSeed } from "./seed-data/aircraft.js";
import { airportSeed } from "./seed-data/airports.js";

const RATING_CLASSES = ["SEP", "MEP", "SET", "JET"] as const;

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

  const counts = {
    aircraftTypes: db.select().from(aircraftTypes).all().length,
    airports: db.select().from(airports).all().length,
    ratings: db.select().from(ratings).all().length,
    career: db.select().from(career).all().length,
  };
  console.log("Seed complete:", counts);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
