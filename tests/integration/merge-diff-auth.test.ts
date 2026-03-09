import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

describe("merge and diff auth edge cases", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-merge-auth-"));
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

  test("rejects diff endpoint without auth", async () => {
    const response = await app.request("http://localhost/v1/repos/1/diff?from=a&to=b");
    expect(response.status).toBe(401);
  });

  test("forbids cross-agent merge request", async () => {
    const { identity: owner } = await registerAgent(app, { name: "owner" });
    const { identity: attacker } = await registerAgent(app, { name: "attacker" });
    const repo = await createRepo(app, owner, "owned-repo");

    await pushSnapshot(app, owner, repo.id, { "main.py": "def hello(name):\n  return name" });
    await pushSnapshot(app, owner, repo.id, { "main.py": "def hello(name, title):\n  return title + name" });

    const branchesRes = await app.request(`http://localhost/v1/repos/${repo.id}/branches`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    const branches = (await branchesRes.json()) as {
      branches: Array<{ name: string; is_experimental: boolean }>;
    };
    const experiment = branches.branches.find((b) => b.is_experimental);
    expect(experiment).toBeDefined();

    const mergeBody = { target_branch: "main", strategy: "auto" as const };
    const mergeRes = await app.request(`http://localhost/v1/repos/${repo.id}/branches/${experiment?.name}/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(attacker.agentId, attacker.secretKey, mergeBody),
      },
      body: JSON.stringify(mergeBody),
    });

    expect(mergeRes.status).toBe(403);
  });

  test("returns 409 for auto-merge breaking changes and force merge succeeds", async () => {
    const { identity } = await registerAgent(app, { name: "merge-owner" });
    const repo = await createRepo(app, identity, "merge-repo");

    const first = await pushSnapshot(app, identity, repo.id, {
      "api.py": "def calculate(x, y):\n    return x + y",
      "README.md": "# repo",
    });
    expect(first.status).toBe(200);

    const second = await pushSnapshot(app, identity, repo.id, {
      "api.py": "def calculate(x, y, z):\n    return x + y + z",
      "README.md": "# repo",
    });
    expect(second.status).toBe(201);
    const secondData = (await second.json()) as { commit: { branch: string } };

    const autoBody = { target_branch: "main", strategy: "auto" as const };
    const autoMergeRes = await app.request(
      `http://localhost/v1/repos/${repo.id}/branches/${secondData.commit.branch}/merge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: signAuth(identity.agentId, identity.secretKey, autoBody),
        },
        body: JSON.stringify(autoBody),
      },
    );
    expect(autoMergeRes.status).toBe(409);

    const forceBody = { target_branch: "main", strategy: "force" as const };
    const forceMergeRes = await app.request(
      `http://localhost/v1/repos/${repo.id}/branches/${secondData.commit.branch}/merge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: signAuth(identity.agentId, identity.secretKey, forceBody),
        },
        body: JSON.stringify(forceBody),
      },
    );
    expect(forceMergeRes.status).toBe(200);
  });
});
