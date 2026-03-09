export type VersionBump = "MAJOR" | "MINOR" | "PATCH";

export type TreeEntry = {
  path: string;
  hash: string;
  kind: "file" | "dir" | "symlink";
  mode: "100644" | "100755" | "120000" | "040000";
  size?: number;
  is_binary?: boolean;
  content_type?: string;
};

export type FileDiff = {
  path: string;
  oldHash?: string;
  newHash?: string;
  linesAdded: number;
  linesRemoved: number;
  isBreaking: boolean;
};

export type DiffResult = {
  added: string[];
  modified: string[];
  deleted: string[];
  stats: Record<string, FileDiff>;
};

export type ExperimentalDecision = {
  shouldBranch: boolean;
  reason: string;
  riskScore: number;
};

export type AppConfig = {
  port: number;
  dbPath: string;
  blobsDir: string;
  maxBlobSize: number;
  rateLimitPerMinute: number;
  maxRequestAgeSeconds: number;
};
