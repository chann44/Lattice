import { and, count, desc, eq, sql } from "drizzle-orm";
import type { DBClient } from "../db/client";
import {
  agents,
  blobs,
  branches,
  collaborators,
  commits,
  deploymentAliases,
  customDomains,
  deploymentWebhooks,
  deployments,
  buildJobs,
  repoSecrets,
  runnerJobs,
  prReviews,
  projectContexts,
  pullRequests,
  repos,
  trees,
} from "../db/schema";
import type { DiffResult, TreeEntry } from "../types/api";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class RepositoryService {
  constructor(private readonly db: DBClient) {}

  async createAgent(id: string, publicKey: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.insert(agents).values({
      id,
      publicKey,
      metadata: JSON.stringify(metadata),
      createdAt: new Date(),
      lastSeen: new Date(),
    });
  }

  async getAgentByPublicKey(publicKey: string) {
    return this.db.query.agents.findFirst({ where: eq(agents.publicKey, publicKey) });
  }

  async getAgent(agentId: string) {
    return this.db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  }

  async updateAgentLastSeen(agentId: string): Promise<void> {
    await this.db.update(agents).set({ lastSeen: new Date() }).where(eq(agents.id, agentId));
  }

  async createRepo(agentId: string, name: string, description: string, defaultBranch: string): Promise<number> {
    const inserted = await this.db
      .insert(repos)
      .values({
        agentId,
        name,
        description,
        defaultBranch,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: repos.id });
    const repoId = inserted[0]?.id;
    if (!repoId) throw new Error("failed to create repo");
    await this.db.insert(branches).values({
      repoId,
      name: defaultBranch,
      isExperimental: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return repoId;
  }

  async listRepos(agentId: string, page: number, perPage: number) {
    const offset = (page - 1) * perPage;
    const rows = await this.db.select().from(repos).where(eq(repos.agentId, agentId)).limit(perPage).offset(offset);
    const total = await this.db.select({ value: count() }).from(repos).where(eq(repos.agentId, agentId));
    return { rows, total: total[0]?.value ?? 0 };
  }

  async getRepo(repoId: number) {
    return this.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  }

  async getRepoAccess(agentId: string, repoId: number): Promise<"owner" | "admin" | "write" | "read" | null> {
    const repo = await this.getRepo(repoId);
    if (!repo) return null;
    if (repo.agentId === agentId) return "owner";
    const collab = await this.db.query.collaborators.findFirst({
      where: and(eq(collaborators.repoId, repoId), eq(collaborators.agentId, agentId)),
    });
    if (!collab) return null;
    if (collab.role === "admin" || collab.role === "write" || collab.role === "read") return collab.role;
    return null;
  }

  async addCollaborator(repoId: number, agentId: string, role: "admin" | "write" | "read") {
    await this.db
      .insert(collaborators)
      .values({ repoId, agentId, role, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [collaborators.repoId, collaborators.agentId],
        set: { role },
      });
  }

  async listCollaborators(repoId: number) {
    return this.db.select().from(collaborators).where(eq(collaborators.repoId, repoId));
  }

  async getBranch(repoId: number, name: string) {
    return this.db.query.branches.findFirst({ where: and(eq(branches.repoId, repoId), eq(branches.name, name)) });
  }

  async createBranch(
    repoId: number,
    name: string,
    headCommit: string | null,
    reason: string,
    parentBranch: string,
    isExperimental = true,
  ): Promise<void> {
    await this.db.insert(branches).values({
      repoId,
      name,
      headCommit,
      isExperimental,
      experimentReason: reason,
      parentBranch,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async listBranches(repoId: number) {
    return this.db.select().from(branches).where(eq(branches.repoId, repoId));
  }

  async updateBranchHead(repoId: number, branchName: string, hash: string): Promise<void> {
    await this.db
      .update(branches)
      .set({ headCommit: hash, updatedAt: new Date() })
      .where(and(eq(branches.repoId, repoId), eq(branches.name, branchName)));
    await this.db.update(repos).set({ updatedAt: new Date() }).where(eq(repos.id, repoId));
  }

  async getCommit(hash: string) {
    return this.db.query.commits.findFirst({ where: eq(commits.hash, hash) });
  }

  async listCommits(repoId: number, branch: string, limit: number, offset: number) {
    const rows = await this.db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.branch, branch)))
      .orderBy(desc(commits.createdAt))
      .limit(limit)
      .offset(offset);
    const total = await this.db
      .select({ value: count() })
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.branch, branch)));
    return { rows, total: total[0]?.value ?? 0 };
  }

  async insertCommit(input: {
    hash: string;
    repoId: number;
    branch: string;
    parentHash: string | null;
    treeHash: string;
    version: string;
    message: string;
    authorAgentId: string;
    commitType: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(commits).values({
      hash: input.hash,
      repoId: input.repoId,
      branch: input.branch,
      parentHash: input.parentHash,
      treeHash: input.treeHash,
      version: input.version,
      message: input.message,
      authorAgentId: input.authorAgentId,
      commitType: input.commitType,
      metadata: JSON.stringify(input.metadata),
      createdAt: new Date(),
    });
  }

  async upsertTree(hash: string, entries: TreeEntry[]): Promise<void> {
    await this.db
      .insert(trees)
      .values({ hash, content: JSON.stringify(entries), createdAt: new Date() })
      .onConflictDoNothing({ target: trees.hash });
  }

  async getTree(hash: string): Promise<TreeEntry[]> {
    const tree = await this.db.query.trees.findFirst({ where: eq(trees.hash, hash) });
    return parseJson<TreeEntry[]>(tree?.content, []);
  }

  async blobExists(hash: string): Promise<boolean> {
    const row = await this.db.query.blobs.findFirst({ where: eq(blobs.hash, hash) });
    return Boolean(row);
  }

  async insertBlob(hash: string, size: number): Promise<void> {
    const existing = await this.db.query.blobs.findFirst({ where: eq(blobs.hash, hash) });
    if (!existing) {
      await this.db.insert(blobs).values({ hash, size, compressed: true, refCount: 1, createdAt: new Date() });
      return;
    }
    await this.db.update(blobs).set({ refCount: sql`${blobs.refCount} + 1` }).where(eq(blobs.hash, hash));
  }

  async getCurrentVersion(repoId: number, branchName: string): Promise<string | null> {
    const latest = await this.db
      .select({ version: commits.version })
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.branch, branchName)))
      .orderBy(desc(commits.createdAt))
      .limit(1);
    return latest[0]?.version ?? null;
  }

  async getLatestCommit(repoId: number, branch: string) {
    const rows = await this.db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.branch, branch)))
      .orderBy(desc(commits.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async nextPullRequestNumber(repoId: number): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`COALESCE(MAX(${pullRequests.number}), 0)` })
      .from(pullRequests)
      .where(eq(pullRequests.repoId, repoId));
    return (rows[0]?.value ?? 0) + 1;
  }

  async createPullRequest(input: {
    repoId: number;
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    createdBy: string;
  }) {
    const number = await this.nextPullRequestNumber(input.repoId);
    await this.db.insert(pullRequests).values({
      repoId: input.repoId,
      number,
      title: input.title,
      description: input.description,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      createdBy: input.createdBy,
      state: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return this.getPullRequest(input.repoId, number);
  }

  async listPullRequests(repoId: number, state?: "open" | "merged" | "closed") {
    if (state) {
      return this.db
        .select()
        .from(pullRequests)
        .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, state)))
        .orderBy(desc(pullRequests.createdAt));
    }
    return this.db.select().from(pullRequests).where(eq(pullRequests.repoId, repoId)).orderBy(desc(pullRequests.createdAt));
  }

  async getPullRequest(repoId: number, number: number) {
    const rows = await this.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
      .limit(1);
    return rows[0] ?? null;
  }

  async mergePullRequest(repoId: number, number: number, mergedBy: string, mergeCommitHash: string) {
    await this.db
      .update(pullRequests)
      .set({
        state: "merged",
        mergedBy,
        mergeCommitHash,
        updatedAt: new Date(),
      })
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)));
  }

  async closePullRequest(repoId: number, number: number) {
    await this.db
      .update(pullRequests)
      .set({ state: "closed", updatedAt: new Date() })
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)));
  }

  async addPullRequestReview(input: {
    repoId: number;
    prNumber: number;
    reviewerAgentId: string;
    decision: "approve" | "request_changes" | "comment";
    comment?: string;
  }) {
    await this.db.insert(prReviews).values({
      repoId: input.repoId,
      prNumber: input.prNumber,
      reviewerAgentId: input.reviewerAgentId,
      decision: input.decision,
      comment: input.comment,
      createdAt: new Date(),
    });
  }

  async listPullRequestReviews(repoId: number, prNumber: number) {
    return this.db
      .select()
      .from(prReviews)
      .where(and(eq(prReviews.repoId, repoId), eq(prReviews.prNumber, prNumber)))
      .orderBy(desc(prReviews.createdAt));
  }

  async createDeployment(input: {
    repoId: number;
    branch: string;
    commitHash: string;
    treeHash: string;
    triggeredBy: string;
    status: "building" | "ready" | "failed";
    entryPath?: string;
    publicUrl?: string;
    metadata?: Record<string, unknown>;
    logs?: string;
  }) {
    const rows = await this.db
      .insert(deployments)
      .values({
        repoId: input.repoId,
        branch: input.branch,
        commitHash: input.commitHash,
        treeHash: input.treeHash,
        triggeredBy: input.triggeredBy,
        status: input.status,
        entryPath: input.entryPath,
        publicUrl: input.publicUrl,
        metadata: JSON.stringify(input.metadata ?? {}),
        logs: input.logs ?? "",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: deployments.id });
    return rows[0]?.id ?? null;
  }

  async updateDeployment(
    deploymentId: number,
    patch: Partial<{
      status: "building" | "ready" | "failed";
      entryPath: string;
      publicUrl: string;
      metadata: Record<string, unknown>;
      logs: string;
    }>,
  ) {
    await this.db
      .update(deployments)
      .set({
        status: patch.status,
        entryPath: patch.entryPath,
        publicUrl: patch.publicUrl,
        metadata: patch.metadata ? JSON.stringify(patch.metadata) : undefined,
        logs: patch.logs,
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));
  }

  async getDeployment(repoId: number, deploymentId: number) {
    const rows = await this.db
      .select()
      .from(deployments)
      .where(and(eq(deployments.repoId, repoId), eq(deployments.id, deploymentId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getDeploymentById(deploymentId: number) {
    const rows = await this.db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
    return rows[0] ?? null;
  }

  async listDeployments(repoId: number, limit: number) {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.repoId, repoId))
      .orderBy(desc(deployments.createdAt))
      .limit(limit);
  }

  async promoteDeployment(repoId: number, deploymentId: number, slug: string) {
    await this.db
      .insert(deploymentAliases)
      .values({
        repoId,
        deploymentId,
        slug,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: deploymentAliases.repoId,
        set: {
          deploymentId,
          slug,
          updatedAt: new Date(),
        },
      });
  }

  async getDeploymentBySlug(slug: string) {
    const rows = await this.db
      .select({ alias: deploymentAliases, deployment: deployments })
      .from(deploymentAliases)
      .innerJoin(deployments, eq(deployments.id, deploymentAliases.deploymentId))
      .where(eq(deploymentAliases.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async createBuildJob(input: {
    deploymentId: number;
    timeoutMs: number;
    memoryLimitMb: number;
  }) {
    const rows = await this.db
      .insert(buildJobs)
      .values({
        deploymentId: input.deploymentId,
        status: "queued",
        timeoutMs: input.timeoutMs,
        memoryLimitMb: input.memoryLimitMb,
        logs: "",
        createdAt: new Date(),
      })
      .returning({ id: buildJobs.id });
    return rows[0]?.id ?? null;
  }

  async markBuildJobRunning(jobId: number) {
    await this.db.update(buildJobs).set({ status: "running", startedAt: new Date() }).where(eq(buildJobs.id, jobId));
  }

  async markBuildJobFinished(jobId: number, status: "ready" | "failed", logs: string) {
    await this.db
      .update(buildJobs)
      .set({ status, logs, completedAt: new Date() })
      .where(eq(buildJobs.id, jobId));
  }

  async listBuildJobsByDeployment(deploymentId: number) {
    return this.db.select().from(buildJobs).where(eq(buildJobs.deploymentId, deploymentId)).orderBy(desc(buildJobs.createdAt));
  }

  async getBuildJobForRepo(repoId: number, jobId: number) {
    const rows = await this.db
      .select({ job: buildJobs, deployment: deployments })
      .from(buildJobs)
      .innerJoin(deployments, eq(deployments.id, buildJobs.deploymentId))
      .where(and(eq(buildJobs.id, jobId), eq(deployments.repoId, repoId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async addDeploymentWebhook(repoId: number, url: string, secret?: string) {
    const rows = await this.db
      .insert(deploymentWebhooks)
      .values({ repoId, url, secret, enabled: true, createdAt: new Date() })
      .returning({ id: deploymentWebhooks.id });
    return rows[0]?.id ?? null;
  }

  async listDeploymentWebhooks(repoId: number) {
    return this.db.select().from(deploymentWebhooks).where(eq(deploymentWebhooks.repoId, repoId));
  }

  async getDeploymentWebhooks(repoId: number) {
    return this.db
      .select()
      .from(deploymentWebhooks)
      .where(and(eq(deploymentWebhooks.repoId, repoId), eq(deploymentWebhooks.enabled, true)));
  }

  async upsertSecret(input: {
    repoId: number;
    key: string;
    environment: string;
    encryptedValue: string;
    nonce: string;
    updatedBy: string;
  }) {
    await this.db
      .insert(repoSecrets)
      .values({
        repoId: input.repoId,
        key: input.key,
        environment: input.environment,
        encryptedValue: input.encryptedValue,
        nonce: input.nonce,
        updatedBy: input.updatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [repoSecrets.repoId, repoSecrets.key, repoSecrets.environment],
        set: {
          encryptedValue: input.encryptedValue,
          nonce: input.nonce,
          updatedBy: input.updatedBy,
          updatedAt: new Date(),
        },
      });
  }

  async listSecrets(repoId: number, environment?: string) {
    if (environment) {
      return this.db
        .select()
        .from(repoSecrets)
        .where(and(eq(repoSecrets.repoId, repoId), eq(repoSecrets.environment, environment)));
    }
    return this.db.select().from(repoSecrets).where(eq(repoSecrets.repoId, repoId));
  }

  async getSecretsByKeys(repoId: number, environment: string, keys: string[]) {
    const all = await this.listSecrets(repoId, environment);
    const requested = new Set(keys);
    return all.filter((row) => requested.has(row.key));
  }

  async deleteSecret(repoId: number, environment: string, key: string) {
    await this.db
      .delete(repoSecrets)
      .where(and(eq(repoSecrets.repoId, repoId), eq(repoSecrets.environment, environment), eq(repoSecrets.key, key)));
  }

  async createRunnerJob(input: {
    repoId: number;
    agentId: string;
    command: string;
    environment: string;
    runtime: string;
    secretRefs: string[];
    timeoutMs: number;
    memoryLimitMb: number;
  }) {
    const rows = await this.db
      .insert(runnerJobs)
      .values({
        repoId: input.repoId,
        agentId: input.agentId,
        command: input.command,
        environment: input.environment,
        runtime: input.runtime,
        status: "queued",
        secretRefs: JSON.stringify(input.secretRefs),
        timeoutMs: input.timeoutMs,
        memoryLimitMb: input.memoryLimitMb,
        logs: "",
        createdAt: new Date(),
      })
      .returning({ id: runnerJobs.id });
    return rows[0]?.id ?? null;
  }

  async markRunnerJobRunning(jobId: number) {
    await this.db.update(runnerJobs).set({ status: "running", startedAt: new Date() }).where(eq(runnerJobs.id, jobId));
  }

  async markRunnerJobFinished(jobId: number, status: "completed" | "failed" | "cancelled", logs: string, exitCode: number) {
    await this.db
      .update(runnerJobs)
      .set({ status, logs, exitCode, completedAt: new Date() })
      .where(eq(runnerJobs.id, jobId));
  }

  async cancelRunnerJob(jobId: number) {
    await this.db
      .update(runnerJobs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(runnerJobs.id, jobId), eq(runnerJobs.status, "queued")));
  }

  async getRunnerJob(repoId: number, jobId: number) {
    const rows = await this.db
      .select()
      .from(runnerJobs)
      .where(and(eq(runnerJobs.id, jobId), eq(runnerJobs.repoId, repoId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listRunnerJobs(repoId: number, limit: number) {
    return this.db.select().from(runnerJobs).where(eq(runnerJobs.repoId, repoId)).orderBy(desc(runnerJobs.createdAt)).limit(limit);
  }

  async upsertCustomDomain(input: {
    repoId: number;
    deploymentId: number;
    domain: string;
    createdBy: string;
  }) {
    await this.db
      .insert(customDomains)
      .values({
        repoId: input.repoId,
        deploymentId: input.deploymentId,
        domain: input.domain,
        verified: true,
        createdBy: input.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: customDomains.domain,
        set: {
          repoId: input.repoId,
          deploymentId: input.deploymentId,
          verified: true,
          updatedAt: new Date(),
        },
      });
  }

  async listCustomDomains(repoId: number) {
    return this.db.select().from(customDomains).where(eq(customDomains.repoId, repoId)).orderBy(desc(customDomains.createdAt));
  }

  async removeCustomDomain(repoId: number, domain: string) {
    await this.db.delete(customDomains).where(and(eq(customDomains.repoId, repoId), eq(customDomains.domain, domain)));
  }

  async getDeploymentByDomain(domain: string) {
    const rows = await this.db
      .select({ domain: customDomains, deployment: deployments })
      .from(customDomains)
      .innerJoin(deployments, eq(deployments.id, customDomains.deploymentId))
      .where(and(eq(customDomains.domain, domain), eq(customDomains.verified, true)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getRepoStatus(repoId: number, branch: string) {
    const branchRows = await this.listBranches(repoId);
    const latest = await this.getLatestCommit(repoId, branch);
    const totalCommits = await this.db
      .select({ value: count() })
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.branch, branch)));
    return {
      latest,
      branches: branchRows,
      totalCommits: totalCommits[0]?.value ?? 0,
    };
  }

  async listReposWithLastCommit(agentId: string, page: number, perPage: number) {
    const { rows, total } = await this.listRepos(agentId, page, perPage);
    const withLast = await Promise.all(
      rows.map(async (repo) => {
        const last = await this.getLatestCommit(repo.id, repo.defaultBranch);
        return { repo, last };
      }),
    );
    return { rows: withLast, total };
  }

  async getProjectContext(agentId: string, projectKey: string) {
    return this.db.query.projectContexts.findFirst({
      where: and(eq(projectContexts.agentId, agentId), eq(projectContexts.projectKey, projectKey)),
    });
  }

  async listProjectContextsByRepo(agentId: string, repoId: number) {
    return this.db
      .select()
      .from(projectContexts)
      .where(and(eq(projectContexts.agentId, agentId), eq(projectContexts.repoId, repoId)));
  }

  async upsertProjectContext(input: {
    agentId: string;
    repoId: number;
    projectKey: string;
    workspacePath?: string;
    fingerprint?: string;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await this.getProjectContext(input.agentId, input.projectKey);
    if (!existing) {
      await this.db.insert(projectContexts).values({
        agentId: input.agentId,
        repoId: input.repoId,
        projectKey: input.projectKey,
        workspacePath: input.workspacePath,
        fingerprint: input.fingerprint,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return this.getProjectContext(input.agentId, input.projectKey);
    }

    await this.db
      .update(projectContexts)
      .set({
        repoId: input.repoId,
        workspacePath: input.workspacePath,
        fingerprint: input.fingerprint,
        metadata: JSON.stringify(input.metadata ?? {}),
        updatedAt: new Date(),
      })
      .where(eq(projectContexts.id, existing.id));

    return this.getProjectContext(input.agentId, input.projectKey);
  }

  async getRepoWithBranches(repoId: number) {
    const repo = await this.getRepo(repoId);
    if (!repo) return null;
    const branchRows = await this.listBranches(repoId);
    return { repo, branchRows };
  }

  async getCommitDetails(repoId: number, hash: string) {
    const commit = await this.db
      .select()
      .from(commits)
      .where(and(eq(commits.repoId, repoId), eq(commits.hash, hash)))
      .limit(1);
    if (!commit[0]) return null;
    const treeEntries = await this.getTree(commit[0].treeHash);
    return { commit: commit[0], treeEntries };
  }

  async buildTreeMap(commitHash: string | null): Promise<Record<string, string>> {
    if (!commitHash) return {};
    const commit = await this.getCommit(commitHash);
    if (!commit) return {};
    const entries = await this.getTree(commit.treeHash);
    return Object.fromEntries(entries.filter((entry) => entry.kind !== "dir").map((entry) => [entry.path, entry.hash]));
  }

  async decodeCommitMetadata(commitHash: string): Promise<Record<string, unknown>> {
    const commit = await this.getCommit(commitHash);
    return parseJson<Record<string, unknown>>(commit?.metadata, {});
  }

  summarizeDiff(diff: DiffResult) {
    const insertions = Object.values(diff.stats).reduce((sum, item) => sum + item.linesAdded, 0);
    const deletions = Object.values(diff.stats).reduce((sum, item) => sum + item.linesRemoved, 0);
    return {
      filesChanged: Object.keys(diff.stats).length,
      insertions,
      deletions,
    };
  }
}
