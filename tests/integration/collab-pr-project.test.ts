import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

describe("project context, permissions, and PR workflow", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-collab-"));
    const created = await createApp({
      port: 0,
      dbPath: join(root, "test.db"),
      blobsDir: join(root, "blobs"),
      maxBlobSize: 50 * 1024 * 1024,
      rateLimitPerMinute: 10_000,
      maxRequestAgeSeconds: 300,
    });
    app = created.app;
  });

  test("supports project identify and repo status endpoints", async () => {
    const { identity } = await registerAgent(app, { name: "owner-project" });

    const identifyBody = {
      project_key: "/workspace/apps/payments|git@github.com:org/payments.git|ts",
      workspace_path: "/workspace/apps/payments",
      create_if_missing: true,
      repo_name: "payments",
      description: "payments service",
      metadata: { team: "payments" },
    };

    const createIdentify = await app.request("http://localhost/v1/projects/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, identifyBody),
      },
      body: JSON.stringify(identifyBody),
    });
    expect(createIdentify.status).toBe(201);
    const created = (await createIdentify.json()) as { repo: { id: number } };

    const pushRes = await pushSnapshot(app, identity, created.repo.id, {
      "src/main.ts": "export const run = () => 'ok';",
    });
    expect(pushRes.status).toBe(200);

    const resolveBody = {
      project_key: identifyBody.project_key,
      create_if_missing: false,
    };
    const resolveIdentify = await app.request("http://localhost/v1/projects/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, resolveBody),
      },
      body: JSON.stringify(resolveBody),
    });
    expect(resolveIdentify.status).toBe(200);

    const statusRes = await app.request(`http://localhost/v1/repos/${created.repo.id}/status?branch=main`, {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { total_commits: number; latest_commit: { hash: string } };
    expect(status.total_commits).toBe(1);
    expect(status.latest_commit.hash.length).toBeGreaterThan(10);

    const lastCommitRes = await app.request(`http://localhost/v1/repos/${created.repo.id}/last-commit?branch=main`, {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(lastCommitRes.status).toBe(200);

    const reposWithLast = await app.request("http://localhost/v1/repos/with-last-commit?page=1&per_page=20", {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(reposWithLast.status).toBe(200);
    const reposPayload = (await reposWithLast.json()) as { repos: Array<{ last_commit: { hash: string } | null }> };
    expect(reposPayload.repos.some((repo) => repo.last_commit !== null)).toBeTrue();
  });

  test("supports collaborator permissions and PR flow", async () => {
    const { identity: owner } = await registerAgent(app, { name: "owner" });
    const { identity: writer } = await registerAgent(app, { name: "writer" });
    const { identity: reader } = await registerAgent(app, { name: "reader" });

    const repo = await createRepo(app, owner, "platform");
    const bootstrap = await pushSnapshot(app, owner, repo.id, { "README.md": "# platform" }, "main");
    expect(bootstrap.status).toBe(200);

    const addWriterBody = { agent_id: writer.agentId, role: "write" as const };
    const addWriter = await app.request(`http://localhost/v1/repos/${repo.id}/collaborators`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, addWriterBody),
      },
      body: JSON.stringify(addWriterBody),
    });
    expect(addWriter.status).toBe(200);

    const addReaderBody = { agent_id: reader.agentId, role: "read" as const };
    const addReader = await app.request(`http://localhost/v1/repos/${repo.id}/collaborators`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, addReaderBody),
      },
      body: JSON.stringify(addReaderBody),
    });
    expect(addReader.status).toBe(200);

    const createBranchBody = { name: "feature-agent-index", from_branch: "main" };
    const createBranch = await app.request(`http://localhost/v1/repos/${repo.id}/branches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(writer.agentId, writer.secretKey, createBranchBody),
      },
      body: JSON.stringify(createBranchBody),
    });
    expect(createBranch.status).toBe(201);

    const writerPush = await pushSnapshot(
      app,
      writer,
      repo.id,
      {
        "README.md": "# platform\n\nFeature by writer agent",
        "src/feature.ts": "export const feature = () => 'writer';",
      },
      "feature-agent-index",
    );
    expect(writerPush.status).toBe(200);

    const readerPush = await pushSnapshot(app, reader, repo.id, { "blocked.txt": "should fail" }, "main");
    expect(readerPush.status).toBe(403);

    const createPrBody = {
      title: "Agent feature contribution",
      description: "Adds feature module",
      source_branch: "feature-agent-index",
      target_branch: "main",
    };
    const createPr = await app.request(`http://localhost/v1/repos/${repo.id}/pulls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(writer.agentId, writer.secretKey, createPrBody),
      },
      body: JSON.stringify(createPrBody),
    });
    expect(createPr.status).toBe(201);
    const pr = (await createPr.json()) as { number: number };

    const reviewBody = { decision: "approve" as const, comment: "looks good" };
    const review = await app.request(`http://localhost/v1/repos/${repo.id}/pulls/${pr.number}/reviews`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, reviewBody),
      },
      body: JSON.stringify(reviewBody),
    });
    expect(review.status).toBe(200);

    const mergeBody = { strategy: "force" as const };
    const merge = await app.request(`http://localhost/v1/repos/${repo.id}/pulls/${pr.number}/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, mergeBody),
      },
      body: JSON.stringify(mergeBody),
    });
    expect(merge.status).toBe(200);

    const prDetails = await app.request(`http://localhost/v1/repos/${repo.id}/pulls/${pr.number}`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(prDetails.status).toBe(200);
    const detail = (await prDetails.json()) as { state: string; reviews: unknown[] };
    expect(detail.state).toBe("merged");
    expect(detail.reviews.length).toBe(1);
  });
});
