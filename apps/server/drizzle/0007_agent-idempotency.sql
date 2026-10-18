ALTER TABLE `agent_runs` ADD `input` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_request_idx` ON `agent_runs` (`project_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_active_idx` ON `agent_runs` (`project_id`) WHERE "agent_runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_request_idx` ON `generation_jobs` (`project_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_active_idx` ON `generation_jobs` (`project_id`,`node_id`) WHERE "generation_jobs"."status" = 'running';