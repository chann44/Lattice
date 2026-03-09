import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BlobStore } from "../lib/blob-store";
import { decryptSecret, redactSecrets } from "../lib/secrets";
import { RepositoryService } from "./repository";

type RunnerInput = {
  repoId: number;
  agentId: string;
  command: string;
  branch: string;
  environment: "dev" | "preview" | "prod";
  runtime: "shell" | "docker";
  secretRefs: string[];
  timeoutMs: number;
  memoryLimitMb: number;
};

type QueueItem = RunnerInput & { jobId: number };

export class JobRunner {
  private queue: QueueItem[] = [];
  private running = 0;

  constructor(
    private readonly repoService: RepositoryService,
    private readonly blobStore: BlobStore,
    private readonly options: { concurrency: number },
  ) {}

  async enqueue(input: RunnerInput): Promise<number> {
    const jobId = await this.repoService.createRunnerJob({
      repoId: input.repoId,
      agentId: input.agentId,
      command: input.command,
      environment: input.environment,
      runtime: input.runtime,
      secretRefs: input.secretRefs,
      timeoutMs: input.timeoutMs,
      memoryLimitMb: input.memoryLimitMb,
    });
    if (!jobId) throw new Error("failed to create runner job");
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

  private async run(item: QueueItem) {
    await this.repoService.markRunnerJobRunning(item.jobId);
    const branch = await this.repoService.getBranch(item.repoId, item.branch);
    if (!branch?.headCommit) {
      await this.repoService.markRunnerJobFinished(item.jobId, "failed", "branch has no head commit", 1);
      return;
    }

    const commit = await this.repoService.getCommit(branch.headCommit);
    if (!commit) {
      await this.repoService.markRunnerJobFinished(item.jobId, "failed", "head commit missing", 1);
      return;
    }

    const entries = await this.repoService.getTree(commit.treeHash);
    const workDir = await mkdtemp(join(tmpdir(), `agent-job-${item.jobId}-`));

    try {
      for (const entry of entries) {
        if (entry.kind === "dir") {
          await mkdir(join(workDir, entry.path), { recursive: true });
          continue;
        }
        const out = join(workDir, entry.path);
        await mkdir(dirname(out), { recursive: true });
        const content = await this.blobStore.read(entry.hash);
        await Bun.write(out, content);
      }

      const secretRows = await this.repoService.getSecretsByKeys(item.repoId, item.environment, item.secretRefs);
      const envVars: Record<string, string> = {};
      const secretValues: string[] = [];
      for (const row of secretRows) {
        const value = decryptSecret(row.encryptedValue, row.nonce);
        envVars[row.key] = value;
        secretValues.push(value);
      }

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), item.timeoutMs);
      try {
        const proc =
          item.runtime === "docker"
            ? Bun.spawn(["docker", "compose", "up", "--build", "--abort-on-container-exit"], {
                cwd: workDir,
                stdout: "pipe",
                stderr: "pipe",
                signal: ac.signal,
                env: { ...process.env, ...envVars },
              })
            : Bun.spawn(["sh", "-lc", item.command], {
                cwd: workDir,
                stdout: "pipe",
                stderr: "pipe",
                signal: ac.signal,
                env: { ...process.env, ...envVars, JOB_MEMORY_LIMIT_MB: String(item.memoryLimitMb) },
              });

        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const logs = redactSecrets(`${stdout}${stderr}`, secretValues);
        if (code === 0) {
          await this.repoService.markRunnerJobFinished(item.jobId, "completed", logs, 0);
        } else {
          await this.repoService.markRunnerJobFinished(item.jobId, "failed", logs, code);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repoService.markRunnerJobFinished(item.jobId, "failed", message, 1);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
