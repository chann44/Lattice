import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

async function waitDeploymentReady(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  repoId: number,
  deploymentId: number,
  auth: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 12_000) {
    const res = await app.request(`http://localhost/v1/repos/${repoId}/deployments/${deploymentId}`, {
      headers: { Authorization: auth },
    });
    if (res.status !== 200) {
      await Bun.sleep(100);
      continue;
    }
    const deployment = (await res.json()) as { status: string };
    if (deployment.status === "ready") return;
    if (deployment.status === "failed") throw new Error("deployment failed");
    await Bun.sleep(100);
  }
  throw new Error("deployment timeout");
}

describe("custom domains", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-domains-"));
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

  test("maps custom domain host to deployed app", async () => {
    const { identity } = await registerAgent(app, { name: "domain-owner" });
    const repo = await createRepo(app, identity, "domain-repo");

    const push = await pushSnapshot(
      app,
      identity,
      repo.id,
      {
        "index.html": "<html><body><h1>Domain Live</h1></body></html>",
      },
      "main",
    );
    expect(push.status).toBe(200);

    const deployBody = {
      branch: "main",
      runtime: "static" as const,
      entry_path: "index.html",
      promote: true,
      slug: "domain-repo-live",
      environment: "dev" as const,
      secret_refs: [],
    };
    const deploy = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, deployBody),
      },
      body: JSON.stringify(deployBody),
    });
    expect(deploy.status).toBe(201);
    const deployment = (await deploy.json()) as { id: number };
    await waitDeploymentReady(app, repo.id, deployment.id, signAuth(identity.agentId, identity.secretKey));

    const domainBody = {
      domain: "my-agent-app.example.test",
      deployment_id: deployment.id,
    };
    const bind = await app.request(`http://localhost/v1/repos/${repo.id}/domains`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, domainBody),
      },
      body: JSON.stringify(domainBody),
    });
    expect(bind.status).toBe(201);

    const list = await app.request(`http://localhost/v1/repos/${repo.id}/domains`, {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(list.status).toBe(200);

    const hostRequest = await app.request("http://localhost/", {
      headers: { Host: "my-agent-app.example.test" },
    });
    expect(hostRequest.status).toBe(200);
    expect(await hostRequest.text()).toContain("Domain Live");

    const remove = await app.request(`http://localhost/v1/repos/${repo.id}/domains/my-agent-app.example.test`, {
      method: "DELETE",
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(remove.status).toBe(200);
  });
});
