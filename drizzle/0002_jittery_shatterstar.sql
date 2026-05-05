CREATE TABLE `rental_fleet` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`airport_icao` text NOT NULL,
	`aircraft_type_id` text NOT NULL,
	FOREIGN KEY (`airport_icao`) REFERENCES `airports`(`icao`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`aircraft_type_id`) REFERENCES `aircraft_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rental_fleet_airport_type_unique` ON `rental_fleet` (`airport_icao`,`aircraft_type_id`);