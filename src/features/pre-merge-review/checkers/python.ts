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

    for (const line of ctx.diff.addedLines) {
        const trimmed = line.content.trim();
        const fromMatch = trimmed.match(/^from\s+[\w.]+\s+import\s+(.+)$/);
        const importMatch = trimmed.match(/^import\s+(.+)$/);
        const clause = fromMatch?.[1] ?? importMatch?.[1];
        if (!clause || clause.includes('*')) {
            continue;
        }

        for (const part of clause.split(',')) {
            const name = part
                .trim()
                .split(/\s+as\s+/)[0]
                ?.trim();
            if (!name) {
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

export const checkPython: FileChecker = (ctx) => {
    const items = [...checkSharedQuality(ctx), ...checkUnusedImports(ctx)];

    for (const hit of linesMatching(ctx, /\bprint\s*\(/)) {
        items.push(issue(ctx, hit.lineNumber, 'warning', 'Quality', 'print() in added code'));
    }

    for (const hit of linesMatching(ctx, /\bexcept\s*:\s*(#.*)?$/)) {
        items.push(issue(ctx, hit.lineNumber, 'critical', 'Safety', 'Bare except: block'));
    }

    for (const hit of linesMatching(ctx, /\b(eval|exec)\s*\(/)) {
        items.push(issue(ctx, hit.lineNumber, 'critical', 'Safety', `${hit.match[1]}() usage`));
    }

    for (const hit of linesMatching(ctx, /__import__\s*\(|importlib\.import_module\s*\(/)) {
        items.push(issue(ctx, hit.lineNumber, 'warning', 'Safety', 'Dynamic import in added code'));
    }

    for (const hit of linesMatching(ctx, /:\s*Any\b|=\s*Any\b/)) {
        items.push(issue(ctx, hit.lineNumber, 'warning', 'Safety', '`Any` typing in added code'));
    }

    for (const hit of linesMatching(ctx, /for\s+\w+\s+in\s+range\s*\(\s*len\s*\(/)) {
        items.push(
            issue(
                ctx,
                hit.lineNumber,
                'warning',
                'Performance',
                'Index loop over range(len(...)) — prefer direct iteration',
            ),
        );
    }

    return items;
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
