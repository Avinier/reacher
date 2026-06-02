CREATE TABLE `research_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`company` text,
	`role` text,
	`url` text,
	`platform` text NOT NULL,
	`source_url` text,
	`reason` text,
	`confidence` real,
	`status` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_candidates_run_id_idx` ON `research_candidates` (`run_id`);--> statement-breakpoint
CREATE TABLE `research_enrichments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`candidate_id` text,
	`query` text,
	`platform` text NOT NULL,
	`url` text,
	`title` text,
	`summary` text,
	`evidence_type` text,
	`confidence` real,
	`status` text NOT NULL,
	`error` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `research_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_enrichments_run_id_idx` ON `research_enrichments` (`run_id`);--> statement-breakpoint
CREATE INDEX `research_enrichments_candidate_id_idx` ON `research_enrichments` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `research_scorecards` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`candidate_id` text,
	`target_id` text,
	`icp_fit` integer,
	`pain_evidence` integer,
	`reachability` integer,
	`call_likelihood` integer,
	`design_partner` integer,
	`total_score` real,
	`rationale` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `research_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `research_scorecards_run_id_idx` ON `research_scorecards` (`run_id`);--> statement-breakpoint
CREATE INDEX `research_scorecards_candidate_id_idx` ON `research_scorecards` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `research_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`data_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_checkpoints_run_id_idx` ON `research_checkpoints` (`run_id`);
