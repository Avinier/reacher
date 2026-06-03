ALTER TABLE `runs` ADD COLUMN `parent_run_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `rerun_root_run_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `rerun_index` integer;
