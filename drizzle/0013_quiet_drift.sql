-- Reset role-scoped reputation rows to 0 if the player has zero completed
-- flights in that role. Earlier seeds set every role to a baseline of 25,
-- which surfaced as misleading "MID/RECOGNISED" tiers on the Career screen
-- for roles the player had never flown.
UPDATE `reputation`
SET `score` = 0
WHERE `scope` IN ('bush', 'air_taxi', 'light_jet')
  AND `scope` NOT IN (
    SELECT DISTINCT `jobs`.`role`
    FROM `jobs`
    INNER JOIN `flights` ON `flights`.`job_id` = `jobs`.`id`
    WHERE `jobs`.`role` != 'open'
  );
--> statement-breakpoint
-- Reconcile flight timestamps with their recorded block time. Earlier flights
-- captured `ended_at` as the wall-clock sim time at "Complete Flight" tap,
-- which drifted from `started_at + block_time × 60s` because sim time advances
-- in 30-minute ticks. Make `ended_at` derived so the Logbook detail drawer's
-- departed/arrived times always reconcile with block time exactly.
UPDATE `flights`
SET `ended_at` = `started_at` + (`block_time_minutes` * 60000)
WHERE `ended_at` != `started_at` + (`block_time_minutes` * 60000);
