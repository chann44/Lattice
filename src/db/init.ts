import { sql } from "drizzle-orm";
import type { DBClient } from "./client";

export function initSchema(db: DBClient): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      public_key TEXT UNIQUE NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      last_seen INTEGER,
      metadata TEXT
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_branch TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(agent_id, name)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      head_commit TEXT,
      is_experimental INTEGER NOT NULL DEFAULT 0,
      experiment_reason TEXT,
      parent_branch TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id, name)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS commits (
      hash TEXT PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      branch TEXT NOT NULL,
      parent_hash TEXT,
      tree_hash TEXT NOT NULL,
      version TEXT NOT NULL,
      message TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      commit_type TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS trees (
      hash TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS blobs (
      hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      compressed INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      ref_count INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS project_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      repo_id INTEGER NOT NULL,
      project_key TEXT NOT NULL,
      workspace_path TEXT,
      fingerprint TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(agent_id, project_key)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS collaborators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id, agent_id)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      source_branch TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      created_by TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      merged_by TEXT,
      merge_commit_hash TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id, number)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS pr_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      reviewer_agent_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      branch TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      tree_hash TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'building',
      entry_path TEXT,
      public_url TEXT,
      metadata TEXT,
      logs TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS deployment_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      deployment_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id),
      UNIQUE(slug)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS deployment_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS build_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at INTEGER,
      completed_at INTEGER,
      timeout_ms INTEGER NOT NULL DEFAULT 120000,
      memory_limit_mb INTEGER NOT NULL DEFAULT 512,
      logs TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS repo_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'dev',
      encrypted_value TEXT NOT NULL,
      nonce TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(repo_id, key, environment)
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS runner_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      command TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'dev',
      runtime TEXT NOT NULL DEFAULT 'shell',
      status TEXT NOT NULL DEFAULT 'queued',
      secret_refs TEXT NOT NULL DEFAULT '[]',
      timeout_ms INTEGER NOT NULL DEFAULT 120000,
      memory_limit_mb INTEGER NOT NULL DEFAULT 512,
      exit_code INTEGER,
      logs TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS custom_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      deployment_id INTEGER NOT NULL,
      domain TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(domain)
    );
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_commits_repo_branch ON commits(repo_id, branch);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_commits_repo_created ON commits(repo_id, created_at DESC);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_repos_agent ON repos(agent_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_blobs_hash ON blobs(hash);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_trees_hash ON trees(hash);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_ctx_agent ON project_contexts(agent_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_project_ctx_repo ON project_contexts(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_collaborators_repo ON collaborators(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_collaborators_agent ON collaborators(agent_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pr_repo ON pull_requests(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pr_state ON pull_requests(state);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reviews_pr ON pr_reviews(repo_id, pr_number);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_deployments_repo ON deployments(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_deployment_aliases_deployment ON deployment_aliases(deployment_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_deployment_webhooks_repo ON deployment_webhooks(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_build_jobs_deployment ON build_jobs(deployment_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs(status);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_repo_secrets_repo ON repo_secrets(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_repo_secrets_env ON repo_secrets(environment);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_runner_jobs_repo ON runner_jobs(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_runner_jobs_status ON runner_jobs(status);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_custom_domains_repo ON custom_domains(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_custom_domains_deployment ON custom_domains(deployment_id);`);
}
