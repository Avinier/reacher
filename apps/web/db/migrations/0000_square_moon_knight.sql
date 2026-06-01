CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`path` text,
	`provider_url` text,
	`title` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_id_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `browser_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`provider` text DEFAULT 'browserbase' NOT NULL,
	`provider_context_id` text,
	`status` text NOT NULL,
	`account_label` text,
	`last_verified_at` integer,
	`last_session_id` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_contexts_platform_idx` ON `browser_contexts` (`platform`);--> statement-breakpoint
CREATE TABLE `browser_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`browser_context_id` text,
	`provider_session_id` text,
	`status` text NOT NULL,
	`live_url` text,
	`recording_url` text,
	`started_at` integer,
	`ended_at` integer,
	`last_url` text,
	`error_message` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`browser_context_id`) REFERENCES `browser_contexts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `browser_sessions_run_id_idx` ON `browser_sessions` (`run_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`run_id` text,
	`platform` text NOT NULL,
	`draft_type` text NOT NULL,
	`body` text NOT NULL,
	`evidence_summary` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drafts_target_id_idx` ON `drafts` (`target_id`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`list_id` text,
	`format` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exports_run_id_idx` ON `exports` (`run_id`);--> statement-breakpoint
CREATE INDEX `exports_list_id_idx` ON `exports` (`list_id`);--> statement-breakpoint
CREATE TABLE `list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`target_id` text NOT NULL,
	`rank` integer NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_items_list_id_rank_idx` ON `list_items` (`list_id`,`rank`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `outreach_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`target_id` text NOT NULL,
	`draft_id` text,
	`browser_session_id` text,
	`platform` text NOT NULL,
	`action_type` text NOT NULL,
	`status` text NOT NULL,
	`result_note` text,
	`artifact_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`browser_session_id`) REFERENCES `browser_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outreach_actions_run_id_idx` ON `outreach_actions` (`run_id`);--> statement-breakpoint
CREATE TABLE `research_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text,
	`confidence` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_filters_run_id_idx` ON `research_filters` (`run_id`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`index` integer NOT NULL,
	`status` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`input_json` text,
	`output_json` text,
	`artifact_id` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_steps_run_id_index_idx` ON `run_steps` (`run_id`,`index`);--> statement-breakpoint
CREATE TABLE `run_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`provider` text NOT NULL,
	`service` text NOT NULL,
	`operation` text NOT NULL,
	`model` text,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`unit_cost_usd` real,
	`estimated_cost_usd` real,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`cost_basis` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_usage_events_run_id_idx` ON `run_usage_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`interpreted_goal` text,
	`settings_json` text,
	`result_summary` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `runs_status_created_at_idx` ON `runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`platform` text NOT NULL,
	`source_type` text NOT NULL,
	`url` text,
	`title` text,
	`summary` text,
	`captured_at` integer,
	`artifact_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_run_id_idx` ON `sources` (`run_id`);--> statement-breakpoint
CREATE TABLE `target_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`source_id` text,
	`evidence_type` text NOT NULL,
	`text` text NOT NULL,
	`url` text,
	`confidence` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `target_evidence_target_id_idx` ON `target_evidence` (`target_id`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`list_id` text,
	`platform` text NOT NULL,
	`target_type` text NOT NULL,
	`display_name` text NOT NULL,
	`handle` text,
	`profile_url` text,
	`organization` text,
	`role_or_context` text,
	`relevance_score` real,
	`why_relevant` text,
	`status` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `targets_run_id_idx` ON `targets` (`run_id`);--> statement-breakpoint
CREATE INDEX `targets_list_id_idx` ON `targets` (`list_id`);--> statement-breakpoint
CREATE INDEX `targets_platform_status_idx` ON `targets` (`platform`,`status`);
