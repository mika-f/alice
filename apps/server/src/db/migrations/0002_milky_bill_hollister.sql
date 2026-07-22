CREATE TABLE `addresses` (
	`address` text PRIMARY KEY NOT NULL,
	`address_index` integer NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `send_idempotency` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`txid` text NOT NULL,
	`fee` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tx_meta` (
	`txid` text PRIMARY KEY NOT NULL,
	`label` text,
	`memo` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
