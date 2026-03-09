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
  const start = Date.now();
  while (Date.now() - start < 10_000) {
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

describe("x402 payments and domain purchase", () => {
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-payments-domains-"));
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

  test("requires payment then purchases domain and enables auto-follow policy", async () => {
    const { identity } = await registerAgent(app, { name: "billing-agent" });
    const repo = await createRepo(app, identity, "billing-repo");

    const push = await pushSnapshot(
      app,
      identity,
      repo.id,
      {
        "index.html": "<html><body><h1>Billing Domain App</h1></body></html>",
      },
      "main",
    );
    expect(push.status).toBe(200);

    const deployBody = {
      branch: "main",
      runtime: "static" as const,
      entry_path: "index.html",
      promote: true,
      slug: "billing-domain-live",
      environment: "prod" as const,
      secret_refs: [],
    };
    const deployRes = await app.request(`http://localhost/v1/repos/${repo.id}/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, deployBody),
      },
      body: JSON.stringify(deployBody),
    });
    expect(deployRes.status).toBe(201);
    const deploy = (await deployRes.json()) as { id: number };
    await waitDeploymentReady(app, repo.id, deploy.id, signAuth(identity.agentId, identity.secretKey));

    const purchaseReq = {
      repo_id: repo.id,
      domain: "agent-billing.example.test",
      period_years: 1,
      auto_follow: true,
      target_branch: "main",
      target_environment: "prod" as const,
    };
    const unpaid = await app.request("http://localhost/v1/domains/purchase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, purchaseReq),
      },
      body: JSON.stringify(purchaseReq),
    });
    expect(unpaid.status).toBe(402);
    const unpaidPayload = (await unpaid.json()) as { x402: { intent_id: number } };
    expect(unpaidPayload.x402.intent_id).toBeGreaterThan(0);

    const verifyBody = {
      intent_id: unpaidPayload.x402.intent_id,
      tx_hash: "0xabc123",
      payer: "0xfeedbeef",
    };
    const verify = await app.request("http://localhost/v1/payments/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, verifyBody),
      },
      body: JSON.stringify(verifyBody),
    });
    expect(verify.status).toBe(200);

    const paidReq = { ...purchaseReq, intent_id: unpaidPayload.x402.intent_id };
    const paid = await app.request("http://localhost/v1/domains/purchase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: signAuth(identity.agentId, identity.secretKey, paidReq),
      },
      body: JSON.stringify(paidReq),
    });
    expect(paid.status).toBe(201);
    const paidPayload = (await paid.json()) as { domain: string; auto_follow: boolean };
    expect(paidPayload.domain).toBe("agent-billing.example.test");
    expect(paidPayload.auto_follow).toBeTrue();

    const orders = await app.request(`http://localhost/v1/repos/${repo.id}/domain-orders`, {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(orders.status).toBe(200);

    const ledger = await app.request("http://localhost/v1/billing/ledger", {
      headers: { Authorization: signAuth(identity.agentId, identity.secretKey) },
    });
    expect(ledger.status).toBe(200);
    const ledgerPayload = (await ledger.json()) as { receipts: Array<{ tx_hash: string }> };
    expect(ledgerPayload.receipts.some((row) => row.tx_hash === "0xabc123")).toBeTrue();
  });
});
