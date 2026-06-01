CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`account_label` text,
	`account_email` text,
	`scopes` text,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`connected_at` integer NOT NULL,
	`disconnected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_provider_idx` ON `integrations` (`provider`);
