CREATE TABLE `aircraft_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`aircraft_type_id` text NOT NULL,
	`tail_number` text NOT NULL,
	`location_icao` text NOT NULL,
	`airframe_hours` real NOT NULL,
	`engine_hours_since_overhaul` real NOT NULL,
	`hours_since_100hr` real NOT NULL,
	`hours_since_annual` real NOT NULL,
	`asking_price_cents` integer NOT NULL,
	`condition_grade` text NOT NULL,
	`listed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`description_short` text,
	FOREIGN KEY (`aircraft_type_id`) REFERENCES `aircraft_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action
);
