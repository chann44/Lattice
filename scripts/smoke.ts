import nacl from "tweetnacl";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../src/app";

function sign(agentId: string, secretKey: Uint8Array, body?: unknown): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const message = `${agentId}:${timestamp}:${bodyHash}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(message), secretKey);
  return `Agent ${agentId}:${timestamp}:${Buffer.from(signature).toString("hex")}`;
}

async function assertStatus(response: Response, expected: number, context: string): Promise<void> {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${context} failed (${response.status}): ${body}`);
  }
}

async function run() {
  const root = await mkdtemp(join(tmpdir(), "agent-scm-smoke-"));
  const { app } = await createApp({
    port: 0,
    dbPath: join(root, "smoke.db"),
    blobsDir: join(root, "blobs"),
    maxBlobSize: 50 * 1024 * 1024,
    rateLimitPerMinute: 10_000,
    maxRequestAgeSeconds: 300,
  });

  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const base = `http://127.0.0.1:${server.port}`;

  try {
    const pair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(pair.publicKey).toString("hex");

    const registerRes = await fetch(`${base}/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: publicKeyHex, metadata: { name: "smoke" } }),
    });
    await assertStatus(registerRes, 201, "register");
    const register = (await registerRes.json()) as { agent_id: string };

    const createPayload = { name: "smoke-repo", description: "smoke test" };
    const createRes = await fetch(`${base}/v1/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: sign(register.agent_id, pair.secretKey, createPayload),
      },
      body: JSON.stringify(createPayload),
    });
    await assertStatus(createRes, 201, "create repo");
    const repo = (await createRes.json()) as { id: number };

    const pushPayload = {
      branch: "main",
      files: {
        "main.py": "def main():\n    return 'ok'",
        "README.md": "# smoke",
      },
    };
    const pushRes = await fetch(`${base}/v1/repos/${repo.id}/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: sign(register.agent_id, pair.secretKey, pushPayload),
      },
      body: JSON.stringify(pushPayload),
    });
    await assertStatus(pushRes, 200, "push");

    const commitsRes = await fetch(`${base}/v1/repos/${repo.id}/commits?branch=main&limit=10`, {
      headers: {
        Authorization: sign(register.agent_id, pair.secretKey),
      },
    });
    await assertStatus(commitsRes, 200, "list commits");

    const commits = (await commitsRes.json()) as { commits: Array<{ hash: string }> };
    if (commits.commits.length === 0) {
      throw new Error("smoke failed: expected commits");
    }

    console.log("SMOKE PASS: register -> create repo -> push -> commits");
  } finally {
    server.stop(true);
  }
}

run().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
