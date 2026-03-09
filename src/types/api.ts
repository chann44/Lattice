export type VersionBump = "MAJOR" | "MINOR" | "PATCH";

export type TreeEntry = {
  path: string;
  hash: string;
  mode: "file" | "executable";
  size?: number;
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
