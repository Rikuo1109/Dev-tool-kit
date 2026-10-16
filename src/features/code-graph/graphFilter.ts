import type { ImportIndex } from '../../shared/javascript/importGraph';

/** Paths of test code: never "unused" themselves, and imports from them alone do not count as use. */
const TEST_PATH_RE =
    /(^|\/)(__tests__|__mocks__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(java|kt)$|(^|\/)test_[^/]*\.py$|_test\.py$/;

export const isTestPath = (rel: string): boolean => TEST_PATH_RE.test(rel);

// ─── user filter options ────────────────────────────────────────────────────

export interface GraphFilterOptions {
    /** Include / `!exclude` patterns, comma or space separated. Empty = everything. */
    text: string;
    hideTests: boolean;
    /** Keep only files with at least this many importers (0 = any). */
    minImporters: number;
}

export const DEFAULT_GRAPH_FILTER: GraphFilterOptions = { text: '', hideTests: false, minImporters: 0 };

export const MIN_IMPORTER_STEPS = [0, 1, 2, 5];
const MAX_FILTER_TEXT = 2000;
const MAX_RULES = 50;

/** Coerces untrusted input (webview message, persisted state) into valid options. */
export const sanitizeGraphFilter = (value: unknown): GraphFilterOptions => {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const min = Number(raw.minImporters);
    return {
        text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_FILTER_TEXT) : '',
        hideTests: raw.hideTests === true,
        minImporters: MIN_IMPORTER_STEPS.includes(min) ? min : 0,
    };
};

export const isGraphFilterActive = (options: GraphFilterOptions): boolean => {
    return options.text.trim() !== '' || options.hideTests || options.minImporters > 0;
};

// ─── pattern parsing ────────────────────────────────────────────────────────

export interface FilterRule {
    /** The pattern as typed (without the leading `!`). */
    source: string;
    kind: 'glob' | 'substring';
    test: (rel: string) => boolean;
}

export interface ParsedGraphFilter {
    includes: FilterRule[];
    excludes: FilterRule[];
    /** Human-readable problems; the filter must not be applied while this is non-empty. */
    errors: string[];
}

const GLOB_CHARS = /[*?[\]{}]/;

/** Splits on commas / whitespace outside `{…}` and double quotes. Throws on unbalanced braces. */
const tokenize = (text: string): string[] => {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;
    let quoted = false;

    const flush = () => {
        if (current) {
            tokens.push(current);
        }
        current = '';
    };

    for (const char of text) {
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (!quoted) {
            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth < 0) {
                    throw new Error('Unmatched "}" in filter');
                }
            } else if (depth === 0 && (char === ',' || /\s/.test(char))) {
                flush();
                continue;
            }
        }
        current += char;
    }
    if (quoted) {
        throw new Error('Unclosed quote in filter');
    }
    if (depth > 0) {
        throw new Error('Unclosed "{" in filter');
    }
    flush();
    return tokens;
};

const escapeRegExp = (char: string): string => char.replace(/[\\^$.|+()]/g, '\\$&');

/** Translates one glob into a regular-expression source (no anchors). Throws on malformed input. */
const globToSource = (glob: string): string => {
    const convert = (start: number, stopAtBrace: boolean): { source: string; end: number } => {
        let out = '';
        let i = start;
        while (i < glob.length) {
            const char = glob[i];
            if (char === '*') {
                if (glob[i + 1] === '*') {
                    let end = i + 2;
                    while (glob[end] === '*') {
                        end++;
                    }
                    const atSegmentStart = i === 0 || glob[i - 1] === '/' || glob[i - 1] === '{' || glob[i - 1] === ',';
                    if (glob[end] === '/' && atSegmentStart) {
                        out += '(?:.*/)?'; // `**/` = zero or more directories
                        i = end + 1;
                    } else {
                        out += '.*';
                        i = end;
                    }
                } else {
                    out += '[^/]*';
                    i++;
                }
            } else if (char === '?') {
                out += '[^/]';
                i++;
            } else if (char === '[') {
                const close = glob.indexOf(']', i + 2);
                if (close < 0) {
                    throw new Error(`Unclosed "[" in "${glob}"`);
                }
                let body = glob.slice(i + 1, close);
                if (body.startsWith('!')) {
                    body = `^${body.slice(1)}`;
                }
                out += `[${body.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
                i = close + 1;
            } else if (char === '{') {
                const parts: string[] = [];
                let position = i + 1;
                for (;;) {
                    const part = convert(position, true);
                    parts.push(part.source);
                    position = part.end;
                    if (glob[position] === ',') {
                        position++;
                        continue;
                    }
                    break;
                }
                if (glob[position] !== '}') {
                    throw new Error(`Unclosed "{" in "${glob}"`);
                }
                out += `(?:${parts.join('|')})`;
                i = position + 1;
            } else if (stopAtBrace && (char === ',' || char === '}')) {
                return { source: out, end: i };
            } else if (char === '}' || char === ']') {
                throw new Error(`Unmatched "${char}" in "${glob}"`);
            } else {
                out += escapeRegExp(char);
                i++;
            }
        }
        return { source: out, end: i };
    };

    return convert(0, false).source;
};

const compileGlob = (pattern: string): FilterRule => {
    const glob = pattern.replace(/\\/g, '/').replace(/^\.?\/+/, '');
    if (!glob) {
        throw new Error(`Empty pattern "${pattern}"`);
    }
    const source = globToSource(glob);
    // Without a slash the pattern names a file or folder at any depth (like .gitignore);
    // with one it is anchored at the workspace root and also covers everything beneath a match.
    const anchored = glob.includes('/');
    let regex: RegExp;
    try {
        regex = anchored ? new RegExp(`^(?:${source})(?:/.*)?$`, 'i') : new RegExp(`^(?:${source})$`, 'i');
    } catch {
        throw new Error(`Invalid pattern "${pattern}"`);
    }
    return {
        source: pattern,
        kind: 'glob',
        test: anchored ? (rel) => regex.test(rel) : (rel) => rel.split('/').some((part) => regex.test(part)),
    };
};

const compileSubstring = (pattern: string): FilterRule => {
    const needle = pattern.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    // A leading slash anchors at the workspace root: `/src` ≈ paths starting with `src`.
    const rooted = needle.startsWith('/');
    return {
        source: pattern,
        kind: 'substring',
        test: (rel) => (rooted ? `/${rel}` : rel).toLowerCase().includes(needle),
    };
};

const compileRule = (pattern: string): FilterRule => {
    return GLOB_CHARS.test(pattern) ? compileGlob(pattern) : compileSubstring(pattern);
};

export const parseGraphFilter = (text: string): ParsedGraphFilter => {
    const parsed: ParsedGraphFilter = { includes: [], excludes: [], errors: [] };
    if (text.length > MAX_FILTER_TEXT) {
        parsed.errors.push(`Filter is too long (max ${MAX_FILTER_TEXT} characters)`);
        return parsed;
    }

    let tokens: string[];
    try {
        tokens = tokenize(text);
    } catch (error) {
        parsed.errors.push(error instanceof Error ? error.message : 'Invalid filter');
        return parsed;
    }
    if (tokens.length > MAX_RULES) {
        parsed.errors.push(`Too many patterns (max ${MAX_RULES})`);
        return parsed;
    }

    for (const token of tokens) {
        const exclude = token.startsWith('!');
        const pattern = exclude ? token.slice(1) : token;
        try {
            if (!pattern.trim()) {
                throw new Error('Empty exclude pattern "!"');
            }
            (exclude ? parsed.excludes : parsed.includes).push(compileRule(pattern));
        } catch (error) {
            parsed.errors.push(error instanceof Error ? error.message : `Invalid pattern "${token}"`);
        }
    }
    return parsed;
};

/** Includes are OR'd (none = everything); an exclude always wins. */
export const matchesGraphFilter = (filter: ParsedGraphFilter, rel: string): boolean => {
    const path = rel.replace(/\\/g, '/');
    if (filter.excludes.some((rule) => rule.test(path))) {
        return false;
    }
    return filter.includes.length === 0 || filter.includes.some((rule) => rule.test(path));
};

// ─── applying a filter to an index ──────────────────────────────────────────

type FilterableIndex = Pick<ImportIndex, 'files' | 'relativePath' | 'getImporters'>;

export interface FilterEvaluation {
    /** Absolute paths that stay in the graph; `null` = no filtering. */
    kept: Set<string> | null;
    /** The filter cannot be applied (invalid pattern, or nothing matches). */
    error?: string;
}

/**
 * Decides which files stay. Patterns and "hide tests" are applied first; "min importers" then
 * counts importers inside that remaining set (one pass: files dropped by it do not lower the
 * counts of others).
 */
export const evaluateGraphFilter = (
    index: FilterableIndex,
    options: GraphFilterOptions,
): FilterEvaluation => {
    const parsed = parseGraphFilter(options.text);
    if (parsed.errors.length) {
        return { kept: null, error: parsed.errors[0] };
    }
    if (!isGraphFilterActive(options)) {
        return { kept: null };
    }

    const rel = (abs: string) => index.relativePath(abs).replace(/\\/g, '/');
    let kept = new Set(
        index.files.filter(
            (abs) => matchesGraphFilter(parsed, rel(abs)) && !(options.hideTests && isTestPath(rel(abs))),
        ),
    );

    if (options.minImporters > 0) {
        const remaining = kept;
        kept = new Set(
            [...remaining].filter(
                (abs) =>
                    index.getImporters(abs).filter((importer) => importer !== abs && remaining.has(importer))
                        .length >= options.minImporters,
            ),
        );
    }

    return kept.size > 0 ? { kept } : { kept: null, error: 'No files match this filter' };
};

/**
 * A view of `base` that only contains `kept` files. Imports to or from other files are dropped,
 * so everything built on it (clusters, cycles, insights, full map) sees one consistent graph.
 */
export const createFilteredIndex = (base: ImportIndex, kept: ReadonlySet<string>): ImportIndex => {
    return {
        workspaceRoot: base.workspaceRoot,
        files: base.files.filter((file) => kept.has(file)),
        entryPoints: new Set([...base.entryPoints].filter((file) => kept.has(file))),
        relativePath: base.relativePath,
        getContent: base.getContent,
        getDependencies: (file) =>
            kept.has(file) ? base.getDependencies(file).filter((dep) => kept.has(dep)) : [],
        getImporters: (file) =>
            kept.has(file) ? base.getImporters(file).filter((importer) => kept.has(importer)) : [],
        getImports: (file) =>
            kept.has(file)
                ? base
                      .getImports(file)
                      .filter((imp) => !imp.resolvedPath || kept.has(imp.resolvedPath))
                : [],
        resolve: (fromFile, specifier) => {
            const resolved = base.resolve(fromFile, specifier);
            return resolved && resolved !== 'external' && !kept.has(resolved) ? null : resolved;
        },
        javaTypeIndex: base.javaTypeIndex,
    };
};
