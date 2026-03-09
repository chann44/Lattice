import type { DiffResult, ExperimentalDecision, TreeEntry, VersionBump } from "../types/api";

const PYTHON_FUNC = /def\s+(\w+)\s*\((.*?)\)/g;
const PYTHON_CLASS = /class\s+(\w+)/g;
const JS_FUNC = /(?:function\s+(\w+)\s*\((.*?)\))|(?:(\w+)\s*=\s*\((.*?)\)\s*=>)/g;
const GO_FUNC = /func\s+(\w+)\s*\((.*?)\)/g;

export function createTreeEntries(files: Record<string, string>, hashes: Record<string, string>): TreeEntry[] {
  return Object.keys(files)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const hash = hashes[path];
      if (!hash) {
        throw new Error(`missing hash for ${path}`);
      }
      return {
        path,
        hash,
        mode: "file" as const,
        size: files[path]?.length ?? 0,
      };
    });
}

export async function computeDiff(
  oldTree: Record<string, string>,
  newTree: Record<string, string>,
  readBlob: (hash: string) => Promise<string>,
): Promise<DiffResult> {
  const result: DiffResult = {
    added: [],
    modified: [],
    deleted: [],
    stats: {},
  };

  for (const [path, newHash] of Object.entries(newTree)) {
    const oldHash = oldTree[path];
    if (!oldHash) {
      result.added.push(path);
      const newContent = await readBlob(newHash);
      result.stats[path] = {
        path,
        newHash,
        linesAdded: lineCount(newContent),
        linesRemoved: 0,
        isBreaking: false,
      };
      continue;
    }
    if (oldHash !== newHash) {
      result.modified.push(path);
      const oldContent = await readBlob(oldHash);
      const newContent = await readBlob(newHash);
      const { added, removed } = lineDiffCount(oldContent, newContent);
      result.stats[path] = {
        path,
        oldHash,
        newHash,
        linesAdded: added,
        linesRemoved: removed,
        isBreaking: detectBreakingChange(path, oldContent, newContent),
      };
    }
  }

  for (const [path, oldHash] of Object.entries(oldTree)) {
    if (!newTree[path]) {
      result.deleted.push(path);
      const oldContent = await readBlob(oldHash);
      result.stats[path] = {
        path,
        oldHash,
        linesAdded: 0,
        linesRemoved: lineCount(oldContent),
        isBreaking: false,
      };
    }
  }

  return result;
}

export function determineVersionBump(diff: DiffResult): VersionBump {
  if (Object.values(diff.stats).some((s) => s.isBreaking)) {
    return "MAJOR";
  }
  if (diff.added.length > 0 || Object.values(diff.stats).some((s) => s.linesAdded > 20)) {
    return "MINOR";
  }
  return "PATCH";
}

export function bumpVersion(currentVersion: string | null, bump: VersionBump): string {
  if (!currentVersion) {
    return "v0.1.0";
  }
  const [majorS, minorS, patchS] = currentVersion.replace(/^v/, "").split(".");
  let major = Number(majorS);
  let minor = Number(minorS);
  let patch = Number(patchS);
  if (bump === "MAJOR") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "MINOR") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `v${major}.${minor}.${patch}`;
}

export function shouldCreateExperimentalBranch(diff: DiffResult): ExperimentalDecision {
  let riskScore = 0;
  const reasons: string[] = [];
  for (const [path, stat] of Object.entries(diff.stats)) {
    if (stat.isBreaking) {
      riskScore += 0.5;
      reasons.push(`Breaking change in ${path}`);
    }
  }
  const totalDeleted = Object.values(diff.stats).reduce((sum, s) => sum + s.linesRemoved, 0);
  if (totalDeleted > 100) {
    riskScore += 0.3;
    reasons.push(`Large deletion: ${totalDeleted} lines`);
  }
  if (diff.deleted.length > 0) {
    riskScore += 0.2;
    reasons.push(`Deleted ${diff.deleted.length} files`);
  }
  return {
    shouldBranch: riskScore >= 0.5,
    reason: reasons.join("; "),
    riskScore,
  };
}

export function generateCommitMessage(diff: DiffResult): string {
  const chunks: string[] = [];
  if (diff.added.length === 1 && diff.added[0]) chunks.push(`Add ${basename(diff.added[0])}`);
  else if (diff.added.length > 1) chunks.push(`Add ${diff.added.length} files`);
  if (diff.modified.length === 1 && diff.modified[0]) chunks.push(`Update ${basename(diff.modified[0])}`);
  else if (diff.modified.length > 1) chunks.push(`Update ${diff.modified.length} files`);
  if (diff.deleted.length === 1 && diff.deleted[0]) chunks.push(`Remove ${basename(diff.deleted[0])}`);
  else if (diff.deleted.length > 1) chunks.push(`Remove ${diff.deleted.length} files`);
  return chunks.length > 0 ? chunks.join(", ") : "Update project";
}

export function buildUnifiedDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const out: string[] = ["@@ -1 +1 @@"];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) out.push(`-${oldLine}`);
    if (newLine !== undefined) out.push(`+${newLine}`);
  }
  return out.join("\n");
}

function detectBreakingChange(path: string, oldContent: string, newContent: string): boolean {
  if (path.endsWith(".py")) return detectPythonBreaking(oldContent, newContent);
  if (path.endsWith(".js") || path.endsWith(".ts")) return detectJSBreaking(oldContent, newContent);
  if (path.endsWith(".go")) return detectGoBreaking(oldContent, newContent);
  return false;
}

function detectPythonBreaking(oldContent: string, newContent: string): boolean {
  const oldFuncs = extractSignatures(oldContent, PYTHON_FUNC, 1, 2);
  const newFuncs = extractSignatures(newContent, PYTHON_FUNC, 1, 2);
  for (const [name, sig] of Object.entries(oldFuncs)) {
    if (!newFuncs[name] || newFuncs[name] !== sig) return true;
  }

  const oldClasses = extractNames(oldContent, PYTHON_CLASS, 1).filter((n) => !n.startsWith("_"));
  const newClasses = new Set(extractNames(newContent, PYTHON_CLASS, 1));
  return oldClasses.some((c) => !newClasses.has(c));
}

function detectJSBreaking(oldContent: string, newContent: string): boolean {
  const oldFuncs = extractSignaturesJS(oldContent);
  const newFuncs = extractSignaturesJS(newContent);
  for (const [name, sig] of Object.entries(oldFuncs)) {
    if (!newFuncs[name] || newFuncs[name] !== sig) return true;
  }
  return false;
}

function detectGoBreaking(oldContent: string, newContent: string): boolean {
  const oldFuncs = extractSignatures(oldContent, GO_FUNC, 1, 2);
  const newFuncs = extractSignatures(newContent, GO_FUNC, 1, 2);
  for (const [name, sig] of Object.entries(oldFuncs)) {
    if (!newFuncs[name] || newFuncs[name] !== sig) return true;
  }
  return false;
}

function extractSignatures(content: string, pattern: RegExp, nameIdx: number, sigIdx: number): Record<string, string> {
  const signatures: Record<string, string> = {};
  const regex = new RegExp(pattern.source, pattern.flags);
  let match = regex.exec(content);
  while (match) {
    const key = match[nameIdx];
    if (key) {
      signatures[key] = match[sigIdx] ?? "";
    }
    match = regex.exec(content);
  }
  return signatures;
}

function extractSignaturesJS(content: string): Record<string, string> {
  const signatures: Record<string, string> = {};
  const regex = new RegExp(JS_FUNC.source, JS_FUNC.flags);
  let match = regex.exec(content);
  while (match) {
    const name = match[1] || match[3];
    const sig = match[2] || match[4] || "";
    if (name) signatures[name] = sig;
    match = regex.exec(content);
  }
  return signatures;
}

function extractNames(content: string, pattern: RegExp, group: number): string[] {
  const values: string[] = [];
  const regex = new RegExp(pattern.source, pattern.flags);
  let match = regex.exec(content);
  while (match) {
    const value = match[group];
    if (value) {
      values.push(value);
    }
    match = regex.exec(content);
  }
  return values;
}

function lineDiffCount(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldSet = new Set(oldContent.split("\n"));
  const newSet = new Set(newContent.split("\n"));
  let added = 0;
  let removed = 0;
  for (const line of newSet) if (!oldSet.has(line)) added += 1;
  for (const line of oldSet) if (!newSet.has(line)) removed += 1;
  return { added, removed };
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function basename(path: string): string {
  const chunks = path.split("/");
  return chunks[chunks.length - 1] ?? path;
}
