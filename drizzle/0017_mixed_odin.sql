ALTER TABLE `jobs` ADD `job_type` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ferry_aircraft_type_id` text REFERENCES aircraft_types(id);--> statement-breakpoint
ALTER TABLE `jobs` ADD `ferry_aircraft_tail` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ferry_source` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `ferry_owner_name` text;