import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from '../../../shared/fs';

const ENTRY_OBJECT_RE = /entry\s*:\s*\{([\s\S]*?)\}/;
const ENTRY_STRING_RE = /entry\s*:\s*['"]([^'"]+)['"]/;
const PATH_RESOLVE_RE = /path\.resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g;

export const parseWebpackLikeEntries = (
    content: string,
    configDir: string,
    workspaceRoot: string,
    entries: Set<string>,
    labels: Map<string, string>,
    existsFn: (absPath: string) => boolean = defaultExists,
): void => {
    const objectMatch = ENTRY_OBJECT_RE.exec(content);
    if (objectMatch) {
        const body = objectMatch[1];
        const pairRe =
            /(\w+)\s*:\s*(?:path\.resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/g;
        let pair: RegExpExecArray | null;
        while ((pair = pairRe.exec(body)) !== null) {
            const name = pair[1];
            const rel = pair[2] ?? pair[3];
            const abs = resolveFromConfig(configDir, workspaceRoot, rel, existsFn);
            if (abs) {
                entries.add(abs);
                labels.set(abs, `webpack entry:${name}`);
            }
        }
    }

    const stringMatch = ENTRY_STRING_RE.exec(content);
    if (stringMatch) {
        const abs = resolveFromConfig(configDir, workspaceRoot, stringMatch[1], existsFn);
        if (abs) {
            entries.add(abs);
            labels.set(abs, 'webpack entry');
        }
    }

    PATH_RESOLVE_RE.lastIndex = 0;
    let resolveMatch: RegExpExecArray | null;
    while ((resolveMatch = PATH_RESOLVE_RE.exec(content)) !== null) {
        const rel = resolveMatch[1];
        if (!/\.(tsx?|jsx?|mjs|cjs)$/i.test(rel) && !rel.includes('src/')) {
            continue;
        }
        const abs = resolveFromConfig(configDir, workspaceRoot, rel, existsFn);
        if (abs) {
            entries.add(abs);
            if (!labels.has(abs)) {
                labels.set(abs, 'path.resolve entry candidate');
            }
        }
    }
};

const resolveFromConfig = (
    configDir: string,
    workspaceRoot: string,
    rel: string,
    existsFn: (absPath: string) => boolean,
): string | null => {
    const cleaned = rel.replace(/^\.\//, '');
    return (
        resolveExisting(configDir, cleaned, existsFn) ??
        resolveExisting(workspaceRoot, cleaned, existsFn)
    );
}

const resolveExisting = (
    root: string,
    rel: string,
    existsFn: (absPath: string) => boolean,
): string | null => {
    const candidates = [
        path.join(root, rel),
        path.join(root, `${rel}.js`),
        path.join(root, `${rel}.ts`),
        path.join(root, `${rel}.tsx`),
        path.join(root, `${rel}.jsx`),
        path.join(root, rel, 'index.js'),
        path.join(root, rel, 'index.ts'),
        path.join(root, rel, 'index.tsx'),
    ];
    for (const candidate of candidates) {
        if (existsFn(candidate)) {
            return normalizePath(candidate);
        }
    }
    return null;
};

const defaultExists = (absPath: string): boolean => {
    try {
        return fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    } catch {
        return false;
    }
};

/** Collect require.context roots mentioned in source (runtime graph seed dirs). */
export const extractRequireContextDirs = (content: string, fromFile: string): string[] => {
    const dirs: string[] = [];
    const re = /require\.context\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
        const abs = normalizePath(path.resolve(path.dirname(fromFile), match[1]));
        dirs.push(abs);
    }
    return dirs;
};

export const isUnderAnyDir = (filePath: string, dirs: string[]): boolean => {
    const norm = normalizePath(filePath);
    return dirs.some((dir) => norm === dir || norm.startsWith(dir.endsWith('/') ? dir : `${dir}/`));
};
