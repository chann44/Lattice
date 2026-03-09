import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyMaterial(): Buffer {
  const fromEnv = process.env.SECRET_MASTER_KEY;
  if (!fromEnv || fromEnv.length === 0) {
    return createHash("sha256").update("agent-scm-dev-master-key").digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
    return Buffer.from(fromEnv, "hex");
  }
  return createHash("sha256").update(fromEnv).digest();
}

export function encryptSecret(value: string): { encryptedValue: string; nonce: string } {
  const key = keyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedValue: Buffer.concat([ciphertext, tag]).toString("base64"),
    nonce: iv.toString("base64"),
  };
}

export function decryptSecret(encryptedValue: string, nonce: string): string {
  const key = keyMaterial();
  const iv = Buffer.from(nonce, "base64");
  const raw = Buffer.from(encryptedValue, "base64");
  const ciphertext = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return clear.toString("utf8");
}

export function redactSecrets(logs: string, values: string[]): string {
  let output = logs;
  for (const value of values) {
    if (!value) continue;
    output = output.split(value).join("***");
  }
  return output;
}
