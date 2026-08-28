CREATE TABLE `writing_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'paste' NOT NULL,
	`character_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_writing_examples_user_updated` ON `writing_examples` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_writing_examples_user_hash` ON `writing_examples` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `writing_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`example_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
