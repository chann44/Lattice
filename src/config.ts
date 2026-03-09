import type { AppConfig } from "./types/api";

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? "8080"),
    dbPath: process.env.DB_PATH ?? "./data/agent-scm.db",
    blobsDir: process.env.BLOBS_DIR ?? "./data/blobs",
    maxBlobSize: Number(process.env.MAX_BLOB_SIZE ?? String(50 * 1024 * 1024)),
    rateLimitPerMinute: Number(process.env.RATE_LIMIT ?? "100"),
    maxRequestAgeSeconds: Number(process.env.MAX_REQUEST_AGE ?? "300"),
  };
}
