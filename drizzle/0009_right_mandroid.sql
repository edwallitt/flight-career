ALTER TABLE `loans` ADD `original_term_months` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `loans` ADD `payments_made` integer DEFAULT 0 NOT NULL;