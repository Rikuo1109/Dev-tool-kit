import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { findGitRoot } from "../../shared/gitignore";
import { getSourceLanguage } from "../../shared/language";
import { AddedLine, FileDiff } from "./types";

export function resolveGitRoot(folderPath: string): string {
  const root = findGitRoot(folderPath);
  if (!root) {
    throw new Error("Not inside a git repository");
  }
  return root;
}

export function getCurrentBranch(gitRoot: string): string {
  const branch = runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch === "HEAD") {
    throw new Error("Detached HEAD — checkout a branch before running pre-merge review.");
  }
  return branch;
}

export function listGitBranches(
  gitRoot: string,
  currentBranch: string,
): string[] {
  const output = runGit(gitRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
    "refs/remotes/origin/",
  ]);

  const branches = new Set<string>();
  for (const line of output.split("\n")) {
    const name = line.trim();
    if (!name || name === currentBranch || name === "origin/HEAD") {
      continue;
    }
    branches.add(name);
  }

  const preferred = [
    "main",
    "master",
    "develop",
    "origin/main",
    "origin/master",
    "origin/develop",
  ];

  const rest = [...branches]
    .filter((branch) => !preferred.includes(branch))
    .sort((a, b) => a.localeCompare(b));

  return [...preferred.filter((branch) => branches.has(branch)), ...rest];
}

export function collectBranchComparisonDiffs(
  gitRoot: string,
  compareBranch: string,
  currentRef = "HEAD",
): FileDiff[] {
  const mergeBase = runGit(gitRoot, [
    "merge-base",
    compareBranch,
    currentRef,
  ]).trim();

  const byFile = new Map<string, FileDiff>();

  ingestRangeDiffs(
    byFile,
    gitRoot,
    `${mergeBase}..${currentRef}`,
    currentRef,
  );
  ingestRangeDiffs(
    byFile,
    gitRoot,
    `${mergeBase}..${compareBranch}`,
    compareBranch,
  );

  return [...byFile.values()]
    .filter((diff) => diff.addedLines.length > 0)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function ingestRangeDiffs(
  byFile: Map<string, FileDiff>,
  gitRoot: string,
  diffRange: string,
  contentRef: string,
): void {
  const names = runGit(gitRoot, ["diff", "--name-only", diffRange])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const relativePath of names) {
    const language = getSourceLanguage(relativePath);
    if (language === "unknown") {
      continue;
    }

    const patch = runGit(gitRoot, ["diff", "-U0", diffRange, "--", relativePath]);
    const addedLines = parseAddedLines(patch);
    if (addedLines.length === 0) {
      continue;
    }

    const absolutePath = path.join(gitRoot, relativePath);
    const existing = byFile.get(relativePath);
    if (existing) {
      existing.addedLines.push(...addedLines);
      if (contentRef === "HEAD" && fs.existsSync(absolutePath)) {
        existing.contentRef = "HEAD";
      }
      continue;
    }

    byFile.set(relativePath, {
      relativePath,
      absolutePath,
      language,
      addedLines,
      contentRef,
    });
  }
}

export function readFileAtRef(
  gitRoot: string,
  relativePath: string,
  contentRef: string,
): string {
  const absolutePath = path.join(gitRoot, relativePath);
  if (contentRef === "HEAD" && fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, "utf-8");
  }

  try {
    return runGit(gitRoot, ["show", `${contentRef}:${relativePath}`]);
  } catch {
    if (fs.existsSync(absolutePath)) {
      return fs.readFileSync(absolutePath, "utf-8");
    }
    return "";
  }
}

function parseAddedLines(patch: string): AddedLine[] {
  const added: AddedLine[] = [];
  let newLine = 0;

  for (const rawLine of patch.split("\n")) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }

    if (rawLine.startsWith("+++") || rawLine.startsWith("---")) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      added.push({
        lineNumber: newLine,
        content: rawLine.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith(" ")) {
      newLine += 1;
    }
  }

  return added;
}

function runGit(gitRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", gitRoot, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export { runGit };
