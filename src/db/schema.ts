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

export const projectContexts = sqliteTable(
  "project_contexts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: text("agent_id").notNull(),
    repoId: integer("repo_id").notNull(),
    projectKey: text("project_key").notNull(),
    workspacePath: text("workspace_path"),
    fingerprint: text("fingerprint"),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_ctx_agent_key_uq").on(table.agentId, table.projectKey),
    index("idx_project_ctx_agent").on(table.agentId),
    index("idx_project_ctx_repo").on(table.repoId),
  ],
);

export const collaborators = sqliteTable(
  "collaborators",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    agentId: text("agent_id").notNull(),
    role: text("role").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("collaborators_repo_agent_uq").on(table.repoId, table.agentId),
    index("idx_collaborators_repo").on(table.repoId),
    index("idx_collaborators_agent").on(table.agentId),
  ],
);

export const pullRequests = sqliteTable(
  "pull_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    sourceBranch: text("source_branch").notNull(),
    targetBranch: text("target_branch").notNull(),
    createdBy: text("created_by").notNull(),
    state: text("state").notNull().default("open"),
    mergedBy: text("merged_by"),
    mergeCommitHash: text("merge_commit_hash"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("pull_requests_repo_number_uq").on(table.repoId, table.number),
    index("idx_pull_requests_repo").on(table.repoId),
    index("idx_pull_requests_state").on(table.state),
  ],
);

export const prReviews = sqliteTable("pr_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoId: integer("repo_id").notNull(),
  prNumber: integer("pr_number").notNull(),
  reviewerAgentId: text("reviewer_agent_id").notNull(),
  decision: text("decision").notNull(),
  comment: text("comment"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const deployments = sqliteTable(
  "deployments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    branch: text("branch").notNull(),
    commitHash: text("commit_hash").notNull(),
    treeHash: text("tree_hash").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    status: text("status").notNull().default("building"),
    entryPath: text("entry_path"),
    publicUrl: text("public_url"),
    metadata: text("metadata"),
    logs: text("logs"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [index("idx_deployments_repo").on(table.repoId), index("idx_deployments_status").on(table.status)],
);

export const deploymentAliases = sqliteTable(
  "deployment_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    deploymentId: integer("deployment_id").notNull(),
    slug: text("slug").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("deployment_aliases_repo_uq").on(table.repoId),
    uniqueIndex("deployment_aliases_slug_uq").on(table.slug),
    index("idx_deployment_aliases_deployment").on(table.deploymentId),
  ],
);
