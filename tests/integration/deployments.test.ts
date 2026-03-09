import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

async function waitForDeploymentReady(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  repoId: number,
  deploymentId: number,
  authHeader: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const statusRes = await app.request(`http://localhost/v1/repos/${repoId}/deployments/${deploymentId}`, {
      headers: { Authorization: authHeader },
    });
    if (statusRes.status !== 200) {
      await Bun.sleep(100);
      continue;
    }
    const status = (await statusRes.json()) as { status: string };
    if (status.status === "ready") return;
    if (status.status === "failed") throw new Error("deployment failed");
    await Bun.sleep(100);
  }
  throw new Error("deployment did not become ready in time");
}

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

    await waitForDeploymentReady(app, repo.id, deployment.id, signAuth(owner.agentId, owner.secretKey));

    const jobsRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments/${deployment.id}/build-jobs`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(jobsRes.status).toBe(200);
    const jobs = (await jobsRes.json()) as { build_jobs: Array<{ id: number; status: string; logs: string }> };
    expect(jobs.build_jobs.length).toBeGreaterThan(0);
    expect(jobs.build_jobs[0]?.status).toBe("ready");

    const firstJobId = jobs.build_jobs[0]?.id;
    expect(firstJobId).toBeDefined();

    const jobDetailRes = await app.request(`http://localhost/v1/repos/${repo.id}/build-jobs/${firstJobId}`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(jobDetailRes.status).toBe(200);

    const jobLogsRes = await app.request(`http://localhost/v1/repos/${repo.id}/build-jobs/${firstJobId}/logs`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(jobLogsRes.status).toBe(200);
    const jobLogs = (await jobLogsRes.json()) as { logs: string };
    expect(jobLogs.logs.length).toBeGreaterThan(0);

    const linksRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments/${deployment.id}/links`, {
      headers: { Authorization: signAuth(owner.agentId, owner.secretKey) },
    });
    expect(linksRes.status).toBe(200);
    const links = (await linksRes.json()) as { links: { promoted: string; immutable: string } };
    expect(links.links.promoted).toContain("/apps/");
    expect(links.links.immutable).toContain("/deployments/");

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

  test("sends deployment webhooks on status updates", async () => {
    const { identity: owner } = await registerAgent(app, { name: "deploy-webhook-owner" });
    const repo = await createRepo(app, owner, "deploy-webhook-repo");

    await pushSnapshot(app, owner, repo.id, { "index.html": "<html>Webhook</html>" }, "main");

    const events: Array<{ event: string; status: string }> = [];
    const receiver = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const payload = (await request.json()) as { event: string; status: string };
        events.push({ event: payload.event, status: payload.status });
        return new Response("ok");
      },
    });

    try {
      const webhookBody = { url: `http://127.0.0.1:${receiver.port}/hook`, secret: "topsecret" };
      const addWebhook = await app.request(`http://localhost/v1/repos/${repo.id}/deployment-webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: signAuth(owner.agentId, owner.secretKey, webhookBody),
        },
        body: JSON.stringify(webhookBody),
      });
      expect(addWebhook.status).toBe(201);

      const deployBody = { branch: "main", promote: false, slug: "webhook-app" };
      const deployRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: signAuth(owner.agentId, owner.secretKey, deployBody),
        },
        body: JSON.stringify(deployBody),
      });
      expect(deployRes.status).toBe(201);
      const deployment = (await deployRes.json()) as { id: number };

      await waitForDeploymentReady(app, repo.id, deployment.id, signAuth(owner.agentId, owner.secretKey));

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((event) => event.event === "deployment.updated" && event.status === "ready")).toBeTrue();
    } finally {
      receiver.stop(true);
    }
  });

  test("returns docker template guidance when Dockerfile is missing", async () => {
    const { identity: owner } = await registerAgent(app, { name: "docker-template-owner" });
    const repo = await createRepo(app, owner, "docker-template-repo");
    await pushSnapshot(app, owner, repo.id, { "index.html": "<html><body>hello</body></html>" }, "main");

    const triggerBody = {
      branch: "main",
      runtime: "docker" as const,
      framework: "next" as const,
      dockerfile_path: "infra/Dockerfile.prod",
      compose_file_path: "infra/docker-compose.prod.yml",
      promote: false,
    };
    const trigger = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(owner.agentId, owner.secretKey, triggerBody),
      },
      body: JSON.stringify(triggerBody),
    });
    expect(trigger.status).toBe(409);
    const payload = (await trigger.json()) as { docker_template?: string; docker_compose_template?: string };
    expect(payload.docker_template).toContain("bun run build");
    expect(payload.docker_compose_template).toContain("services:");

    const catalog = await app.request("http://localhost/v1/deploy/templates");
    expect(catalog.status).toBe(200);

    const template = await app.request("http://localhost/v1/deploy/templates/docker?framework=react");
    expect(template.status).toBe(200);
    const templateJson = (await template.json()) as { dockerfile: string };
    expect(templateJson.dockerfile).toContain("bun build index.html");

    const composeTemplate = await app.request("http://localhost/v1/deploy/templates/docker-compose?profile=next");
    expect(composeTemplate.status).toBe(200);
    const composeJson = (await composeTemplate.json()) as { compose: string };
    expect(composeJson.compose).toContain("services:");
  });
});
