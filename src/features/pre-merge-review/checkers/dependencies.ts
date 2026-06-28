import { execFileSync } from "child_process";
import * as path from "path";
import { ReviewIssue } from "../types";

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Pipfile.lock",
]);

const HEAVY_DEPENDENCIES = new Set([
  "lodash",
  "moment",
  "jquery",
  "core-js",
  "rxjs",
  "@mui/material",
  "aws-sdk",
]);

export function checkDependencyChanges(
  gitRoot: string,
  compareBranch: string,
  currentRef: string,
): ReviewIssue[] {
  const mergeBase = execFileSync(
    "git",
    ["-C", gitRoot, "merge-base", compareBranch, currentRef],
    { encoding: "utf-8" },
  ).trim();

  const seen = new Set<string>();
  const items: ReviewIssue[] = [];

  for (const diffRange of [`${mergeBase}..${currentRef}`, `${mergeBase}..${compareBranch}`]) {
    items.push(...collectDependencyIssues(gitRoot, diffRange, seen));
  }

  return items;
}

function collectDependencyIssues(
  gitRoot: string,
  diffRange: string,
  seen: Set<string>,
): ReviewIssue[] {
  const names = execFileSync(
    "git",
    ["-C", gitRoot, "diff", "--name-only", diffRange],
    { encoding: "utf-8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ReviewIssue[] = [];

  for (const relativePath of names) {
    const baseName = path.basename(relativePath);
    const absolutePath = path.join(gitRoot, relativePath);
    const dedupeKey = `${relativePath}:${diffRange}`;

    if (relativePath.endsWith("package.json")) {
      for (const issue of checkPackageJson(
        relativePath,
        absolutePath,
        gitRoot,
        diffRange,
      )) {
        const key = `${issue.relativePath}:${issue.message}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push(issue);
      }
      continue;
    }

    if (LOCKFILES.has(baseName)) {
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      items.push({
        relativePath,
        absolutePath,
        line: 1,
        severity: "info",
        category: "Dependencies",
        message: "Lockfile modified — review dependency tree changes",
      });
    }
  }

  return items;
}

function checkPackageJson(
  relativePath: string,
  absolutePath: string,
  gitRoot: string,
  diffRange: string,
): ReviewIssue[] {
  const items: ReviewIssue[] = [];
  const patch = execFileSync(
    "git",
    ["-C", gitRoot, "diff", "-U0", diffRange, "--", relativePath],
    { encoding: "utf-8" },
  );

  const addedDeps = [...patch.matchAll(/^\+\s*"([^"]+)":/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith("@types/"));

  for (const dep of addedDeps) {
    items.push({
      relativePath,
      absolutePath,
      line: 1,
      severity: HEAVY_DEPENDENCIES.has(dep) ? "warning" : "info",
      category: "Dependencies",
      message: HEAVY_DEPENDENCIES.has(dep)
        ? `New heavy dependency added: ${dep}`
        : `New dependency added: ${dep}`,
    });
  }

  if (addedDeps.length === 0 && patch.includes("+")) {
    items.push({
      relativePath,
      absolutePath,
      line: 1,
      severity: "info",
      category: "Dependencies",
      message: "package.json modified",
    });
  }

  return items;
}
