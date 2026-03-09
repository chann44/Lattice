import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BlobStore } from "../lib/blob-store";
import { decryptSecret, redactSecrets } from "../lib/secrets";
import { RepositoryService } from "./repository";

type BuildJobInput = {
  repoId: number;
  deploymentId: number;
  treeHash: string;
  entryPath: string;
  runtime: "static" | "docker";
  environment: "dev" | "preview" | "prod";
  secretRefs: string[];
  dockerfilePath?: string;
  composeFilePath?: string;
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
      const secretRows = await this.repoService.getSecretsByKeys(item.repoId, item.environment, item.secretRefs);
      const envVars: Record<string, string> = {};
      const secretValues: string[] = [];
      for (const row of secretRows) {
        const value = decryptSecret(row.encryptedValue, row.nonce);
        envVars[row.key] = value;
        secretValues.push(value);
      }

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
      if (item.runtime === "docker") {
        logs += "Docker runtime selected\n";
        const dockerVersion = Bun.spawnSync(["docker", "--version"], { stdout: "pipe", stderr: "pipe" });
        if (dockerVersion.exitCode !== 0) {
          throw new Error("docker binary is not available on this host");
        }

        const tag = `agent-scm-${item.deploymentId}`;
        logs += `Running docker build for tag ${tag}\n`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), item.timeoutMs);
        try {
          const command = item.composeFilePath
            ? ["docker", "compose", "-f", item.composeFilePath, "build"]
            : ["docker", "build", "-t", tag, "-f", item.dockerfilePath ?? "Dockerfile", "."];
          const proc = Bun.spawn(command, {
            cwd: workDir,
            stdout: "pipe",
            stderr: "pipe",
            signal: ac.signal,
            env: { ...process.env, ...envVars },
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          logs += redactSecrets(stdout, secretValues);
          logs += redactSecrets(stderr, secretValues);
          if (exitCode !== 0) {
            throw new Error(`docker build failed with code ${exitCode}`);
          }
          logs += `Docker image built: ${tag}\n`;

          if (item.composeFilePath) {
            const up = Bun.spawnSync(["docker", "compose", "-f", item.composeFilePath, "up", "-d"], {
              cwd: workDir,
              stdout: "pipe",
              stderr: "pipe",
            });
            logs += new TextDecoder().decode(up.stdout);
            logs += new TextDecoder().decode(up.stderr);
            if (up.exitCode !== 0) {
              throw new Error(`docker compose up failed with code ${up.exitCode}`);
            }
            logs += "Docker compose services started\n";
          } else {
            const runtime = await this.startDockerRuntime(tag, item.timeoutMs);
            logs += `Docker runtime URL: ${runtime.runtimeUrl}\n`;
            const deployment = await this.repoService.getDeploymentById(item.deploymentId);
            const metadata = deployment?.metadata ? JSON.parse(deployment.metadata) : {};
            metadata.runtime_proxy_url = runtime.runtimeUrl;
            metadata.runtime_container_id = runtime.containerId;
            metadata.runtime_container_port = runtime.containerPort;
            await this.repoService.updateDeployment(item.deploymentId, {
              metadata,
            });
          }
        } finally {
          clearTimeout(timer);
        }
      } else if (buildCommand) {
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

  private async startDockerRuntime(tag: string, timeoutMs: number): Promise<{ runtimeUrl: string; containerId: string; containerPort: number }> {
    const candidatePorts = [3000, 8080, 80];
    for (const containerPort of candidatePorts) {
      const run = Bun.spawnSync(["docker", "run", "-d", "-p", `127.0.0.1::${containerPort}`, tag], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (run.exitCode !== 0) {
        continue;
      }

      const containerId = new TextDecoder().decode(run.stdout).trim();
      if (!containerId) {
        continue;
      }

      const portInfo = Bun.spawnSync(["docker", "port", containerId, `${containerPort}/tcp`], { stdout: "pipe", stderr: "pipe" });
      if (portInfo.exitCode !== 0) {
        Bun.spawnSync(["docker", "rm", "-f", containerId], { stdout: "pipe", stderr: "pipe" });
        continue;
      }

      const mapping = new TextDecoder().decode(portInfo.stdout).trim();
      const hostPort = Number(mapping.split(":").pop());
      if (!hostPort || Number.isNaN(hostPort)) {
        Bun.spawnSync(["docker", "rm", "-f", containerId], { stdout: "pipe", stderr: "pipe" });
        continue;
      }

      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          const response = await fetch(`http://127.0.0.1:${hostPort}`);
          if (response.status >= 200 && response.status < 500) {
            return { runtimeUrl: `http://127.0.0.1:${hostPort}`, containerId, containerPort };
          }
        } catch {
          // wait for service to warm
        }
        await Bun.sleep(200);
      }

      Bun.spawnSync(["docker", "rm", "-f", containerId], { stdout: "pipe", stderr: "pipe" });
    }

    throw new Error("unable to start docker runtime container");
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
