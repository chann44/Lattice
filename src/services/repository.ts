import { and, count, desc, eq, sql } from "drizzle-orm";
import type { DBClient } from "../db/client";
import { agents, blobs, branches, commits, repos, trees } from "../db/schema";
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

  async getBranch(repoId: number, name: string) {
    return this.db.query.branches.findFirst({ where: and(eq(branches.repoId, repoId), eq(branches.name, name)) });
  }

  async createBranch(repoId: number, name: string, headCommit: string | null, reason: string, parentBranch: string): Promise<void> {
    await this.db.insert(branches).values({
      repoId,
      name,
      headCommit,
      isExperimental: true,
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
    return Object.fromEntries(entries.map((entry) => [entry.path, entry.hash]));
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
