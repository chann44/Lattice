import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  lastSeen: integer("last_seen", { mode: "timestamp" }),
  metadata: text("metadata"),
});

export const repos = sqliteTable(
  "repos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: text("agent_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    defaultBranch: text("default_branch").notNull().default("main"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("repos_agent_name_uq").on(table.agentId, table.name), index("idx_repos_agent").on(table.agentId)],
);

export const branches = sqliteTable(
  "branches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    name: text("name").notNull(),
    headCommit: text("head_commit"),
    isExperimental: integer("is_experimental", { mode: "boolean" }).notNull().default(false),
    experimentReason: text("experiment_reason"),
    parentBranch: text("parent_branch"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("branches_repo_name_uq").on(table.repoId, table.name), index("idx_branches_repo").on(table.repoId)],
);

export const commits = sqliteTable(
  "commits",
  {
    hash: text("hash").primaryKey(),
    repoId: integer("repo_id").notNull(),
    branch: text("branch").notNull(),
    parentHash: text("parent_hash"),
    treeHash: text("tree_hash").notNull(),
    version: text("version").notNull(),
    message: text("message").notNull(),
    authorAgentId: text("author_agent_id").notNull(),
    commitType: text("commit_type").notNull(),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_commits_repo_branch").on(table.repoId, table.branch),
    index("idx_commits_repo_created").on(table.repoId, table.createdAt),
  ],
);

export const trees = sqliteTable("trees", {
  hash: text("hash").primaryKey(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  compressed: integer("compressed", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  refCount: integer("ref_count").notNull().default(1),
});
