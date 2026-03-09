import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

async function waitForJobComplete(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  repoId: number,
  jobId: number,
  auth: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const res = await app.request(`http://localhost/v1/repos/${repoId}/jobs/${jobId}`, {
      headers: { Authorization: auth },
    });
    if (res.status !== 200) {
      await Bun.sleep(100);
      continue;
    }
    const job = (await res.json()) as { status: string };
    if (job.status === "completed") return;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(`job finished with ${job.status}`);
    }
    await Bun.sleep(100);
  }
  throw new Error("job timeout");
}

describe("secrets and runner jobs", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-secrets-jobs-"));
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

  test("stores encrypted secrets and runs jobs with masked logs", async () => {
    const { identity: owner } = await registerAgent(app, { name: "secrets-owner" });
    const { identity: reader } = await registerAgent(app, { name: "secrets-reader" });
    const repo = await createRepo(app, owner, "secrets-jobs-repo");

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

    await pushSnapshot(
      app,
      owner,
      repo.id,
      {
        "run.sh": "#!/bin/sh\necho \"KEY=$API_KEY\"\necho \"DB=$DATABASE_URL\"\n",
      },
      "main",
    );

    const secretApiKeyBody = { key: "API_KEY", value: "super-secret-key-123", environment: "dev" as const };
    const saveApi = await app.request(`http://localhost/v1/repos/${repo.id}/secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, secretApiKeyBody),
      },
      body: JSON.stringify(secretApiKeyBody),
    });
    expect(saveApi.status).toBe(201);

    const secretDbBody = {
      key: "DATABASE_URL",
      value: "postgres://user:pass@localhost:5432/app",
      environment: "dev" as const,
    };
    const saveDb = await app.request(`http://localhost/v1/repos/${repo.id}/secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, secretDbBody),
      },
      body: JSON.stringify(secretDbBody),
    });
    expect(saveDb.status).toBe(201);

    const listSecrets = await app.request(`http://localhost/v1/repos/${repo.id}/secrets?environment=dev`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(listSecrets.status).toBe(200);
    const listed = (await listSecrets.json()) as { secrets: Array<{ key: string; value?: string }> };
    expect(listed.secrets.some((item) => item.key === "API_KEY")).toBeTrue();
    expect(JSON.stringify(listed)).not.toContain("super-secret-key-123");

    const forbiddenSecret = await app.request(`http://localhost/v1/repos/${repo.id}/secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(reader.agentId, reader.secretKey, secretApiKeyBody),
      },
      body: JSON.stringify(secretApiKeyBody),
    });
    expect(forbiddenSecret.status).toBe(403);

    const runBody = {
      command: "sh run.sh",
      branch: "main",
      environment: "dev" as const,
      runtime: "shell" as const,
      secret_refs: ["API_KEY", "DATABASE_URL"],
      timeout_ms: 120000,
      memory_limit_mb: 512,
    };
    const runJob = await app.request(`http://localhost/v1/repos/${repo.id}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, runBody),
      },
      body: JSON.stringify(runBody),
    });
    expect(runJob.status).toBe(201);
    const job = (await runJob.json()) as { id: number };

    await waitForJobComplete(app, repo.id, job.id, signAuth(owner.agentId, owner.secretKey));

    const logsRes = await app.request(`http://localhost/v1/repos/${repo.id}/jobs/${job.id}/logs`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(logsRes.status).toBe(200);
    const logs = (await logsRes.json()) as { logs: string };
    expect(logs.logs).toContain("KEY=***");
    expect(logs.logs).toContain("DB=***");
    expect(logs.logs).not.toContain("super-secret-key-123");
    expect(logs.logs).not.toContain("postgres://user:pass@localhost:5432/app");

    const deployBody = {
      branch: "main",
      runtime: "static" as const,
      framework: "generic" as const,
      entry_path: "run.sh",
      environment: "dev" as const,
      secret_refs: ["API_KEY"],
      promote: false,
    };
    const deployRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, deployBody),
      },
      body: JSON.stringify(deployBody),
    });
    expect(deployRes.status).toBe(201);
  });
});
