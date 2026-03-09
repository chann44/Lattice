import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { fromHex, sha256Hex } from "./hash";

export type AuthHeader = {
  agentId: string;
  timestamp: number;
  signatureHex: string;
};

export function deriveAgentId(publicKeyHex: string): string {
  const keyHash = sha256Hex(fromHex(publicKeyHex));
  return `agent-${keyHash.slice(0, 12)}`;
}

export function parseAuthHeader(value: string): AuthHeader | null {
  if (!value.startsWith("Agent ")) return null;
  const payload = value.slice("Agent ".length);
  const [agentId, tsRaw, signatureHex] = payload.split(":");
  const timestamp = Number(tsRaw);
  if (!agentId || Number.isNaN(timestamp) || !signatureHex) return null;
  return { agentId, timestamp, signatureHex };
}

export function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function verifyRequestSignature(input: {
  agentId: string;
  timestamp: number;
  signatureHex: string;
  publicKeyHex: string;
  rawBody: string;
}): boolean {
  const message = `${input.agentId}:${input.timestamp}:${bodyHash(input.rawBody)}`;
  const signature = fromHex(input.signatureHex);
  const publicKey = fromHex(input.publicKeyHex);
  return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey);
}
