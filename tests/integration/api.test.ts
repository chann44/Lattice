import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

describe("api lifecycle", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-test-"));
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

  test("returns agent skill document", async () => {
    const res = await app.request("http://localhost/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; format: string; content: string };
    expect(body.name).toBe("agent-scm-skill");
    expect(body.format).toBe("markdown");
    expect(body.content).toContain("# Agent-SCM Skill");
  });

  test("register, create repo, push, read commits", async () => {
    const { identity } = await registerAgent(app, { name: "integration-agent" });
    const repo = await createRepo(app, identity, "test-repo");
    const pushRes = await pushSnapshot(
      app,
      identity,
      repo.id,
      {
        "main.py": "def hello():\n    return 'world'",
        "README.md": "# test",
      },
      "main",
    );
    expect([200, 201]).toContain(pushRes.status);

    const commitsRes = await app.request(`http://localhost/v1/repos/${repo.id}/commits?branch=main&limit=10&offset=0`, {
      method: "GET",
      headers: {
        Authorization: signAuth(identity.agentId, identity.secretKey),
      },
    });
    expect(commitsRes.status).toBe(200);
    const history = (await commitsRes.json()) as { commits: unknown[] };
    expect(history.commits.length).toBeGreaterThan(0);
  });
});
