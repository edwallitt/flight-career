CREATE TABLE `insurance_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`policy_id` integer NOT NULL,
	`owned_aircraft_id` integer NOT NULL,
	`maintenance_event_id` integer NOT NULL,
	`event_severity` text NOT NULL,
	`full_event_cost_cents` integer NOT NULL,
	`deductible_paid_cents` integer NOT NULL,
	`insurer_paid_cents` integer NOT NULL,
	`player_paid_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maintenance_event_id`) REFERENCES `maintenance_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owned_aircraft_id` integer NOT NULL,
	`tier` text NOT NULL,
	`monthly_premium_cents` integer NOT NULL,
	`insured_value_cents` integer NOT NULL,
	`deductible_cents` integer NOT NULL,
	`per_claim_ceiling_cents` integer NOT NULL,
	`started_at` integer NOT NULL,
	`next_premium_due_at` integer NOT NULL,
	`payments_made` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`owned_aircraft_id`) REFERENCES `owned_aircraft`(`id`) ON UPDATE no action ON DELETE no action
);
