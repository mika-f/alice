CREATE TABLE `name_cache` (
	`name` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`owned` integer NOT NULL,
	`renewal_height` integer NOT NULL,
	`expiration_height` integer NOT NULL,
	`blocks_remaining` integer NOT NULL,
	`transfer_state` text NOT NULL,
	`resource_summary` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `name_meta` (
	`name` text PRIMARY KEY NOT NULL,
	`label` text,
	`memo` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
