import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BlobStore } from "../lib/blob-store";
import { RepositoryService } from "./repository";

type BuildJobInput = {
  repoId: number;
  deploymentId: number;
  treeHash: string;
  entryPath: string;
  timeoutMs: number;
  memoryLimitMb: number;
};

type BuildQueueItem = BuildJobInput & {
  jobId: number;
};

export class BuildExecutor {
  private queue: BuildQueueItem[] = [];
  private running = 0;

  constructor(
    private readonly repoService: RepositoryService,
    private readonly blobStore: BlobStore,
    private readonly options: { concurrency: number },
  ) {}

  async enqueue(input: BuildJobInput): Promise<number> {
    const jobId = await this.repoService.createBuildJob({
      deploymentId: input.deploymentId,
      timeoutMs: input.timeoutMs,
      memoryLimitMb: input.memoryLimitMb,
    });
    if (!jobId) {
      throw new Error("failed to create build job");
    }
    this.queue.push({ ...input, jobId });
    this.kick();
    return jobId;
  }

  private kick() {
    while (this.running < this.options.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.running += 1;
      this.run(item)
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.kick();
        });
    }
  }

  private async run(item: BuildQueueItem): Promise<void> {
    await this.repoService.markBuildJobRunning(item.jobId);
    await this.repoService.updateDeployment(item.deploymentId, {
      status: "building",
      logs: "Build queued\nBuild started",
    });

    const workDir = await mkdtemp(join(tmpdir(), `agent-build-${item.deploymentId}-`));
    let logs = "Build queued\nBuild started\n";

    try {
      const entries = await this.repoService.getTree(item.treeHash);
      for (const entry of entries) {
        if (entry.kind === "dir") {
          await mkdir(join(workDir, entry.path), { recursive: true });
          continue;
        }
        const outputPath = join(workDir, entry.path);
        await mkdir(dirname(outputPath), { recursive: true });
        const content = await this.blobStore.read(entry.hash);
        await Bun.write(outputPath, content);
      }

      const buildCommand = this.resolveBuildCommand(item.entryPath);
      if (buildCommand) {
        logs += `Running build for ${item.entryPath}\n`;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("build timed out")), item.timeoutMs);
        });

        const buildPromise = Bun.build({
          entrypoints: [join(workDir, item.entryPath)],
          outdir: join(workDir, ".build"),
          target: "browser",
          minify: false,
          sourcemap: "none",
        });

        const result = await Promise.race([buildPromise, timeoutPromise]);
        if (!result.success) {
          const text = result.logs.map((entry) => entry.message).join("\n");
          logs += text;
          throw new Error(text || "build failed");
        }
        logs += `Build produced ${result.outputs.length} outputs\n`;
      } else {
        logs += "No build command required for entrypoint type\n";
      }

      logs += "Build finished\nDeployment ready";
      await this.repoService.markBuildJobFinished(item.jobId, "ready", logs);
      await this.repoService.updateDeployment(item.deploymentId, {
        status: "ready",
        logs,
      });
      await this.emitWebhooks(item.repoId, item.deploymentId, "ready", logs);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logs += `Build failed: ${errorMessage}`;
      await this.repoService.markBuildJobFinished(item.jobId, "failed", logs);
      await this.repoService.updateDeployment(item.deploymentId, {
        status: "failed",
        logs,
      });
      await this.emitWebhooks(item.repoId, item.deploymentId, "failed", logs);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private resolveBuildCommand(entryPath: string): boolean {
    if (entryPath.endsWith(".ts") || entryPath.endsWith(".tsx") || entryPath.endsWith(".js") || entryPath.endsWith(".jsx")) {
      return true;
    }
    if (entryPath.endsWith(".html") || entryPath.endsWith(".css")) {
      return true;
    }
    return false;
  }

  private async emitWebhooks(repoId: number, deploymentId: number, status: "ready" | "failed", logs: string) {
    const hooks = await this.repoService.getDeploymentWebhooks(repoId);
    if (hooks.length === 0) return;

    const payload = JSON.stringify({
      event: "deployment.updated",
      repo_id: repoId,
      deployment_id: deploymentId,
      status,
      logs,
      timestamp: new Date().toISOString(),
    });

    await Promise.all(
      hooks.map(async (hook) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Agent-SCM-Event": "deployment.updated",
        };
        if (hook.secret) {
          headers["X-Agent-SCM-Signature"] = createHmac("sha256", hook.secret).update(payload).digest("hex");
        }
        try {
          await fetch(hook.url, {
            method: "POST",
            headers,
            body: payload,
          });
        } catch {
          // best effort delivery
        }
      }),
    );
  }
}
