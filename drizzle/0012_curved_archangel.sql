ALTER TABLE `aircraft_types` ADD `fuel_capacity_gal` real DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill realistic usable fuel capacities for existing seeded rows. New
-- installs hit the seed inserts directly with the column populated; existing
-- DBs need this UPDATE so we stop using the cruise_burn × 4 proxy.
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 24.5 WHERE `id` = 'c152';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 56 WHERE `id` = 'c172';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 87 WHERE `id` = 'c182t';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 48 WHERE `id` = 'pa28_archer';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 92 WHERE `id` = 'sr22';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 92 WHERE `id` = 'sr22t';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 89 WHERE `id` = 'm20r';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 74 WHERE `id` = 'bonanza_g36';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 50 WHERE `id` = 'da40';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 166 WHERE `id` = 'baron_g58';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 77 WHERE `id` = 'da42';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 86 WHERE `id` = 'da62';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 143 WHERE `id` = 'c310r';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 336 WHERE `id` = 'caravan';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 322 WHERE `id` = 'kodiak';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 282 WHERE `id` = 'tbm850';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 291 WHERE `id` = 'tbm930';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 402 WHERE `id` = 'pc12';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 875 WHERE `id` = 'cj4';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 830 WHERE `id` = 'phenom300';--> statement-breakpoint
UPDATE `aircraft_types` SET `fuel_capacity_gal` = 296 WHERE `id` = 'vision_jet';--> statement-breakpoint
-- Clamp existing owned aircraft fuel-on-board to the new (real) capacity.
-- Old aircraft were filled to cruise_burn × 4, which over- or under-shot the
-- POH numbers; the over-shoot case has to be fixed or a refuel can never
-- "top them up" (already past capacity).
UPDATE `owned_aircraft`
SET `fuel_on_board_gal` = (
  SELECT `fuel_capacity_gal` FROM `aircraft_types`
  WHERE `aircraft_types`.`id` = `owned_aircraft`.`aircraft_type_id`
)
WHERE `fuel_on_board_gal` > (
  SELECT `fuel_capacity_gal` FROM `aircraft_types`
  WHERE `aircraft_types`.`id` = `owned_aircraft`.`aircraft_type_id`
);
