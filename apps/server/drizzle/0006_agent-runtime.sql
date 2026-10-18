CREATE TABLE `agent_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`args` text NOT NULL,
	`expected_revision` integer,
	`status` text NOT NULL,
	`result` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_commands_run_idx` ON `agent_commands` (`run_id`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`request_id` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_project_idx` ON `agent_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`project_id` integer,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`result_url` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_project_idx` ON `generation_jobs` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `graph_version` integer DEFAULT 0 NOT NULL;