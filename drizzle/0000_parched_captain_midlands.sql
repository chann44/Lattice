CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`created_at` integer,
	`last_seen` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_public_key_unique` ON `agents` (`public_key`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`compressed` integer DEFAULT true NOT NULL,
	`created_at` integer,
	`ref_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`name` text NOT NULL,
	`head_commit` text,
	`is_experimental` integer DEFAULT false NOT NULL,
	`experiment_reason` text,
	`parent_branch` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_repo_name_uq` ON `branches` (`repo_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_branches_repo` ON `branches` (`repo_id`);--> statement-breakpoint
CREATE TABLE `build_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deployment_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`timeout_ms` integer DEFAULT 120000 NOT NULL,
	`memory_limit_mb` integer DEFAULT 512 NOT NULL,
	`logs` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_build_jobs_deployment` ON `build_jobs` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `idx_build_jobs_status` ON `build_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `collaborators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`agent_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collaborators_repo_agent_uq` ON `collaborators` (`repo_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_collaborators_repo` ON `collaborators` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_collaborators_agent` ON `collaborators` (`agent_id`);--> statement-breakpoint
CREATE TABLE `commits` (
	`hash` text PRIMARY KEY NOT NULL,
	`repo_id` integer NOT NULL,
	`branch` text NOT NULL,
	`parent_hash` text,
	`tree_hash` text NOT NULL,
	`version` text NOT NULL,
	`message` text NOT NULL,
	`author_agent_id` text NOT NULL,
	`commit_type` text NOT NULL,
	`metadata` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_commits_repo_branch` ON `commits` (`repo_id`,`branch`);--> statement-breakpoint
CREATE INDEX `idx_commits_repo_created` ON `commits` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `custom_domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`deployment_id` integer NOT NULL,
	`domain` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`auto_follow` integer DEFAULT false NOT NULL,
	`target_branch` text DEFAULT 'main' NOT NULL,
	`target_environment` text DEFAULT 'prod' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_domains_domain_uq` ON `custom_domains` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_custom_domains_repo` ON `custom_domains` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_domains_deployment` ON `custom_domains` (`deployment_id`);--> statement-breakpoint
CREATE TABLE `deployment_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`deployment_id` integer NOT NULL,
	`slug` text NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_aliases_repo_uq` ON `deployment_aliases` (`repo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_aliases_slug_uq` ON `deployment_aliases` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_deployment_aliases_deployment` ON `deployment_aliases` (`deployment_id`);--> statement-breakpoint
CREATE TABLE `deployment_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_deployment_webhooks_repo` ON `deployment_webhooks` (`repo_id`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`branch` text NOT NULL,
	`commit_hash` text NOT NULL,
	`tree_hash` text NOT NULL,
	`triggered_by` text NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`entry_path` text,
	`public_url` text,
	`metadata` text,
	`logs` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_deployments_repo` ON `deployments` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_deployments_status` ON `deployments` (`status`);--> statement-breakpoint
CREATE TABLE `domain_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`agent_id` text NOT NULL,
	`domain` text NOT NULL,
	`provider` text DEFAULT 'cloudflare_registry_mock' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`period_years` integer DEFAULT 1 NOT NULL,
	`amount_usdc` text NOT NULL,
	`payment_intent_id` integer NOT NULL,
	`provider_order_id` text,
	`metadata` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_domain_orders_repo` ON `domain_orders` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_domain_orders_status` ON `domain_orders` (`status`);--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`action` text NOT NULL,
	`amount_usdc` text NOT NULL,
	`chain` text DEFAULT 'base' NOT NULL,
	`recipient` text NOT NULL,
	`reference` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata` text,
	`expires_at` integer NOT NULL,
	`paid_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_reference_unique` ON `payment_intents` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_agent` ON `payment_intents` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_status` ON `payment_intents` (`status`);--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`intent_id` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`payer` text NOT NULL,
	`amount_usdc` text NOT NULL,
	`chain` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipts_tx_hash_unique` ON `payment_receipts` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `idx_payment_receipts_intent` ON `payment_receipts` (`intent_id`);--> statement-breakpoint
CREATE TABLE `pr_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`reviewer_agent_id` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `project_contexts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`project_key` text NOT NULL,
	`workspace_path` text,
	`fingerprint` text,
	`metadata` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_ctx_agent_key_uq` ON `project_contexts` (`agent_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `idx_project_ctx_agent` ON `project_contexts` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_project_ctx_repo` ON `project_contexts` (`repo_id`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`created_by` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`merged_by` text,
	`merge_commit_hash` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_requests_repo_number_uq` ON `pull_requests` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_repo` ON `pull_requests` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_pull_requests_state` ON `pull_requests` (`state`);--> statement-breakpoint
CREATE TABLE `repo_secrets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`key` text NOT NULL,
	`environment` text DEFAULT 'dev' NOT NULL,
	`encrypted_value` text NOT NULL,
	`nonce` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repo_secrets_repo_key_env_uq` ON `repo_secrets` (`repo_id`,`key`,`environment`);--> statement-breakpoint
CREATE INDEX `idx_repo_secrets_repo` ON `repo_secrets` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_repo_secrets_env` ON `repo_secrets` (`environment`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repos_agent_name_uq` ON `repos` (`agent_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_repos_agent` ON `repos` (`agent_id`);--> statement-breakpoint
CREATE TABLE `runner_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`agent_id` text NOT NULL,
	`command` text NOT NULL,
	`environment` text DEFAULT 'dev' NOT NULL,
	`runtime` text DEFAULT 'shell' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`secret_refs` text DEFAULT '[]' NOT NULL,
	`timeout_ms` integer DEFAULT 120000 NOT NULL,
	`memory_limit_mb` integer DEFAULT 512 NOT NULL,
	`exit_code` integer,
	`logs` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_runner_jobs_repo` ON `runner_jobs` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_runner_jobs_status` ON `runner_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `trees` (
	`hash` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`created_at` integer
);
