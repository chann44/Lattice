import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import nacl from "tweetnacl";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../../src/app";

type Agent = {
  agentId: string;
  secretKey: Uint8Array;
  publicKeyHex: string;
};

function sign(agentId: string, secretKey: Uint8Array, body?: unknown): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const message = `${agentId}:${timestamp}:${bodyHash}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(message), secretKey);
  return `Agent ${agentId}:${timestamp}:${Buffer.from(signature).toString("hex")}`;
}

async function register(baseUrl: string, name: string): Promise<Agent> {
  const pair = nacl.sign.keyPair();
  const publicKeyHex = Buffer.from(pair.publicKey).toString("hex");
  const response = await fetch(`${baseUrl}/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKeyHex, metadata: { name } }),
  });
  expect(response.status).toBe(201);
  const data = (await response.json()) as { agent_id: string };
  return { agentId: data.agent_id, secretKey: pair.secretKey, publicKeyHex };
}

describe("e2e multi-agent isolation", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-scm-e2e-"));
    const { app } = await createApp({
      port: 0,
      dbPath: join(root, "test.db"),
      blobsDir: join(root, "blobs"),
      maxBlobSize: 50 * 1024 * 1024,
      rateLimitPerMinute: 10_000,
      maxRequestAgeSeconds: 300,
    });
    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("agents are isolated for repo and commit access", async () => {
    const agent1 = await register(baseUrl, "agent-1");
    const agent2 = await register(baseUrl, "agent-2");

    const createPayload = { name: "same-name", description: "r1" };
    const createRes1 = await fetch(`${baseUrl}/v1/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: sign(agent1.agentId, agent1.secretKey, createPayload),
      },
      body: JSON.stringify(createPayload),
    });
    expect(createRes1.status).toBe(201);
    const repo1 = (await createRes1.json()) as { id: number };

    const createRes2 = await fetch(`${baseUrl}/v1/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: sign(agent2.agentId, agent2.secretKey, createPayload),
      },
      body: JSON.stringify(createPayload),
    });
    expect(createRes2.status).toBe(201);
    const repo2 = (await createRes2.json()) as { id: number };
    expect(repo1.id).not.toBe(repo2.id);

    const pushPayload = {
      branch: "main",
      files: { "main.py": "def run():\n    return 'ok'" },
    };
    const pushRes = await fetch(`${baseUrl}/v1/repos/${repo1.id}/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: sign(agent1.agentId, agent1.secretKey, pushPayload),
      },
      body: JSON.stringify(pushPayload),
    });
    expect(pushRes.status).toBe(200);

    const forbiddenRepoAccess = await fetch(`${baseUrl}/v1/repos/${repo1.id}`, {
      headers: { Authorization: sign(agent2.agentId, agent2.secretKey) },
    });
    expect(forbiddenRepoAccess.status).toBe(403);

    const forbiddenCommitsAccess = await fetch(`${baseUrl}/v1/repos/${repo1.id}/commits?branch=main`, {
      headers: { Authorization: sign(agent2.agentId, agent2.secretKey) },
    });
    expect(forbiddenCommitsAccess.status).toBe(403);

    const ownRepoAccess = await fetch(`${baseUrl}/v1/repos/${repo2.id}`, {
      headers: { Authorization: sign(agent2.agentId, agent2.secretKey) },
    });
    expect(ownRepoAccess.status).toBe(200);
  });
});
