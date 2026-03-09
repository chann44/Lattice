import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import type { AppConfig } from "./types/api";
import { createDb } from "./db/client";
import { initSchema } from "./db/init";
import { branches, commits, repos } from "./db/schema";
import { BlobStore } from "./lib/blob-store";
import { deriveAgentId, parseAuthHeader, verifyRequestSignature } from "./lib/auth";
import { RateLimiter } from "./lib/rate-limiter";
import { sha256Hex } from "./lib/hash";
import { RepositoryService } from "./services/repository";
import {
  buildUnifiedDiff,
  bumpVersion,
  computeDiff,
  createTreeEntries,
  determineVersionBump,
  generateCommitMessage,
  shouldCreateExperimentalBranch,
} from "./services/vcs";

type AppEnv = {
  Variables: {
    agentId: string;
    rawBody: string;
  };
};

const registerSchema = z.object({
  public_key: z.string().min(64),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const createRepoSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().optional().default(""),
  default_branch: z.string().optional().default("main"),
});

const pushSchema = z.object({
  branch: z.string().optional().default("main"),
  files: z.record(z.string(), z.string()),
  message: z.string().optional(),
});

const checkHashesSchema = z.object({
  hashes: z.record(z.string(), z.string()),
});

const mergeSchema = z.object({
  target_branch: z.string(),
  strategy: z.enum(["auto", "force"]).default("auto"),
});

const metrics = {
  pushTotal: 0,
};

export async function createApp(config: AppConfig) {
  await mkdir(config.blobsDir, { recursive: true });
  await mkdir(config.dbPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });

  const db = createDb(config.dbPath);
  initSchema(db);

  const repoService = new RepositoryService(db);
  const blobStore = new BlobStore(config.blobsDir);
  const limiter = new RateLimiter(config.rateLimitPerMinute, 60_000);

  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const rawBody = await c.req.raw.clone().text();
    c.set("rawBody", rawBody);
    if (c.req.path === "/health" || c.req.path === "/metrics" || c.req.path === "/v1/register") {
      await next();
      return;
    }

    const authValue = c.req.header("authorization") ?? "";
    const parsed = parseAuthHeader(authValue);
    if (!parsed) return error(c, 401, "Unauthorized", "Invalid auth header");

    const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
    if (age > config.maxRequestAgeSeconds) {
      return error(c, 401, "Unauthorized", "Request expired");
    }

    if (!limiter.allow(parsed.agentId)) {
      return error(c, 429, "Rate limit exceeded", "Too many requests");
    }

    const agent = await repoService.getAgent(parsed.agentId);
    if (!agent) return error(c, 401, "Unauthorized", "Agent not found");

    const valid = verifyRequestSignature({
      agentId: parsed.agentId,
      timestamp: parsed.timestamp,
      signatureHex: parsed.signatureHex,
      publicKeyHex: agent.publicKey,
      rawBody,
    });

    if (!valid) return error(c, 401, "Unauthorized", "Invalid signature");

    await repoService.updateAgentLastSeen(parsed.agentId);
    c.set("agentId", parsed.agentId);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/metrics", (c) => c.text(`agent_scm_push_total ${metrics.pushTotal}\n`));

  app.post("/v1/register", async (c) => {
    const parsed = registerSchema.safeParse(parseBody(c.get("rawBody")));
    if (!parsed.success) return error(c, 400, "Invalid public key", parsed.error.message);

    const existing = await repoService.getAgentByPublicKey(parsed.data.public_key);
    if (existing) return error(c, 409, "Resource conflict", "Public key already registered");

    const agentId = deriveAgentId(parsed.data.public_key);
    await repoService.createAgent(agentId, parsed.data.public_key, parsed.data.metadata);

    return c.json(
      {
        agent_id: agentId,
        public_key: parsed.data.public_key,
        created_at: new Date().toISOString(),
      },
      201,
    );
  });

  app.get("/v1/agent/me", async (c) => {
    const agent = await repoService.getAgent(c.get("agentId"));
    if (!agent) return error(c, 404, "Not found", "Agent not found");
    return c.json({
      id: agent.id,
      public_key: agent.publicKey,
      created_at: toISOString(agent.createdAt),
      last_seen: toISOString(agent.lastSeen),
      metadata: parseBody(agent.metadata ?? "{}"),
    });
  });

  app.post("/v1/repos", async (c) => {
    const body = createRepoSchema.safeParse(parseBody(c.get("rawBody")));
    if (!body.success) return error(c, 400, "Invalid repo name", body.error.message);

    try {
      const id = await repoService.createRepo(c.get("agentId"), body.data.name, body.data.description, body.data.default_branch);
      const repo = await repoService.getRepo(id);
      return c.json(
        {
          id,
          agent_id: c.get("agentId"),
          name: body.data.name,
          namespace: `${c.get("agentId")}/${body.data.name}`,
          default_branch: repo?.defaultBranch ?? body.data.default_branch,
          created_at: toISOString(repo?.createdAt),
        },
        201,
      );
    } catch (err) {
      return error(c, 409, "Resource conflict", String(err));
    }
  });

  app.get("/v1/repos", async (c) => {
    const page = Number(c.req.query("page") ?? "1");
    const perPage = Number(c.req.query("per_page") ?? "20");
    const result = await repoService.listRepos(c.get("agentId"), page, perPage);
    return c.json({
      repos: result.rows.map((repo) => ({
        id: repo.id,
        name: repo.name,
        namespace: `${repo.agentId}/${repo.name}`,
        default_branch: repo.defaultBranch,
        created_at: toISOString(repo.createdAt),
        updated_at: toISOString(repo.updatedAt),
      })),
      total: result.total,
      page,
      per_page: perPage,
    });
  });

  app.get("/v1/repos/:id", async (c) => {
    const repoId = Number(c.req.param("id"));
    const joined = await repoService.getRepoWithBranches(repoId);
    if (!joined) return error(c, 404, "Not found", "Repo not found");
    if (joined.repo.agentId !== c.get("agentId")) return error(c, 403, "Forbidden", "Repo belongs to different agent");
    return c.json({
      id: joined.repo.id,
      agent_id: joined.repo.agentId,
      name: joined.repo.name,
      namespace: `${joined.repo.agentId}/${joined.repo.name}`,
      default_branch: joined.repo.defaultBranch,
      branches: joined.branchRows.map((b) => b.name),
      created_at: toISOString(joined.repo.createdAt),
      updated_at: toISOString(joined.repo.updatedAt),
    });
  });

  app.post("/v1/repos/:id/check-hashes", async (c) => {
    const repo = await authorizedRepo(c, repoService);
    if (!repo.ok) return repo.response;
    const body = checkHashesSchema.safeParse(parseBody(c.get("rawBody")));
    if (!body.success) return error(c, 400, "Invalid files", body.error.message);
    const needed: string[] = [];
    const alreadyHave: string[] = [];
    for (const [path, hash] of Object.entries(body.data.hashes)) {
      const exists = (await repoService.blobExists(hash)) && (await blobStore.exists(hash));
      if (exists) alreadyHave.push(path);
      else needed.push(path);
    }
    return c.json({ needed, already_have: alreadyHave });
  });

  app.post("/v1/repos/:id/push", async (c) => {
    metrics.pushTotal += 1;
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const repo = repoResult.repo;

    const body = pushSchema.safeParse(parseBody(c.get("rawBody")));
    if (!body.success) return error(c, 400, "Invalid files", body.error.message);
    if (Object.keys(body.data.files).length === 0) return error(c, 400, "Invalid files", "files cannot be empty");

    let totalBytes = 0;
    for (const [path, content] of Object.entries(body.data.files)) {
      if (path.includes("..")) return error(c, 400, "Invalid files", `invalid path ${path}`);
      totalBytes += new TextEncoder().encode(content).byteLength;
    }
    if (totalBytes > config.maxBlobSize) return error(c, 413, "Payload too large", "Payload exceeds max blob size");

    const sourceBranch = await repoService.getBranch(repo.id, body.data.branch);
    if (!sourceBranch) return error(c, 404, "Not found", "Branch not found");

    const fileHashes: Record<string, string> = {};
    for (const [path, content] of Object.entries(body.data.files)) {
      const hash = sha256Hex(content);
      fileHashes[path] = hash;
      const exists = (await repoService.blobExists(hash)) && (await blobStore.exists(hash));
      if (!exists) {
        await blobStore.write(hash, content);
      }
      await repoService.insertBlob(hash, content.length);
    }

    const entries = createTreeEntries(body.data.files, fileHashes);
    const treeHash = sha256Hex(JSON.stringify(entries));
    await repoService.upsertTree(treeHash, entries);

    const oldTree = await repoService.buildTreeMap(sourceBranch.headCommit);
    const newTree = Object.fromEntries(entries.map((e) => [e.path, e.hash]));
    const diff = await computeDiff(oldTree, newTree, (hash) => blobStore.read(hash));
    const summary = repoService.summarizeDiff(diff);

    if (summary.filesChanged === 0) {
      const currentVersion = await repoService.getCurrentVersion(repo.id, body.data.branch);
      return c.json({
        message: "No changes detected",
        current_version: currentVersion,
        head_commit: sourceBranch.headCommit,
      });
    }

    const bump = determineVersionBump(diff);
    const previousVersion = await repoService.getCurrentVersion(repo.id, body.data.branch);
    let version = bumpVersion(previousVersion, bump);
    let commitType: string = bump;
    let commitBranch = body.data.branch;

    const experimentalDecision = shouldCreateExperimentalBranch(diff);
    if (experimentalDecision.shouldBranch) {
      commitType = "EXPERIMENTAL";
      commitBranch = `experiment-${timestampTag()}`;
      version = `${version}-exp`;
      await repoService.createBranch(
        repo.id,
        commitBranch,
        sourceBranch.headCommit,
        experimentalDecision.reason,
        body.data.branch,
      );
    }

    const metadata = {
      files_changed: summary.filesChanged,
      lines_added: summary.insertions,
      lines_removed: summary.deletions,
      diff,
    };

    const commitHash = sha256Hex(
      JSON.stringify({
        repo_id: repo.id,
        branch: commitBranch,
        parent: sourceBranch.headCommit,
        tree_hash: treeHash,
        version,
        type: commitType,
        ts: Date.now(),
      }),
    );

    const message = body.data.message ?? generateCommitMessage(diff);
    await repoService.insertCommit({
      hash: commitHash,
      repoId: repo.id,
      branch: commitBranch,
      parentHash: sourceBranch.headCommit,
      treeHash,
      version,
      message,
      authorAgentId: c.get("agentId"),
      commitType,
      metadata,
    });
    await repoService.updateBranchHead(repo.id, commitBranch, commitHash);

    const commitPayload = {
      hash: commitHash,
      version,
      message,
      branch: commitBranch,
      commit_type: commitType,
      created_at: new Date().toISOString(),
    };

    if (commitType === "EXPERIMENTAL") {
      return c.json(
        {
          commit: commitPayload,
          experimental: {
            reason: experimentalDecision.reason,
            parent_branch: body.data.branch,
            risk_score: experimentalDecision.riskScore,
            can_auto_merge: false,
          },
          changes: {
            added: diff.added,
            modified: diff.modified,
            deleted: diff.deleted,
            stats: {
              files_changed: summary.filesChanged,
              insertions: summary.insertions,
              deletions: summary.deletions,
            },
          },
        },
        201,
      );
    }

    return c.json({
      commit: commitPayload,
      changes: {
        added: diff.added,
        modified: diff.modified,
        deleted: diff.deleted,
        stats: {
          files_changed: summary.filesChanged,
          insertions: summary.insertions,
          deletions: summary.deletions,
        },
      },
      previous_version: previousVersion,
    });
  });

  app.get("/v1/repos/:id/commits", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;

    const branch = c.req.query("branch") ?? repoResult.repo.defaultBranch;
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");

    const rows = await repoService.listCommits(repoResult.repo.id, branch, limit, offset);
    return c.json({
      commits: rows.rows.map((item) => {
        const metadata = parseBody(item.metadata ?? "{}");
        return {
          hash: item.hash,
          version: item.version,
          message: item.message,
          branch: item.branch,
          commit_type: item.commitType,
          parent_hash: item.parentHash,
          created_at: toISOString(item.createdAt),
          stats: {
            files_changed: metadata.files_changed ?? 0,
            insertions: metadata.lines_added ?? 0,
            deletions: metadata.lines_removed ?? 0,
          },
        };
      }),
      total: rows.total,
      limit,
      offset,
    });
  });

  app.get("/v1/repos/:id/commits/:hash", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const detail = await repoService.getCommitDetails(repoResult.repo.id, c.req.param("hash"));
    if (!detail) return error(c, 404, "Not found", "Commit not found");
    return c.json({
      hash: detail.commit.hash,
      version: detail.commit.version,
      message: detail.commit.message,
      branch: detail.commit.branch,
      commit_type: detail.commit.commitType,
      parent_hash: detail.commit.parentHash,
      tree_hash: detail.commit.treeHash,
      created_at: toISOString(detail.commit.createdAt),
      files: detail.treeEntries,
    });
  });

  app.get("/v1/repos/:id/tree", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const commitHash = c.req.query("commit");
    if (!commitHash) return error(c, 400, "Not found", "commit query is required");
    const detail = await repoService.getCommitDetails(repoResult.repo.id, commitHash);
    if (!detail) return error(c, 404, "Not found", "Commit not found");
    return c.json({
      commit: commitHash,
      path: c.req.query("path") ?? "/",
      entries: detail.treeEntries,
    });
  });

  app.get("/v1/repos/:id/blob/:hash", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const hash = c.req.param("hash");
    const exists = await blobStore.exists(hash);
    if (!exists) return error(c, 404, "Not found", "Blob not found");
    const content = await blobStore.read(hash);
    return new Response(content, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  });

  app.get("/v1/repos/:id/branches", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const list = await repoService.listBranches(repoResult.repo.id);
    return c.json({
      branches: list.map((item) => ({
        name: item.name,
        head_commit: item.headCommit,
        is_experimental: item.isExperimental,
        experiment_reason: item.experimentReason,
        parent_branch: item.parentBranch,
        created_at: toISOString(item.createdAt),
        updated_at: toISOString(item.updatedAt),
      })),
    });
  });

  app.post("/v1/repos/:id/branches/:name/merge", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;

    const body = mergeSchema.safeParse(parseBody(c.get("rawBody")));
    if (!body.success) return error(c, 400, "Invalid request", body.error.message);

    const source = await repoService.getBranch(repoResult.repo.id, c.req.param("name"));
    const target = await repoService.getBranch(repoResult.repo.id, body.data.target_branch);
    if (!source || !target) return error(c, 404, "Not found", "Branch not found");
    if (!source.headCommit) return error(c, 409, "Resource conflict", "Source branch is empty");

    if (body.data.strategy === "auto" && target.headCommit) {
      const sourceMap = await repoService.buildTreeMap(source.headCommit);
      const targetMap = await repoService.buildTreeMap(target.headCommit);
      const diff = await computeDiff(targetMap, sourceMap, (hash) => blobStore.read(hash));
      const hasBreaking = Object.values(diff.stats).some((s) => s.isBreaking);
      if (hasBreaking) {
        return c.json(
          {
            success: false,
            error: "Cannot auto-merge: breaking changes detected",
            conflicts: Object.values(diff.stats).filter((s) => s.isBreaking).map((s) => s.path),
            suggestion: "Review changes manually or use force strategy",
          },
          409,
        );
      }
    }

    const sourceCommit = await repoService.getCommit(source.headCommit);
    if (!sourceCommit) return error(c, 404, "Not found", "Source commit not found");

    const previousVersion = await repoService.getCurrentVersion(repoResult.repo.id, target.name);
    const mergeVersion = bumpVersion(previousVersion, "PATCH");
    const mergeHash = sha256Hex(
      JSON.stringify({
        repo: repoResult.repo.id,
        source: source.name,
        target: target.name,
        ts: Date.now(),
      }),
    );

    await repoService.insertCommit({
      hash: mergeHash,
      repoId: repoResult.repo.id,
      branch: target.name,
      parentHash: target.headCommit,
      treeHash: sourceCommit.treeHash,
      version: mergeVersion,
      message: `Merged ${source.name} into ${target.name}`,
      authorAgentId: c.get("agentId"),
      commitType: "PATCH",
      metadata: { merge: { source: source.name, strategy: body.data.strategy } },
    });

    await repoService.updateBranchHead(repoResult.repo.id, target.name, mergeHash);
    return c.json({
      success: true,
      merge_commit: mergeHash,
      message: `Merged ${source.name} into ${target.name}`,
    });
  });

  app.get("/v1/repos/:id/diff", async (c) => {
    const repoResult = await authorizedRepo(c, repoService);
    if (!repoResult.ok) return repoResult.response;
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return error(c, 400, "Invalid request", "from and to are required");

    const fromMap = await repoService.buildTreeMap(from);
    const toMap = await repoService.buildTreeMap(to);
    const diff = await computeDiff(fromMap, toMap, (hash) => blobStore.read(hash));

    const files = await Promise.all(
      Object.entries(diff.stats).map(async ([path, stat]) => {
        const oldContent = stat.oldHash ? await blobStore.read(stat.oldHash) : "";
        const newContent = stat.newHash ? await blobStore.read(stat.newHash) : "";
        return {
          path,
          status: diff.added.includes(path) ? "added" : diff.deleted.includes(path) ? "deleted" : "modified",
          additions: stat.linesAdded,
          deletions: stat.linesRemoved,
          diff: buildUnifiedDiff(oldContent, newContent),
        };
      }),
    );

    const summary = repoService.summarizeDiff(diff);
    return c.json({
      from_commit: from,
      to_commit: to,
      files,
      summary: {
        files_changed: summary.filesChanged,
        insertions: summary.insertions,
        deletions: summary.deletions,
      },
    });
  });

  return { app, db, repoService, blobStore };
}

function error(c: Context<AppEnv>, code: number, message: string, details?: string) {
  return c.json(
    {
      error: {
        code,
        message,
        details,
      },
    },
    code as 400,
  );
}

async function authorizedRepo(c: Context<AppEnv>, repoService: RepositoryService) {
  const repoId = Number(c.req.param("id"));
  const repo = await repoService.getRepo(repoId);
  if (!repo) return { ok: false as const, response: error(c, 404, "Not found", "Repo not found") };
  if (repo.agentId !== c.get("agentId")) {
    return { ok: false as const, response: error(c, 403, "Forbidden", "Repo belongs to different agent") };
  }
  return { ok: true as const, repo };
}

function parseBody(raw: string): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toISOString(value: Date | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function timestampTag() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hhmmss = now.toTimeString().slice(0, 8).replace(/:/g, "");
  return `${date}-${hhmmss}`;
}
