import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("workspace clone and sync", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-workspace-"));
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

  test("clone materializes workspace and sync returns changed files", async () => {
    const { identity } = await registerAgent(app, { name: "workspace-agent" });
    const repo = await createRepo(app, identity, "workspace-repo");

    const pushRes = await pushSnapshot(
      app,
      identity,
      repo.id,
      {
        "src/main.ts": "export const main = () => 'v1';",
        "README.md": "# workspace",
      },
      "main",
    );
    expect(pushRes.status).toBe(200);

    const cloneBody = {
      project_key: "workspace-repo|ts",
      create_if_missing: false,
      branch: "main",
    };
    const cloneRes = await app.request("http://localhost/v1/workspaces/clone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, cloneBody),
      },
      body: JSON.stringify(cloneBody),
    });
    expect(cloneRes.status).toBe(404);

    const identifyBody = {
      project_key: "workspace-repo|ts",
      create_if_missing: true,
      repo_name: "workspace-repo-identified",
    };
    const identifyRes = await app.request("http://localhost/v1/projects/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, identifyBody),
      },
      body: JSON.stringify(identifyBody),
    });
    expect(identifyRes.status).toBe(201);
    const identifyData = (await identifyRes.json()) as { repo: { id: number } };

    await pushSnapshot(
      app,
      identity,
      identifyData.repo.id,
      {
        "src/main.ts": "export const main = () => 'v1';",
      },
      "main",
    );

    const cloneRes2 = await app.request("http://localhost/v1/workspaces/clone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, cloneBody),
      },
      body: JSON.stringify(cloneBody),
    });
    expect(cloneRes2.status).toBe(200);
    const cloneData = (await cloneRes2.json()) as {
      repo: { id: number };
      files: Record<string, string>;
      state: { head_commit: string };
    };
    expect(cloneData.files["src/main.ts"]).toContain("v1");

    await pushSnapshot(
      app,
      identity,
      cloneData.repo.id,
      {
        "src/main.ts": "export const main = () => 'v1';",
        "src/new.ts": "export const extra = true;",
      },
      "main",
    );

    const localHashes = {
      "src/main.ts": hash("export const main = () => 'v1';"),
    };
    const statusBody = {
      repo_id: cloneData.repo.id,
      branch: "main",
      local_hashes: localHashes,
      local_head_commit: cloneData.state.head_commit,
    };
    const statusRes = await app.request("http://localhost/v1/workspaces/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, statusBody),
      },
      body: JSON.stringify(statusBody),
    });
    expect(statusRes.status).toBe(200);
    const statusData = (await statusRes.json()) as { behind: boolean; changes: { modified: string[]; deleted: string[] } };
    expect(statusData.behind).toBeTrue();
    expect(statusData.changes.deleted).toContain("src/new.ts");

    const syncRes = await app.request("http://localhost/v1/workspaces/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, statusBody),
      },
      body: JSON.stringify(statusBody),
    });
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as { changed_files: Record<string, string> };
    expect(syncData.changed_files["src/new.ts"]).toContain("extra");
  });
});
