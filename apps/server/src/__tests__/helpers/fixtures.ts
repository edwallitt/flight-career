import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  aircraftListings,
  aircraftTypes,
  airports,
  career,
  clientState,
  flights,
  fuelPriceCurrent,
  fuelPriceSnapshots,
  fuelShocks,
  jobs,
  loans,
  maintenanceEvents,
  ownedAircraft,
  ratings,
  ratingExams,
  rentalFleet,
  reputation,
  settings,
  trackingState,
  transfers,
} from "../../db/schema.js";
import { aircraftSeed } from "../../db/seed-data/aircraft.js";
import { airportSeed } from "../../db/seed-data/airports.js";

const RATING_CLASSES = ["SEP", "MEP", "SET", "JET"] as const;
const ROLE_SCOPES = ["bush", "air_taxi", "light_jet"] as const;
const STARTING_ROLE_REPUTATION = 25;

let catalogsSeeded = false;

/**
 * Wipe mutable state and reseed the singleton career row. Catalogs (airports,
 * aircraft types) are seeded once per worker — they're effectively read-only.
 */
export function resetTestDb(opts: ResetOptions = {}): void {
  if (!catalogsSeeded) {
    if (airportSeed.length > 0) {
      db.insert(airports).values(airportSeed).onConflictDoNothing().run();
    }
    if (aircraftSeed.length > 0) {
      db.insert(aircraftTypes).values(aircraftSeed).onConflictDoNothing().run();
    }
    catalogsSeeded = true;
  }

  // career ↔ jobs ↔ ownedAircraft ↔ loans form a cycle through FK columns,
  // so we toggle foreign_keys off for the reset rather than reasoning out a
  // delete order that doesn't exist.
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.delete(trackingState).run();
    db.delete(settings).run();
    db.delete(flights).run();
    db.delete(maintenanceEvents).run();
    db.delete(transfers).run();
    db.delete(loans).run();
    db.delete(ratingExams).run();
    db.delete(rentalFleet).run();
    db.delete(jobs).run();
    db.delete(aircraftListings).run();
    db.delete(ownedAircraft).run();
    db.delete(career).run();
    db.delete(clientState).run();
    db.delete(reputation).run();
    db.delete(ratings).run();
    db.delete(fuelPriceSnapshots).run();
    db.delete(fuelShocks).run();
    db.delete(fuelPriceCurrent).run();
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }

  const now = opts.simNow ?? Date.UTC(2026, 0, 1);

  db.insert(ratings)
    .values(
      RATING_CLASSES.map((cls) => ({
        class: cls,
        earned: opts.ratingsEarned?.[cls] ?? cls === "SEP",
        earnedAt:
          (opts.ratingsEarned?.[cls] ?? cls === "SEP") ? now : null,
        hoursInClass: 0,
      })),
    )
    .run();

  db.insert(reputation)
    .values(
      ROLE_SCOPES.map((scope) => ({
        scope,
        score: opts.startingRoleRep ?? STARTING_ROLE_REPUTATION,
        updatedAt: now,
      })),
    )
    .run();

  db.insert(career)
    .values({
      id: 1,
      pilotName: "TestPilot",
      cash: opts.cash ?? 1_000_000,
      currentLocationIcao: opts.currentLocation ?? "CYHZ",
      simDateTime: now,
      lastPlayedAt: now,
      startedAt: now,
    })
    .run();

  // Rentals at every airport that asks for them.
  if (opts.rentalsAt) {
    for (const [icao, typeIds] of Object.entries(opts.rentalsAt)) {
      for (const typeId of typeIds) {
        db.insert(rentalFleet)
          .values({ airportIcao: icao, aircraftTypeId: typeId })
          .onConflictDoNothing()
          .run();
      }
    }
  } else {
    // Default rental: bonanza_g36 SEP at the player's location.
    db.insert(rentalFleet)
      .values({
        airportIcao: opts.currentLocation ?? "CYHZ",
        aircraftTypeId: "bonanza_g36",
      })
      .onConflictDoNothing()
      .run();
  }
}

export interface ResetOptions {
  cash?: number;
  currentLocation?: string;
  simNow?: number;
  startingRoleRep?: number;
  ratingsEarned?: Partial<Record<"SEP" | "MEP" | "SET" | "JET", boolean>>;
  rentalsAt?: Record<string, string[]>;
}

export interface InsertJobInput {
  clientId?: string | null;
  role?: "bush" | "air_taxi" | "light_jet" | "open";
  originIcao?: string;
  destinationIcao?: string;
  payloadLbs?: number;
  payloadType?: "cargo" | "pax" | "medical" | "survey" | "mixed";
  paxCount?: number | null;
  requiredClass?: "SEP" | "MEP" | "SET" | "JET";
  requiredCapabilities?: string[];
  pay?: number;
  urgency?: "flexible" | "standard" | "urgent" | "critical";
  weatherSensitivity?: "none" | "mild" | "strict";
  description?: string;
  generatedAt?: number;
  expiresAt?: number;
  status?: "open" | "accepted" | "in_progress" | "completed" | "expired" | "cancelled";
}

/** Insert a single job; returns its row. Defaults are sensible for an SEP bush run. */
export function insertJob(input: InsertJobInput = {}): typeof jobs.$inferSelect {
  const now = db.select().from(career).where(eq(career.id, 1)).get()
    ?.simDateTime ?? Date.UTC(2026, 0, 1);

  db.insert(jobs)
    .values({
      clientId: input.clientId ?? "maritime_cargo",
      role: input.role ?? "bush",
      originIcao: input.originIcao ?? "CYHZ",
      destinationIcao: input.destinationIcao ?? "CYCH",
      payloadLbs: input.payloadLbs ?? 600,
      payloadType: input.payloadType ?? "cargo",
      paxCount: input.paxCount ?? null,
      requiredClass: input.requiredClass ?? "SEP",
      requiredCapabilitiesJson: JSON.stringify(input.requiredCapabilities ?? []),
      pay: input.pay ?? 50_000,
      generatedAt: input.generatedAt ?? now,
      expiresAt: input.expiresAt ?? now + 24 * 60 * 60 * 1000,
      earliestDeparture: null,
      latestDeparture: null,
      urgency: input.urgency ?? "standard",
      weatherSensitivity: input.weatherSensitivity ?? "none",
      legsJson: null,
      description: input.description ?? "Test job",
      status: input.status ?? "open",
    })
    .run();

  return db
    .select()
    .from(jobs)
    .orderBy(jobs.id)
    .all()
    .at(-1)!;
}

export interface InsertOwnedAircraftInput {
  tailNumber?: string;
  aircraftTypeId?: string;
  currentLocationIcao?: string;
  airframeHours?: number;
  hoursSince100hr?: number;
  hoursSinceAnnual?: number;
  annualDueAt?: number;
  fuelOnBoardGal?: number;
  status?: "available" | "in_maintenance" | "in_flight" | "committed";
}

let tailCounter = 0;

export function insertOwnedAircraft(
  input: InsertOwnedAircraftInput = {},
): typeof ownedAircraft.$inferSelect {
  const now = db.select().from(career).where(eq(career.id, 1)).get()
    ?.simDateTime ?? Date.UTC(2026, 0, 1);

  db.insert(ownedAircraft)
    .values({
      tailNumber: input.tailNumber ?? `N${(++tailCounter).toString().padStart(5, "0")}T`,
      aircraftTypeId: input.aircraftTypeId ?? "bonanza_g36",
      currentLocationIcao: input.currentLocationIcao ?? "CYHZ",
      airframeHours: input.airframeHours ?? 1500,
      engineHoursSinceOverhaul: 200,
      hoursSince100hr: input.hoursSince100hr ?? 50,
      hoursSinceAnnual: input.hoursSinceAnnual ?? 100,
      annualDueAt: input.annualDueAt ?? now + 180 * 24 * 60 * 60 * 1000,
      // Default well below typical capacities so a briefJob({fuelGallons:30})
      // uplift fits in tank headroom without specifying per-test.
      fuelOnBoardGal: input.fuelOnBoardGal ?? 20,
      status: input.status ?? "available",
      purchasedAt: now - 30 * 24 * 60 * 60 * 1000,
      purchasePrice: 500_000_00,
    })
    .run();

  return db
    .select()
    .from(ownedAircraft)
    .orderBy(ownedAircraft.id)
    .all()
    .at(-1)!;
}

/** Read the singleton career row. Tests use this constantly. */
export function getCareer(): typeof career.$inferSelect {
  return db.select().from(career).where(eq(career.id, 1)).get()!;
}

export interface InsertFlightInput {
  jobId?: number | null;
  ownedAircraftId?: number | null;
  rentalAircraftTypeId?: string | null;
  originIcao?: string;
  destinationIcao?: string;
  startedAt?: number;
  endedAt?: number;
  blockTimeMinutes?: number;
  fuelBurnedGal?: number;
  totalCost?: number;
  totalRevenue?: number;
  outcome?: "completed" | "diverted" | "failed";
  notes?: string | null;
}

/**
 * Insert a flight-log row directly. Bypasses the lifecycle service so tests
 * for read-side aggregations (logbook) can quickly seed flight history.
 */
export function insertFlight(
  input: InsertFlightInput = {},
): typeof flights.$inferSelect {
  const now =
    db.select().from(career).where(eq(career.id, 1)).get()?.simDateTime ??
    Date.UTC(2026, 0, 1);
  const startedAt = input.startedAt ?? now;
  const endedAt = input.endedAt ?? startedAt + 60 * 60_000;

  db.insert(flights)
    .values({
      jobId: input.jobId ?? null,
      ownedAircraftId: input.ownedAircraftId ?? null,
      rentalAircraftTypeId:
        input.rentalAircraftTypeId ??
        (input.ownedAircraftId == null ? "bonanza_g36" : null),
      originIcao: input.originIcao ?? "CYHZ",
      destinationIcao: input.destinationIcao ?? "CYCH",
      startedAt,
      endedAt,
      blockTimeMinutes: input.blockTimeMinutes ?? 60,
      fuelBurnedGal: input.fuelBurnedGal ?? 17,
      totalCost: input.totalCost ?? 5000,
      totalRevenue: input.totalRevenue ?? 50_000,
      outcome: input.outcome ?? "completed",
      notes: input.notes ?? null,
    })
    .run();

  return db.select().from(flights).orderBy(flights.id).all().at(-1)!;
}
