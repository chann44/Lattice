import nacl from "tweetnacl";
import { createHash } from "node:crypto";

export type AgentIdentity = {
  publicKeyHex: string;
  secretKey: Uint8Array;
  agentId: string;
};

type Requestable = {
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function signAuth(agentId: string, secretKey: Uint8Array, body?: unknown): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const message = `${agentId}:${timestamp}:${sha256Hex(rawBody)}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(message), secretKey);
  return `Agent ${agentId}:${timestamp}:${Buffer.from(signature).toString("hex")}`;
}

export function newKeypair() {
  return nacl.sign.keyPair();
}

export async function registerAgent(app: Requestable, metadata: Record<string, unknown> = {}) {
  const pair = newKeypair();
  const payload = {
    public_key: Buffer.from(pair.publicKey).toString("hex"),
    metadata,
  };
  const response = await app.request("http://localhost/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status}`);
  }
  const data = (await response.json()) as { agent_id: string };
  return {
    identity: {
      publicKeyHex: payload.public_key,
      secretKey: pair.secretKey,
      agentId: data.agent_id,
    } satisfies AgentIdentity,
    response: data,
  };
}

export async function createRepo(app: Requestable, identity: AgentIdentity, name: string) {
  const payload = { name, description: "test repo" };
  const response = await app.request("http://localhost/v1/repos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: signAuth(identity.agentId, identity.secretKey, payload),
    },
    body: JSON.stringify(payload),
  });
  if (response.status !== 201) {
    throw new Error(`create repo failed: ${response.status}`);
  }
  return (await response.json()) as { id: number };
}

export async function pushSnapshot(
  app: Requestable,
  identity: AgentIdentity,
  repoId: number,
  files: Record<string, string>,
  branch = "main",
) {
  const payload = { branch, files };
  return app.request(`http://localhost/v1/repos/${repoId}/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: signAuth(identity.agentId, identity.secretKey, payload),
    },
    body: JSON.stringify(payload),
  });
}
