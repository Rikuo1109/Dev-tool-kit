import { FileCheckContext, FileChecker, ReviewIssue } from '../types';

const TODO_RE = /\b(TODO|FIXME)\b/i;
const COMMENTED_CODE_JS =
    /^\/\/\s*(const|let|var|function|class|import|export|return|if|for|while)\b/;
const COMMENTED_CODE_PY = /^#\s*(def|class|import|from|return|if|for|while)\b/;
const COMMENTED_CODE_JAVA =
    /^\/\/\s*(public|private|protected|class|void|return|if|for|while|import)\b/;
const SECRET_RE = /\b(password|secret|api[_-]?key|token|private[_-]?key)\s*=\s*['"][^'"]{4,}['"]/i;

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

export const checkSharedQuality: FileChecker = (ctx) => {
    const items: ReviewIssue[] = [];

    for (const line of ctx.diff.addedLines) {
        const trimmed = line.content.trim();
        if (!trimmed) {
            continue;
        }

        if (TODO_RE.test(trimmed)) {
            items.push(issue(ctx, line.lineNumber, 'info', 'Quality', 'TODO/FIXME comment'));
        }

        if (SECRET_RE.test(trimmed)) {
            items.push(
                issue(ctx, line.lineNumber, 'critical', 'Security', 'Possible hardcoded secret'),
            );
        }

        if (
            COMMENTED_CODE_JS.test(trimmed) ||
            COMMENTED_CODE_PY.test(trimmed) ||
            COMMENTED_CODE_JAVA.test(trimmed)
        ) {
            items.push(
                issue(ctx, line.lineNumber, 'warning', 'Quality', 'Commented-out code detected'),
            );
        }
    }

    return items;
};

export function linesMatching(
    ctx: FileCheckContext,
    pattern: RegExp,
): Array<{ lineNumber: number; match: RegExpExecArray }> {
    const hits: Array<{ lineNumber: number; match: RegExpExecArray }> = [];
    for (const line of ctx.diff.addedLines) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line.content);
        if (match) {
            hits.push({ lineNumber: line.lineNumber, match });
        }
    }
    return hits;
}
