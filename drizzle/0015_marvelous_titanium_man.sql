CREATE TABLE `fuel_price_current` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`airport_icao` text NOT NULL,
	`fuel_type` text NOT NULL,
	`current_price_cents` integer NOT NULL,
	`base_price_cents` integer NOT NULL,
	`last_drift_at` integer NOT NULL,
	`current_shock_id` integer,
	FOREIGN KEY (`airport_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_shock_id`) REFERENCES `fuel_shocks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fuel_price_current_airport_fuel_unique` ON `fuel_price_current` (`airport_icao`,`fuel_type`);--> statement-breakpoint
CREATE TABLE `fuel_shocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`multiplier` real NOT NULL,
	`affects_fuel_type` text NOT NULL,
	`affects_region` text NOT NULL,
	`duration_ticks` integer NOT NULL,
	`ticks_remaining` integer NOT NULL,
	`started_at` integer NOT NULL,
	`description` text NOT NULL,
	`headline` text NOT NULL,
	`status` text NOT NULL
);
