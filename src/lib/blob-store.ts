import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export class BlobStore {
  constructor(private readonly baseDir: string) {}

  blobPath(hash: string): string {
    return join(this.baseDir, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async exists(hash: string): Promise<boolean> {
    const file = Bun.file(this.blobPath(hash));
    return await file.exists();
  }

  async write(hash: string, content: string): Promise<void> {
    const path = this.blobPath(hash);
    await mkdir(dirname(path), { recursive: true });
    const compressed = gzipSync(new TextEncoder().encode(content));
    await Bun.write(path, compressed);
  }

  async read(hash: string): Promise<string> {
    const compressed = await Bun.file(this.blobPath(hash)).bytes();
    const raw = gunzipSync(compressed);
    return new TextDecoder().decode(raw);
  }
}
