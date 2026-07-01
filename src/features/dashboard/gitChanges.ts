import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const HISTORY_DAYS = 120;
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t/;

export interface LineChangeStats {
  added: number;
  deleted: number;
  net: number;
}

export interface GitDayChange {
  date: string;
  added: number;
  deleted: number;
  net: number;
  isMonth?: boolean;
}

export interface GitChangeStats {
  available: boolean;
  message?: string;
  days: GitDayChange[];
  today: LineChangeStats;
  /** Net line delta from staged (index) + unstaged (working tree) changes. */
  uncommittedNet: number;
}

function emptyLineStats(): LineChangeStats {
  return { added: 0, deleted: 0, net: 0 };
}

function toLineStats(added: number, deleted: number): LineChangeStats {
  return { added, deleted, net: added - deleted };
}

function scopeArgs(scope: string): string[] {
  return scope && scope !== "." ? ["--", scope] : [];
}

function runGit(gitRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", gitRoot, ...args], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parseNumstatOutput(output: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const match = line.match(NUMSTAT_RE);
    if (!match) {
      continue;
    }

    added += match[1] === "-" ? 0 : Number.parseInt(match[1], 10);
    deleted += match[2] === "-" ? 0 : Number.parseInt(match[2], 10);
  }

  return { added, deleted };
}

function getUncommittedNet(gitRoot: string, scope: string): number {
  const pathArgs = scopeArgs(scope);
  const unstaged = parseNumstatOutput(
    runGit(gitRoot, ["diff", "--numstat", "--no-renames", ...pathArgs]),
  );
  const staged = parseNumstatOutput(
    runGit(gitRoot, ["diff", "--cached", "--numstat", "--no-renames", ...pathArgs]),
  );

  return (
    unstaged.added +
    staged.added -
    unstaged.deleted -
    staged.deleted
  );
}

export function getGitChangeStats(folder: string): GitChangeStats {
  const emptyToday = emptyLineStats();

  const gitRoot = findGitRoot(folder);
  if (!gitRoot) {
    return {
      available: false,
      message: "Not inside a git repository",
      days: buildMixedSeries(new Map(), 7, 90),
      today: emptyToday,
      uncommittedNet: 0,
    };
  }

  const scope = path
    .relative(gitRoot, path.resolve(folder))
    .replace(/\\/g, "/");

  try {
    const args = [
      "log",
      `--since=${HISTORY_DAYS} days ago`,
      "--format=%ad",
      "--date=short",
      "--numstat",
      "--no-renames",
    ];

    if (scope && scope !== ".") {
      args.push("--", scope);
    }

    const output = runGit(gitRoot, args);
    const uncommittedNet = getUncommittedNet(gitRoot, scope);

    const byDate = parseGitNumstat(output);
    const days = buildMixedSeries(byDate, 7, 90);
    const todayKey = localDateKey();
    const todayBucket = byDate.get(todayKey) ?? { added: 0, deleted: 0 };

    return {
      available: true,
      days,
      today: toLineStats(todayBucket.added, todayBucket.deleted),
      uncommittedNet,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read git history";
    return {
      available: false,
      message,
      days: buildMixedSeries(new Map(), 7, 90),
      today: emptyToday,
      uncommittedNet: 0,
    };
  }
}

function findGitRoot(start: string): string | null {
  let dir = path.resolve(start);

  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function parseGitNumstat(
  output: string,
): Map<string, { added: number; deleted: number }> {
  const byDate = new Map<string, { added: number; deleted: number }>();
  let currentDate: string | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
      currentDate = line;
      continue;
    }

    if (!currentDate) {
      continue;
    }

    const match = line.match(NUMSTAT_RE);
    if (!match) {
      continue;
    }

    const added = match[1] === "-" ? 0 : Number.parseInt(match[1], 10);
    const deleted = match[2] === "-" ? 0 : Number.parseInt(match[2], 10);
    if (Number.isNaN(added) || Number.isNaN(deleted)) {
      continue;
    }

    const bucket = byDate.get(currentDate) ?? { added: 0, deleted: 0 };
    bucket.added += added;
    bucket.deleted += deleted;
    byDate.set(currentDate, bucket);
  }

  return byDate;
}

function buildDaySeries(
  byDate: Map<string, { added: number; deleted: number }>,
  dayCount: number,
): GitDayChange[] {
  const days: GitDayChange[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (let i = dayCount - 1; i >= 0; i--) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - i);
    const key = localDateKey(date);
    const bucket = byDate.get(key) ?? { added: 0, deleted: 0 };

    days.push({
      date: key,
      added: bucket.added,
      deleted: bucket.deleted,
      net: bucket.added - bucket.deleted,
    });
  }

  return days;
}

function buildEmptyDays(dayCount: number): GitDayChange[] {
  return buildDaySeries(new Map(), dayCount);
}

function buildMixedSeries(
  byDate: Map<string, { added: number; deleted: number }>,
  recentDays: number,
  monthHistoryDays: number,
): GitDayChange[] {
  const result: GitDayChange[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // 3 months grouped by month
  const monthGroups = new Map<string, { added: number; deleted: number }>();
  for (let i = monthHistoryDays - 1; i >= recentDays; i--) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    const bucket = byDate.get(localDateKey(date)) ?? { added: 0, deleted: 0 };

    const monthBucket = monthGroups.get(monthKey) ?? { added: 0, deleted: 0 };
    monthBucket.added += bucket.added;
    monthBucket.deleted += bucket.deleted;
    monthGroups.set(monthKey, monthBucket);
  }

  // Add 3 months
  for (const [monthKey, bucket] of monthGroups) {
    result.push({
      date: monthKey,
      added: bucket.added,
      deleted: bucket.deleted,
      net: bucket.added - bucket.deleted,
      isMonth: true,
    });
  }

  // Add 7 recent days
  for (let i = recentDays - 1; i >= 0; i--) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - i);
    const key = localDateKey(date);
    const bucket = byDate.get(key) ?? { added: 0, deleted: 0 };

    result.push({
      date: key,
      added: bucket.added,
      deleted: bucket.deleted,
      net: bucket.added - bucket.deleted,
    });
  }

  return result;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${month}/${day}`;
}

export function formatGitChartLabels(days: GitDayChange[]): string[] {
  return days.map((day) => {
    if (day.isMonth) {
      const [year, month] = day.date.split("-");
      return `${month}/${year}`;
    }
    return formatShortDate(day.date);
  });
}
