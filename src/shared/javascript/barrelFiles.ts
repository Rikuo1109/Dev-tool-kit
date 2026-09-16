import * as path from 'path';
import { ImportIndex, normalizePath } from './importGraph';

const INDEX_FILE_RE = /[/\\]index\.(tsx?|jsx?|mjs|cjs)$/i;
const REEXPORT_FROM_RE = /export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/g;

export function isIndexBarrelFile(filePath: string): boolean {
    return INDEX_FILE_RE.test(filePath);
}

export function getLocalReexportTargets(
    content: string,
    filePath: string,
    index: ImportIndex,
): string[] {
    const dir = normalizePath(path.dirname(filePath));
    const targets = new Set<string>();

    REEXPORT_FROM_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REEXPORT_FROM_RE.exec(content)) !== null) {
        const resolved = index.resolve(filePath, match[1]);
        if (!resolved || resolved === 'external') {
            continue;
        }
        if (normalizePath(path.dirname(resolved)) === dir) {
            targets.add(resolved);
        }
    }

    return [...targets];
}

export function isActiveBarrel(
    filePath: string,
    index: ImportIndex,
    reachable?: Set<string>,
): boolean {
    if (!isIndexBarrelFile(filePath)) {
        return false;
    }

    if (index.getImporters(filePath).length > 0) {
        return true;
    }

    const content = index.getContent(filePath);
    if (!REEXPORT_FROM_RE.test(content)) {
        return false;
    }

    REEXPORT_FROM_RE.lastIndex = 0;
    const targets = getLocalReexportTargets(content, filePath, index);
    if (targets.length === 0) {
        return false;
    }

    for (const target of targets) {
        const importers = index.getImporters(target);
        if (importers.some((importer) => importer !== filePath)) {
            return true;
        }
        if (index.entryPoints.has(target)) {
            return true;
        }
        if (reachable?.has(target)) {
            return true;
        }
    }

    return false;
}

export function isReexportOnlyBarrel(content: string, filePath: string): boolean {
    if (!isIndexBarrelFile(filePath)) {
        return false;
    }

    const source = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .trim();

    if (!source) {
        return false;
    }

    const lines = source
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.every((line) => /^export\s+/.test(line) && /from\s+['"]/.test(line));
}
