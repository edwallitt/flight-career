ALTER TABLE `career` ADD `last_clock_sync_real` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `career` ADD `last_gen_sim_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `career` DROP COLUMN `is_paused`;