PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_maintenance_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owned_aircraft_id` integer NOT NULL,
	`type` text NOT NULL,
	`cost` integer NOT NULL,
	`started_at` integer NOT NULL,
	`scheduled_completion_at` integer,
	`completed_at` integer,
	`description` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_maintenance_events`("id", "owned_aircraft_id", "type", "cost", "started_at", "scheduled_completion_at", "completed_at", "description", "status") SELECT "id", "owned_aircraft_id", "type", "cost", "started_at", NULL, "completed_at", "description", 'completed' FROM `maintenance_events`;--> statement-breakpoint
DROP TABLE `maintenance_events`;--> statement-breakpoint
ALTER TABLE `__new_maintenance_events` RENAME TO `maintenance_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `owned_aircraft` ADD `next_monthly_cost_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: existing aircraft were purchased before monthly costs existed.
-- Use career.sim_date_time + 30 sim days so the player gets a one-month grace
-- before fees start hitting; otherwise the next tick would deduct back-fees.
UPDATE `owned_aircraft`
SET `next_monthly_cost_at` = (
  SELECT COALESCE(`sim_date_time`, 0) + (30 * 86400000)
  FROM `career`
  WHERE `id` = 1
)
WHERE `next_monthly_cost_at` = 0;