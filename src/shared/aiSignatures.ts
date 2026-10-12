import * as path from 'path';

const BRACE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.java']);
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const ELIDED_BODY = '{ … }';

interface Span {
    start: number;
    end: number;
}

/**
 * Marks every character inside a string, template literal or comment so brace/paren
 * matching ignores them. Regex literals are not detected (rarely contain unbalanced braces).
 */
const maskNonCode = (source: string): Uint8Array => {
    const masked = new Uint8Array(source.length);
    let i = 0;
    while (i < source.length) {
        const char = source[i];
        const next = source[i + 1];
        let end = -1;

        if (char === '/' && next === '/') {
            end = source.indexOf('\n', i);
            end = end === -1 ? source.length : end;
        } else if (char === '/' && next === '*') {
            end = source.indexOf('*/', i + 2);
            end = end === -1 ? source.length : end + 2;
        } else if (char === '"' || char === "'" || char === '`') {
            end = i + 1;
            while (end < source.length && source[end] !== char) {
                if (source[end] === '\\') {
                    end++;
                } else if (source[end] === '\n' && char !== '`') {
                    break;
                }
                end++;
            }
            end = Math.min(end + 1, source.length);
        }

        if (end === -1) {
            i++;
            continue;
        }
        masked.fill(1, i, end);
        i = end;
    }
    return masked;
};

const findMatchingClose = (source: string, masked: Uint8Array, open: number): number => {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (masked[i]) {
            continue;
        }
        if (source[i] === '{') {
            depth++;
        } else if (source[i] === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
};

const findMatchingOpenParen = (source: string, masked: Uint8Array, close: number): number => {
    let depth = 0;
    for (let i = close; i >= 0; i--) {
        if (masked[i]) {
            continue;
        }
        if (source[i] === ')') {
            depth++;
        } else if (source[i] === '(') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
};

/** True when the `(…)` before a `{` belongs to if/for/while/class… rather than a function. */
const isControlStatement = (source: string, masked: Uint8Array, closeParen: number): boolean => {
    const openParen = findMatchingOpenParen(source, masked, closeParen);
    if (openParen < 0) {
        return true;
    }
    const lineStart = source.lastIndexOf('\n', openParen) + 1;
    const before = source.slice(lineStart, openParen);
    if (/\bclass\b/.test(before)) {
        return true; // `class A extends mixin(B) {` — keep the class body.
    }
    const word = before.match(/(\w+)\s*$/)?.[1];
    return word !== undefined && CONTROL_KEYWORDS.has(word);
};

/** Opening braces of function/method bodies (and arrow bodies), ignoring control statements. */
const findBodyOpeners = (source: string, masked: Uint8Array): number[] => {
    const openers: number[] = [];
    const patterns = [/\)[^;{}()=]*\{/g, /=>\s*\{/g];
    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const brace = match.index + match[0].length - 1;
            if (masked[match.index] || masked[brace]) {
                continue;
            }
            if (match[0].startsWith(')') && isControlStatement(source, masked, match.index)) {
                continue;
            }
            openers.push(brace);
        }
    }
    return openers.sort((a, b) => a - b);
};

const elideBraceBodies = (source: string): string => {
    const masked = maskNonCode(source);
    const spans: Span[] = [];
    let coveredUntil = -1;

    for (const open of findBodyOpeners(source, masked)) {
        if (open <= coveredUntil) {
            continue; // Nested inside a body that is already elided.
        }
        const close = findMatchingClose(source, masked, open);
        if (close < 0) {
            continue;
        }
        coveredUntil = close;
        if (source.slice(open, close).includes('\n')) {
            spans.push({ start: open, end: close + 1 });
        }
    }

    let result = '';
    let cursor = 0;
    for (const span of spans) {
        result += source.slice(cursor, span.start) + ELIDED_BODY;
        cursor = span.end;
    }
    return result + source.slice(cursor);
};

const indentOf = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

const parenBalance = (text: string): number => {
    let depth = 0;
    for (const char of text) {
        if (char === '(' || char === '[') {
            depth++;
        } else if (char === ')' || char === ']') {
            depth--;
        }
    }
    return depth;
};

/** Keeps `def` signatures (incl. decorators and multi-line params); bodies become `...`. */
const elidePythonBodies = (source: string): string => {
    const lines = source.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (!/^\s*(?:async\s+)?def\s+\w+/.test(line)) {
            out.push(line);
            i++;
            continue;
        }

        const defIndent = indentOf(line);
        let signature = line;
        out.push(line);
        i++;
        while (i < lines.length && parenBalance(signature) > 0) {
            signature += `\n${lines[i]}`;
            out.push(lines[i]);
            i++;
        }

        let bodyEnd = i;
        let lastContent = i - 1;
        while (bodyEnd < lines.length) {
            const next = lines[bodyEnd];
            if (next.trim() && indentOf(next) <= defIndent) {
                break;
            }
            if (next.trim()) {
                lastContent = bodyEnd;
            }
            bodyEnd++;
        }

        if (lastContent >= i) {
            out.push(`${' '.repeat(defIndent + 4)}...`);
            // Keep trailing blank lines so spacing between definitions survives.
            out.push(...lines.slice(lastContent + 1, bodyEnd));
        }
        i = bodyEnd;
    }

    return out.join('\n');
};

/** Strips function bodies, keeping imports, types, class shapes and signatures. */
export const toSignatures = (content: string, filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') {
        return elidePythonBodies(content);
    }
    if (BRACE_EXTS.has(ext)) {
        return elideBraceBodies(content);
    }
    return content;
};
