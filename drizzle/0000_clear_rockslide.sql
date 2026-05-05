CREATE TABLE `aircraft_types` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer` text NOT NULL,
	`model` text NOT NULL,
	`class` text NOT NULL,
	`is_complex` integer NOT NULL,
	`cruise_speed_kts` integer NOT NULL,
	`fuel_burn_gph` real NOT NULL,
	`fuel_type` text NOT NULL,
	`mtow_lbs` integer NOT NULL,
	`max_payload_lbs` integer NOT NULL,
	`range_nm` integer NOT NULL,
	`unpaved_capable` integer NOT NULL,
	`base_purchase_price` integer NOT NULL,
	`rental_rate_per_hour` integer NOT NULL,
	`hangarage_monthly` integer NOT NULL,
	`insurance_monthly` integer NOT NULL,
	`tbo_hours` integer NOT NULL,
	`hundred_hour_cost` integer NOT NULL,
	`annual_cost` integer NOT NULL,
	`overhaul_cost` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `airports` (
	`icao` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`elevation_ft` integer NOT NULL,
	`longest_runway_ft` integer NOT NULL,
	`has_paved_runway` integer NOT NULL,
	`country` text NOT NULL,
	`region` text NOT NULL,
	`size` text NOT NULL,
	`has_jet_a` integer NOT NULL,
	`has_avgas` integer NOT NULL,
	`base_fuel_multiplier` real NOT NULL,
	`base_landing_fee` integer NOT NULL,
	`has_fbo` integer NOT NULL,
	`has_maintenance` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `career` (
	`id` integer PRIMARY KEY NOT NULL,
	`pilot_name` text NOT NULL,
	`cash` integer NOT NULL,
	`current_location_icao` text NOT NULL,
	`sim_date_time` integer NOT NULL,
	`last_played_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`current_location_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `client_state` (
	`client_id` text PRIMARY KEY NOT NULL,
	`current_mood_score` integer NOT NULL,
	`last_job_generated_at` integer,
	`last_interaction_at` integer
);
--> statement-breakpoint
CREATE TABLE `flights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`owned_aircraft_id` integer,
	`rental_aircraft_type_id` text,
	`origin_icao` text NOT NULL,
	`destination_icao` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`block_time_minutes` integer NOT NULL,
	`fuel_burned_gal` real NOT NULL,
	`total_cost` integer NOT NULL,
	`total_revenue` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rental_aircraft_type_id`) REFERENCES `aircraft_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fuel_price_snapshots` (
	`airport_icao` text NOT NULL,
	`fuel_type` text NOT NULL,
	`effective_at` integer NOT NULL,
	`price_per_gal` real NOT NULL,
	PRIMARY KEY(`airport_icao`, `fuel_type`, `effective_at`),
	FOREIGN KEY (`airport_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text,
	`role` text NOT NULL,
	`origin_icao` text NOT NULL,
	`destination_icao` text NOT NULL,
	`payload_lbs` integer NOT NULL,
	`payload_type` text NOT NULL,
	`pax_count` integer,
	`required_class` text NOT NULL,
	`required_capabilities_json` text NOT NULL,
	`pay` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`earliest_departure` integer,
	`latest_departure` integer,
	`urgency` text NOT NULL,
	`weather_sensitivity` text NOT NULL,
	`legs_json` text,
	`status` text NOT NULL,
	`accepted_at` integer,
	`completed_at` integer,
	`reputation_deltas_json` text,
	FOREIGN KEY (`origin_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owned_aircraft_id` integer NOT NULL,
	`principal` integer NOT NULL,
	`remaining_balance` integer NOT NULL,
	`monthly_payment` integer NOT NULL,
	`interest_rate_bps` integer NOT NULL,
	`next_payment_due` integer NOT NULL,
	`term_months` integer NOT NULL,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `maintenance_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owned_aircraft_id` integer NOT NULL,
	`type` text NOT NULL,
	`cost` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`description` text NOT NULL,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `owned_aircraft` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tail_number` text NOT NULL,
	`aircraft_type_id` text NOT NULL,
	`current_location_icao` text NOT NULL,
	`airframe_hours` real NOT NULL,
	`engine_hours_since_overhaul` real NOT NULL,
	`hours_since_100hr` real NOT NULL,
	`hours_since_annual` real NOT NULL,
	`annual_due_at` integer NOT NULL,
	`fuel_on_board_gal` real NOT NULL,
	`status` text NOT NULL,
	`purchased_at` integer NOT NULL,
	`purchase_price` integer NOT NULL,
	`loan_id` integer,
	FOREIGN KEY (`aircraft_type_id`) REFERENCES `aircraft_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_location_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owned_aircraft_tail_number_unique` ON `owned_aircraft` (`tail_number`);--> statement-breakpoint
CREATE TABLE `rating_exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class` text NOT NULL,
	`booked_at` integer NOT NULL,
	`scheduled_for` integer NOT NULL,
	`cost` integer NOT NULL,
	`status` text NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`class`) REFERENCES `ratings`(`class`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`class` text PRIMARY KEY NOT NULL,
	`earned` integer NOT NULL,
	`earned_at` integer,
	`hours_in_class` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reputation` (
	`scope` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`updated_at` integer NOT NULL
);
