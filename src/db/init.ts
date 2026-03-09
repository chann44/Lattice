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

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_commits_repo_branch ON commits(repo_id, branch);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_commits_repo_created ON commits(repo_id, created_at DESC);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches(repo_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_repos_agent ON repos(agent_id);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_blobs_hash ON blobs(hash);`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_trees_hash ON trees(hash);`);
}
