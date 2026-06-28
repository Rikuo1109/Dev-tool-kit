import { execFileSync } from "child_process";
import * as path from "path";

export function findGitRoot(startDir: string): string | null {
  try {
    const root = execFileSync(
      "git",
      ["-C", startDir, "rev-parse", "--show-toplevel"],
      { encoding: "utf-8" },
    ).trim();
    return root.replace(/\\/g, "/");
  } catch {
    return null;
  }
}

export function isGitRepository(startDir: string): boolean {
  return findGitRoot(startDir) !== null;
}

export function filterGitIgnoredPaths(
  gitRoot: string,
  filePaths: string[],
): string[] {
  if (filePaths.length === 0 || !isGitRepository(gitRoot)) {
    return filePaths;
  }

  const normalizedRoot = path.resolve(gitRoot);
  const relPaths = filePaths.map((absPath) =>
    toGitRelativePath(normalizedRoot, absPath),
  );

  let ignoredRel = new Set<string>();
  try {
    const output = execFileSync(
      "git",
      ["-C", normalizedRoot, "check-ignore", "--stdin"],
      {
        input: relPaths.join("\n"),
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
      },
    ).trim();

    if (output) {
      ignoredRel = new Set(output.split("\n").filter(Boolean));
    }
  } catch (error) {
    if (!isCheckIgnoreNoMatch(error)) {
      return filePaths;
    }
  }

  return filePaths.filter((_, index) => !ignoredRel.has(relPaths[index]));
}

export function isGitIgnoredPath(gitRoot: string, filePath: string): boolean {
  return filterGitIgnoredPaths(gitRoot, [filePath]).length === 0;
}

function toGitRelativePath(gitRoot: string, filePath: string): string {
  const rel = path.relative(gitRoot, filePath).replace(/\\/g, "/");
  return rel || ".";
}

function isCheckIgnoreNoMatch(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 1
  );
}
