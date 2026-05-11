CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracking_state` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`current_position_lat` real,
	`current_position_lon` real,
	`current_altitude_ft` real,
	`current_ground_speed_kts` real,
	`current_true_heading_deg` real,
	`on_ground` integer,
	`engine_running` integer,
	`fuel_total_gal` real,
	`events_received` text DEFAULT '[]' NOT NULL,
	`fuel_at_engine_start_gal` real,
	`last_updated_at` integer NOT NULL,
	`bridge_status` text DEFAULT 'disconnected' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `career` ADD `tracking_mode` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `tracking_mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_block_time_minutes` real;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_engine_start_at` integer;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_engine_stop_at` integer;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_lifted_off_at` integer;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_touched_down_at` integer;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_actual_destination_icao` text;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_fuel_burned_gal` real;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_landing_lat` real;--> statement-breakpoint
ALTER TABLE `flights` ADD `sim_landing_lon` real;