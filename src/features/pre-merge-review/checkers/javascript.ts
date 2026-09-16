import { escapeRegExp } from '../../../shared/string';
import { FileCheckContext, FileChecker, ReviewIssue } from '../types';
import { checkSharedQuality, linesMatching } from './shared';

function issue(
    ctx: FileCheckContext,
    line: number,
    severity: ReviewIssue['severity'],
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
    const importLineRe =
        /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s*(?:from\s+['"][^'"]+['"])?;?/;
    const requireRe = /require\s*\(\s*['"][^'"]+['"]\s*\)/;

    for (const line of ctx.diff.addedLines) {
        const trimmed = line.content.trim();
        if (!trimmed.startsWith('import') && !requireRe.test(trimmed)) {
            continue;
        }

        const match = trimmed.match(importLineRe);
        if (!match) {
            continue;
        }

        const names = match[1]
            ? match[1]
                  .split(',')
                  .map((part) =>
                      part
                          .trim()
                          .split(/\s+as\s+/)
                          .pop()
                          ?.trim(),
                  )
                  .filter(Boolean)
            : match[2]
              ? [match[2]]
              : [];

        for (const name of names) {
            if (!name || name === 'type') {
                continue;
            }
            const used = new RegExp(`\\b${escapeRegExp(name)}\\b`).test(
                ctx.fileContent.replace(trimmed, ''),
            );
            if (!used) {
                items.push(
                    issue(ctx, line.lineNumber, 'warning', 'Quality', `Unused import: ${name}`),
                );
            }
        }
    }

    return items;
}

function checkLargeAddedBlock(ctx: FileCheckContext): ReviewIssue[] {
    if (ctx.diff.addedLines.length < 40) {
        return [];
    }

    let runStart = ctx.diff.addedLines[0]?.lineNumber ?? 0;
    let runLength = 1;
    const items: ReviewIssue[] = [];

    for (let i = 1; i < ctx.diff.addedLines.length; i++) {
        const prev = ctx.diff.addedLines[i - 1];
        const current = ctx.diff.addedLines[i];
        if (current.lineNumber === prev.lineNumber + 1) {
            runLength += 1;
            continue;
        }

        if (runLength >= 40) {
            items.push(
                issue(
                    ctx,
                    runStart,
                    'warning',
                    'Performance',
                    `Large added block (${runLength} lines) in diff`,
                ),
            );
        }
        runStart = current.lineNumber;
        runLength = 1;
    }

    if (runLength >= 40) {
        items.push(
            issue(
                ctx,
                runStart,
                'warning',
                'Performance',
                `Large added block (${runLength} lines) in diff`,
            ),
        );
    }

    return items;
}

export const checkJavaScript: FileChecker = (ctx) => {
    const items = [...checkSharedQuality(ctx), ...checkUnusedImports(ctx)];

    for (const hit of linesMatching(ctx, /\bconsole\.(log|debug|info|warn)\s*\(/)) {
        items.push(
            issue(ctx, hit.lineNumber, 'warning', 'Quality', 'console statement in added code'),
        );
    }

    for (const hit of linesMatching(ctx, /\bdebugger\b/)) {
        items.push(issue(ctx, hit.lineNumber, 'warning', 'Quality', 'debugger statement'));
    }

    if (ctx.isTypeScript) {
        for (const hit of linesMatching(ctx, /:\s*any\b|<\s*any\s*>|\bas\s+any\b/)) {
            items.push(issue(ctx, hit.lineNumber, 'warning', 'Type Safety', '`any` usage'));
        }

        for (const hit of linesMatching(ctx, /@ts-ignore|@ts-nocheck/)) {
            items.push(
                issue(
                    ctx,
                    hit.lineNumber,
                    'warning',
                    'Type Safety',
                    'TypeScript directive suppresses type checking',
                ),
            );
        }

        for (const hit of linesMatching(ctx, /\bas\s+unknown\s+as\b/)) {
            items.push(
                issue(ctx, hit.lineNumber, 'warning', 'Type Safety', 'Unsafe type assertion'),
            );
        }
    }

    if (/\.(tsx|jsx)$/i.test(ctx.diff.relativePath)) {
        for (const hit of linesMatching(ctx, /=>\s*(\(|{)/)) {
            items.push(
                issue(
                    ctx,
                    hit.lineNumber,
                    'warning',
                    'Performance',
                    'Inline function in JSX/render path',
                ),
            );
        }
    }

    items.push(...checkLargeAddedBlock(ctx));
    return items;
};
