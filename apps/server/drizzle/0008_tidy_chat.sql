CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`title` text DEFAULT '新对话' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `conversation_id` text REFERENCES agent_conversations(id);