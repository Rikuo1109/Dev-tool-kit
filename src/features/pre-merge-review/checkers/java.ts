import { FileCheckContext, FileChecker, ReviewIssue } from "../types";
import { checkSharedQuality, linesMatching } from "./shared";

function issue(
  ctx: FileCheckContext,
  line: number,
  severity: ReviewIssue["severity"],
  category: string,
  message: string,
): ReviewIssue {
  return {
    relativePath: ctx.diff.relativePath,
    absolutePath: ctx.diff.absolutePath,
    line,
    severity,
    category,
    message,
  };
}

function checkUnusedImports(ctx: FileCheckContext): ReviewIssue[] {
  const items: ReviewIssue[] = [];

  for (const line of ctx.diff.addedLines) {
    const trimmed = line.content.trim();
    const match = trimmed.match(/^import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/);
    if (!match || match[1].endsWith(".*")) {
      continue;
    }

    const simpleName = match[1].slice(match[1].lastIndexOf(".") + 1);
    const used = new RegExp(`\\b${escapeRegExp(simpleName)}\\b`).test(
      ctx.fileContent.replace(trimmed, ""),
    );
    if (!used) {
      items.push(
        issue(
          ctx,
          line.lineNumber,
          "warning",
          "Quality",
          `Possibly unused import: ${simpleName}`,
        ),
      );
    }
  }

  return items;
}

export const checkJava: FileChecker = (ctx) => {
  const items = [...checkSharedQuality(ctx), ...checkUnusedImports(ctx)];

  for (const hit of linesMatching(ctx, /System\.out\.println\s*\(/)) {
    items.push(
      issue(
        ctx,
        hit.lineNumber,
        "warning",
        "Quality",
        "System.out.println in added code",
      ),
    );
  }

  for (const hit of linesMatching(ctx, /catch\s*\([^)]*\)\s*\{\s*\}/)) {
    items.push(
      issue(ctx, hit.lineNumber, "warning", "Safety", "Empty catch block"),
    );
  }

  for (const hit of linesMatching(
    ctx,
    /\b(List|Map|Set|Collection|Iterator|Comparable)\s*[<(]/,
  )) {
    if (!hit.match[0].includes("<")) {
      items.push(
        issue(ctx, hit.lineNumber, "warning", "Safety", "Raw collection type"),
      );
    }
  }

  for (const hit of linesMatching(
    ctx,
    /Class\.forName\s*\(|\.getDeclaredMethod\s*\(|\.setAccessible\s*\(\s*true\s*\)/,
  )) {
    items.push(
      issue(
        ctx,
        hit.lineNumber,
        "warning",
        "Safety",
        "Reflection usage in added code",
      ),
    );
  }

  for (const hit of linesMatching(ctx, /new\s+\w+\s*\(\s*\)\s*;/)) {
    items.push(
      issue(
        ctx,
        hit.lineNumber,
        "info",
        "Performance",
        "Object allocation in loop-like added code",
      ),
    );
  }

  return items;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
