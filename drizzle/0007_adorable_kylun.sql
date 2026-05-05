CREATE TABLE `transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`origin_icao` text NOT NULL,
	`destination_icao` text NOT NULL,
	`owned_aircraft_id` integer,
	`distance_nm` real NOT NULL,
	`cost_cents` integer NOT NULL,
	`sim_time_advanced_minutes` integer NOT NULL,
	`aircraft_hours_accrued` real NOT NULL,
	`fuel_gallons_burned` real NOT NULL,
	`executed_at` integer NOT NULL,
	FOREIGN KEY (`origin_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action
);
