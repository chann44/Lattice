import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { createRepo, pushSnapshot, registerAgent, signAuth } from "../helpers/client";

describe("runtime proxy routes", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];
  let repoService: Awaited<ReturnType<typeof createApp>>["repoService"];
  let runtimeServer: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-runtime-proxy-"));
    const created = await createApp({
      port: 0,
      dbPath: join(root, "test.db"),
      blobsDir: join(root, "blobs"),
      maxBlobSize: 50 * 1024 * 1024,
      rateLimitPerMinute: 10_000,
      maxRequestAgeSeconds: 300,
    });
    app = created.app;
    repoService = created.repoService;

    runtimeServer = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/api/health") {
          return Response.json({ ok: true, from: "runtime" });
        }
        if (url.pathname === "/") {
          return new Response("runtime-home");
        }
        return new Response(`runtime:${url.pathname}`);
      },
    });
  });

  afterAll(() => {
    runtimeServer.stop(true);
  });

  test("proxies /apps/:slug/* and /deployments/:id/* to runtime URL", async () => {
    const { identity } = await registerAgent(app, { name: "runtime-proxy-agent" });
    const repo = await createRepo(app, identity, "runtime-proxy-repo");

    const push = await pushSnapshot(app, identity, repo.id, {
      "index.html": "<html><body>fallback</body></html>",
    });
    expect(push.status).toBe(200);

    const commitsRes = await app.request(`http://localhost/v1/repos/${repo.id}/commits?branch=main&limit=1`, {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(commitsRes.status).toBe(200);
    const commits = (await commitsRes.json()) as { commits: Array<{ hash: string }> };
    const headHash = commits.commits[0]?.hash;
    expect(headHash).toBeDefined();

    const headCommit = await repoService.getCommit(headHash!);
    expect(headCommit).toBeTruthy();

    const deploymentId = await repoService.createDeployment({
      repoId: repo.id,
      branch: "main",
      commitHash: headHash!,
      treeHash: headCommit!.treeHash,
      triggeredBy: identity.agentId,
      status: "ready",
      entryPath: "index.html",
      publicUrl: "/deployments/999",
      metadata: {
        slug: "runtime-proxy-live",
        runtime_proxy_url: `http://127.0.0.1:${runtimeServer.port}`,
      },
      logs: "ready",
    });
    expect(deploymentId).toBeTruthy();

    await repoService.promoteDeployment(repo.id, deploymentId!, "runtime-proxy-live");

    const appApi = await app.request("http://localhost/apps/runtime-proxy-live/api/health");
    expect(appApi.status).toBe(200);
    const appApiJson = (await appApi.json()) as { from: string };
    expect(appApiJson.from).toBe("runtime");

    const appRoot = await app.request("http://localhost/apps/runtime-proxy-live/");
    expect(appRoot.status).toBe(200);
    expect(await appRoot.text()).toContain("runtime-home");

    const immutable = await app.request(`http://localhost/deployments/${deploymentId}/api/health`);
    expect(immutable.status).toBe(200);
    const immutableJson = (await immutable.json()) as { ok: boolean };
    expect(immutableJson.ok).toBeTrue();
  });
});
