import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

describe("deployments workflow", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-deployments-"));
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

  test("trigger and promote deployment and serve public routes", async () => {
    const { identity: owner } = await registerAgent(app, { name: "deploy-owner" });
    const { identity: reader } = await registerAgent(app, { name: "deploy-reader" });
    const repo = await createRepo(app, owner, "deployable-repo");

    await pushSnapshot(
      app,
      owner,
      repo.id,
      {
        "index.html": "<html><body><h1>Hello Deploy</h1></body></html>",
        "assets/app.js": "console.log('ok')",
      },
      "main",
    );

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

    const forbiddenDeployBody = { branch: "main", promote: true };
    const forbiddenDeploy = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(reader.agentId, reader.secretKey, forbiddenDeployBody),
      },
      body: JSON.stringify(forbiddenDeployBody),
    });
    expect(forbiddenDeploy.status).toBe(403);

    const deployBody = { branch: "main", promote: true, slug: "hello-agent-app" };
    const deployRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, deployBody),
      },
      body: JSON.stringify(deployBody),
    });
    expect(deployRes.status).toBe(201);
    const deployment = (await deployRes.json()) as { id: number; app_url: string; deployment_url: string };

    const statusRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments/${deployment.id}`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { status: string };
    expect(status.status).toBe("ready");

    const immutableIndex = await app.request(`http://localhost${deployment.deployment_url}/index.html`);
    expect(immutableIndex.status).toBe(200);
    expect(await immutableIndex.text()).toContain("Hello Deploy");

    const promotedIndex = await app.request(`http://localhost${deployment.app_url}/index.html`);
    expect(promotedIndex.status).toBe(200);
    expect(await promotedIndex.text()).toContain("Hello Deploy");

    const promotedAsset = await app.request(`http://localhost${deployment.app_url}/assets/app.js`);
    expect(promotedAsset.status).toBe(200);
    expect(await promotedAsset.text()).toContain("console.log");
  });
});
