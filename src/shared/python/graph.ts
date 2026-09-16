import * as fs from 'fs';
import * as path from 'path';
import { normalizePath } from '../fs';

function parsePythonImportModules(content: string): string[] {
    const modules = new Set<string>();

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const fromMatch = trimmed.match(/^from\s+((?:\.*[\w.]*)|(?:\.*))\s+import\s+/);
        if (fromMatch) {
            modules.add(fromMatch[1]);
            continue;
        }

        const importMatch = trimmed.match(
            /^import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/,
        );
        if (!importMatch) {
            continue;
        }

        for (const part of importMatch[1].split(',')) {
            const moduleName = part
                .trim()
                .split(/\s+as\s+/)[0]
                ?.trim();
            if (moduleName) {
                modules.add(moduleName);
            }
        }
    }

    return [...modules];
}

export function resolvePythonModule(
    fromFile: string,
    moduleRef: string,
    workspaceRoot: string,
): string | null {
    const fromDir = path.dirname(fromFile);

    if (moduleRef.startsWith('.')) {
        return resolveRelativePythonModule(fromDir, moduleRef);
    }

    const searchRoots = collectPythonSearchRoots(fromFile, workspaceRoot);
    return findPythonModulePath(moduleRef, searchRoots);
}

function resolveRelativePythonModule(fromDir: string, moduleRef: string): string | null {
    const match = moduleRef.match(/^(\.+)(.*)$/);
    if (!match) {
        return null;
    }

    const dotPrefix = match[1];
    const rest = match[2];
    let dir = fromDir;

    for (let i = 1; i < dotPrefix.length; i++) {
        dir = path.dirname(dir);
    }

    if (!rest) {
        return findPythonPackageInit(dir);
    }

    return findPythonModulePath(rest, [dir]);
}

function collectPythonSearchRoots(fromFile: string, workspaceRoot: string): string[] {
    const roots = new Set<string>();
    const normalizedRoot = normalizePath(workspaceRoot);

    let dir = path.dirname(fromFile);
    while (dir.startsWith(normalizedRoot)) {
        roots.add(dir);
        if (dir === normalizedRoot) {
            break;
        }
        dir = path.dirname(dir);
    }

    roots.add(normalizedRoot);
    roots.add(path.join(normalizedRoot, 'src'));
    return [...roots];
}

function findPythonModulePath(moduleRef: string, searchRoots: string[]): string | null {
    const dottedPath = moduleRef.replace(/\./g, '/');

    for (const root of searchRoots) {
        const asModule = path.join(root, `${dottedPath}.py`);
        if (isFile(asModule)) {
            return normalizePath(asModule);
        }

        const asPackage = path.join(root, dottedPath, '__init__.py');
        if (isFile(asPackage)) {
            return normalizePath(asPackage);
        }
    }

    return null;
}

function findPythonPackageInit(dir: string): string | null {
    const initPath = path.join(dir, '__init__.py');
    if (isFile(initPath)) {
        return normalizePath(initPath);
    }

    return null;
}

function isFile(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

export interface PythonImportBinding {
    resolvedPath: string | null;
    importedNames: string[];
    isWildcard: boolean;
    moduleAlias?: string;
}

export function parsePythonImportBindings(
    content: string,
    fromFile: string,
    workspaceRoot: string,
): PythonImportBinding[] {
    const bindings: PythonImportBinding[] = [];

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const fromMatch = trimmed.match(/^from\s+((?:\.*[\w.]*)|(?:\.*))\s+import\s+(.+)$/);
        if (fromMatch) {
            const importClause = fromMatch[2].replace(/\s*#.*$/, '');
            const isWildcard = /\*/.test(importClause);
            bindings.push({
                resolvedPath: resolvePythonModule(fromFile, fromMatch[1], workspaceRoot),
                importedNames: isWildcard ? [] : parseImportedNames(importClause),
                isWildcard,
            });
            continue;
        }

        const importMatch = trimmed.match(/^import\s+(.+)$/);
        if (!importMatch) {
            continue;
        }

        const clause = importMatch[1].replace(/\s*#.*$/, '');
        for (const part of clause.split(',')) {
            const segment = part.trim();
            if (!segment) {
                continue;
            }
            const asParts = segment.split(/\s+as\s+/);
            const moduleRef = asParts[0].trim();
            const alias = asParts[1]?.trim() ?? moduleRef.split('.').pop() ?? moduleRef;
            bindings.push({
                resolvedPath: resolvePythonModule(fromFile, moduleRef, workspaceRoot),
                importedNames: [],
                isWildcard: false,
                moduleAlias: alias,
            });
        }
    }

    return bindings;
}

function parseImportedNames(clause: string): string[] {
    return clause
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+as\s+/)[0]?.trim() ?? '')
        .filter(Boolean);
}

export function parsePythonImports(
    content: string,
    fromFile: string,
    workspaceRoot: string,
): string[] {
    const resolved = new Set<string>();

    for (const moduleRef of parsePythonImportModules(content)) {
        const target = resolvePythonModule(fromFile, moduleRef, workspaceRoot);
        if (target) {
            resolved.add(target);
        }
    }

    return [...resolved];
}
