ALTER TABLE `career` ADD `active_job_id` integer REFERENCES jobs(id);--> statement-breakpoint
ALTER TABLE `career` ADD `active_aircraft_source` text;--> statement-breakpoint
ALTER TABLE `career` ADD `active_aircraft_owned_id` integer REFERENCES owned_aircraft(id);--> statement-breakpoint
ALTER TABLE `career` ADD `active_aircraft_rental_type_id` text REFERENCES aircraft_types(id);--> statement-breakpoint
ALTER TABLE `career` ADD `active_flight_state` text;--> statement-breakpoint
ALTER TABLE `career` ADD `briefed_fuel_gallons` real;--> statement-breakpoint
ALTER TABLE `career` ADD `briefed_fuel_cost_cents` integer;