import {
  type AnySQLiteColumn,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// =============================================================================
// Catalog (seeded, mostly read-only)
// =============================================================================

export const aircraftTypes = sqliteTable("aircraft_types", {
  id: text("id").primaryKey(),
  manufacturer: text("manufacturer").notNull(),
  model: text("model").notNull(),
  class: text("class", { enum: ["SEP", "MEP", "SET", "JET"] }).notNull(),
  isComplex: integer("is_complex", { mode: "boolean" }).notNull(),
  cruiseSpeedKts: integer("cruise_speed_kts").notNull(),
  fuelBurnGph: real("fuel_burn_gph").notNull(),
  fuelType: text("fuel_type", { enum: ["avgas", "jet-a"] }).notNull(),
  mtowLbs: integer("mtow_lbs").notNull(),
  maxPayloadLbs: integer("max_payload_lbs").notNull(),
  rangeNm: integer("range_nm").notNull(),
  unpavedCapable: integer("unpaved_capable", { mode: "boolean" }).notNull(),
  basePurchasePrice: integer("base_purchase_price").notNull(),
  rentalRatePerHour: integer("rental_rate_per_hour").notNull(),
  hangarageMonthly: integer("hangarage_monthly").notNull(),
  insuranceMonthly: integer("insurance_monthly").notNull(),
  tboHours: integer("tbo_hours").notNull(),
  hundredHourCost: integer("hundred_hour_cost").notNull(),
  annualCost: integer("annual_cost").notNull(),
  overhaulCost: integer("overhaul_cost").notNull(),
});

export const airports = sqliteTable("airports", {
  icao: text("icao").primaryKey(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  elevationFt: integer("elevation_ft").notNull(),
  longestRunwayFt: integer("longest_runway_ft").notNull(),
  hasPavedRunway: integer("has_paved_runway", { mode: "boolean" }).notNull(),
  country: text("country").notNull(),
  region: text("region").notNull(),
  size: text("size", { enum: ["major", "regional", "small", "remote"] }).notNull(),
  hasJetA: integer("has_jet_a", { mode: "boolean" }).notNull(),
  hasAvgas: integer("has_avgas", { mode: "boolean" }).notNull(),
  baseFuelMultiplier: real("base_fuel_multiplier").notNull(),
  baseLandingFee: integer("base_landing_fee").notNull(),
  hasFbo: integer("has_fbo", { mode: "boolean" }).notNull(),
  hasMaintenance: integer("has_maintenance", { mode: "boolean" }).notNull(),
});

// =============================================================================
// Career state (mutates with play)
// =============================================================================

export const career = sqliteTable("career", {
  id: integer("id").primaryKey(),
  pilotName: text("pilot_name").notNull(),
  cash: integer("cash").notNull(),
  currentLocationIcao: text("current_location_icao")
    .notNull()
    .references(() => airports.icao),
  simDateTime: integer("sim_date_time").notNull(),
  lastPlayedAt: integer("last_played_at").notNull(),
  startedAt: integer("started_at").notNull(),
  // Active job tracking. All five active_* and briefed_* columns move
  // together: cleared on completion or cancellation, populated on accept.
  activeJobId: integer("active_job_id").references((): AnySQLiteColumn => jobs.id),
  activeAircraftSource: text("active_aircraft_source", {
    enum: ["owned", "rental"],
  }),
  activeAircraftOwnedId: integer("active_aircraft_owned_id").references(
    (): AnySQLiteColumn => ownedAircraft.id,
  ),
  activeAircraftRentalTypeId: text("active_aircraft_rental_type_id").references(
    () => aircraftTypes.id,
  ),
  activeFlightState: text("active_flight_state", {
    enum: ["accepted", "briefed", "in_progress"],
  }),
  briefedFuelGallons: real("briefed_fuel_gallons"),
  briefedFuelCostCents: integer("briefed_fuel_cost_cents"),
  flightStartedAt: integer("flight_started_at"),
});

export const ratings = sqliteTable("ratings", {
  class: text("class", { enum: ["SEP", "MEP", "SET", "JET"] }).primaryKey(),
  earned: integer("earned", { mode: "boolean" }).notNull(),
  earnedAt: integer("earned_at"),
  hoursInClass: real("hours_in_class").notNull().default(0),
});

export const ratingExams = sqliteTable("rating_exams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  class: text("class", { enum: ["SEP", "MEP", "SET", "JET"] })
    .notNull()
    .references(() => ratings.class),
  bookedAt: integer("booked_at").notNull(),
  scheduledFor: integer("scheduled_for").notNull(),
  cost: integer("cost").notNull(),
  status: text("status", {
    enum: ["booked", "passed", "failed", "cancelled"],
  }).notNull(),
  resolvedAt: integer("resolved_at"),
});

export const reputation = sqliteTable("reputation", {
  scope: text("scope").primaryKey(),
  score: integer("score").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const clientState = sqliteTable("client_state", {
  clientId: text("client_id").primaryKey(),
  currentMoodScore: integer("current_mood_score").notNull(),
  lastJobGeneratedAt: integer("last_job_generated_at"),
  lastInteractionAt: integer("last_interaction_at"),
});

export const ownedAircraft = sqliteTable("owned_aircraft", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tailNumber: text("tail_number").notNull().unique(),
  aircraftTypeId: text("aircraft_type_id")
    .notNull()
    .references(() => aircraftTypes.id),
  currentLocationIcao: text("current_location_icao")
    .notNull()
    .references(() => airports.icao),
  airframeHours: real("airframe_hours").notNull(),
  engineHoursSinceOverhaul: real("engine_hours_since_overhaul").notNull(),
  hoursSince100hr: real("hours_since_100hr").notNull(),
  hoursSinceAnnual: real("hours_since_annual").notNull(),
  annualDueAt: integer("annual_due_at").notNull(),
  fuelOnBoardGal: real("fuel_on_board_gal").notNull(),
  status: text("status", {
    enum: ["available", "in_maintenance", "in_flight", "committed"],
  }).notNull(),
  purchasedAt: integer("purchased_at").notNull(),
  purchasePrice: integer("purchase_price").notNull(),
  loanId: integer("loan_id").references((): AnySQLiteColumn => loans.id),
});

export const loans = sqliteTable("loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownedAircraftId: integer("owned_aircraft_id")
    .notNull()
    .references(() => ownedAircraft.id),
  principal: integer("principal").notNull(),
  remainingBalance: integer("remaining_balance").notNull(),
  monthlyPayment: integer("monthly_payment").notNull(),
  interestRateBps: integer("interest_rate_bps").notNull(),
  nextPaymentDue: integer("next_payment_due").notNull(),
  termMonths: integer("term_months").notNull(),
  originalTermMonths: integer("original_term_months").notNull().default(0),
  paymentsMade: integer("payments_made").notNull().default(0),
});

export const rentalFleet = sqliteTable(
  "rental_fleet",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    airportIcao: text("airport_icao")
      .notNull()
      .references(() => airports.icao),
    aircraftTypeId: text("aircraft_type_id")
      .notNull()
      .references(() => aircraftTypes.id),
  },
  (t) => ({
    airportTypeUnique: uniqueIndex("rental_fleet_airport_type_unique").on(
      t.airportIcao,
      t.aircraftTypeId,
    ),
  }),
);

// =============================================================================
// Job board
// =============================================================================

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id"),
  role: text("role", { enum: ["bush", "air_taxi", "light_jet", "open"] }).notNull(),
  originIcao: text("origin_icao")
    .notNull()
    .references(() => airports.icao),
  destinationIcao: text("destination_icao")
    .notNull()
    .references(() => airports.icao),
  payloadLbs: integer("payload_lbs").notNull(),
  payloadType: text("payload_type", {
    enum: ["cargo", "pax", "medical", "survey", "mixed"],
  }).notNull(),
  paxCount: integer("pax_count"),
  requiredClass: text("required_class", {
    enum: ["SEP", "MEP", "SET", "JET"],
  }).notNull(),
  requiredCapabilitiesJson: text("required_capabilities_json").notNull(),
  pay: integer("pay").notNull(),
  generatedAt: integer("generated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  earliestDeparture: integer("earliest_departure"),
  latestDeparture: integer("latest_departure"),
  urgency: text("urgency", {
    enum: ["flexible", "standard", "urgent", "critical"],
  }).notNull(),
  weatherSensitivity: text("weather_sensitivity", {
    enum: ["none", "mild", "strict"],
  }).notNull(),
  legsJson: text("legs_json"),
  description: text("description").notNull().default(""),
  distanceNm: real("distance_nm").notNull().default(0),
  status: text("status", {
    enum: ["open", "accepted", "in_progress", "completed", "expired", "cancelled"],
  }).notNull(),
  acceptedAt: integer("accepted_at"),
  completedAt: integer("completed_at"),
  reputationDeltasJson: text("reputation_deltas_json"),
});

// =============================================================================
// Append-only log
// =============================================================================

export const flights = sqliteTable("flights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id),
  ownedAircraftId: integer("owned_aircraft_id").references(() => ownedAircraft.id),
  rentalAircraftTypeId: text("rental_aircraft_type_id").references(
    () => aircraftTypes.id,
  ),
  originIcao: text("origin_icao")
    .notNull()
    .references(() => airports.icao),
  destinationIcao: text("destination_icao")
    .notNull()
    .references(() => airports.icao),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at").notNull(),
  blockTimeMinutes: integer("block_time_minutes").notNull(),
  fuelBurnedGal: real("fuel_burned_gal").notNull(),
  totalCost: integer("total_cost").notNull(),
  totalRevenue: integer("total_revenue").notNull(),
  outcome: text("outcome", {
    enum: ["completed", "diverted", "failed"],
  })
    .notNull()
    .default("completed"),
  notes: text("notes"),
});

export const maintenanceEvents = sqliteTable("maintenance_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownedAircraftId: integer("owned_aircraft_id")
    .notNull()
    .references(() => ownedAircraft.id),
  type: text("type", {
    enum: ["100hr", "annual", "overhaul", "unscheduled"],
  }).notNull(),
  cost: integer("cost").notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at").notNull(),
  description: text("description").notNull(),
});

export const transfers = sqliteTable("transfers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", {
    enum: ["pilot", "pilot_aircraft", "aircraft"],
  }).notNull(),
  originIcao: text("origin_icao")
    .notNull()
    .references(() => airports.icao),
  destinationIcao: text("destination_icao")
    .notNull()
    .references(() => airports.icao),
  ownedAircraftId: integer("owned_aircraft_id").references(
    (): AnySQLiteColumn => ownedAircraft.id,
  ),
  distanceNm: real("distance_nm").notNull(),
  costCents: integer("cost_cents").notNull(),
  simTimeAdvancedMinutes: integer("sim_time_advanced_minutes").notNull(),
  aircraftHoursAccrued: real("aircraft_hours_accrued").notNull(),
  fuelGallonsBurned: real("fuel_gallons_burned").notNull(),
  executedAt: integer("executed_at").notNull(),
});

export const aircraftListings = sqliteTable("aircraft_listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  aircraftTypeId: text("aircraft_type_id")
    .notNull()
    .references(() => aircraftTypes.id),
  tailNumber: text("tail_number").notNull(),
  locationIcao: text("location_icao")
    .notNull()
    .references(() => airports.icao),
  airframeHours: real("airframe_hours").notNull(),
  engineHoursSinceOverhaul: real("engine_hours_since_overhaul").notNull(),
  hoursSince100hr: real("hours_since_100hr").notNull(),
  hoursSinceAnnual: real("hours_since_annual").notNull(),
  askingPriceCents: integer("asking_price_cents").notNull(),
  conditionGrade: text("condition_grade", {
    enum: ["pristine", "excellent", "good", "fair", "project"],
  }).notNull(),
  listedAt: integer("listed_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  status: text("status", {
    enum: ["available", "sold", "expired"],
  }).notNull(),
  descriptionShort: text("description_short"),
});

export const fuelPriceSnapshots = sqliteTable(
  "fuel_price_snapshots",
  {
    airportIcao: text("airport_icao")
      .notNull()
      .references(() => airports.icao),
    fuelType: text("fuel_type", { enum: ["avgas", "jet-a"] }).notNull(),
    effectiveAt: integer("effective_at").notNull(),
    pricePerGal: real("price_per_gal").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.airportIcao, t.fuelType, t.effectiveAt] }),
  }),
);

