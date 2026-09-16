import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ANALYZE_SOURCE_GLOB, EXCLUDE_GLOB } from '../constants';
import { normalizePath, toRelativePath } from '../fs';
import { filterGitIgnoredPaths, findGitRoot } from '../gitignore';
import { discoverJavaEntryPoints } from '../java/entryPoints';
import { buildJavaTypeIndex, JavaTypeIndex, parseJavaImports } from '../java/graph';
import { getSourceLanguage } from '../language';
import { discoverPythonEntryPoints } from '../python/entryPoints';
import { parsePythonImports } from '../python/graph';

const RESOLVE_EXTENSIONS = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.java',
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx',
    '/__init__.py',
];

const IMPORT_FROM_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /export\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface TsConfigContext {
    baseUrl: string;
    pathAliases: Map<string, string[]>;
    exactAliases: Map<string, string[]>;
}

export interface ParsedImport {
    specifier: string;
    resolvedPath: string | null;
    named: Set<string>;
    defaultImport: boolean;
    namespace: boolean;
    sideEffect: boolean;
}

export interface ImportIndex {
    workspaceRoot: string;
    files: string[];
    entryPoints: Set<string>;
    relativePath: (absPath: string) => string;
    getContent: (absPath: string) => string;
    getDependencies: (absPath: string) => string[];
    getImporters: (absPath: string) => string[];
    getImports: (absPath: string) => ParsedImport[];
    resolve: (fromFile: string, specifier: string) => string | 'external' | null;
    javaTypeIndex: JavaTypeIndex;
}

export type ResolvedImport =
    | { type: 'internal'; fsPath: string }
    | { type: 'external'; name: string };

export async function buildImportIndex(
    workspaceFolder: vscode.WorkspaceFolder,
    entryGlobs: string[],
    excludeGlobs: string[],
): Promise<ImportIndex> {
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, ANALYZE_SOURCE_GLOB),
        EXCLUDE_GLOB,
    );

    const excluded = new Set<string>();
    for (const pattern of excludeGlobs) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, pattern),
            EXCLUDE_GLOB,
        );
        for (const uri of matches) {
            excluded.add(normalizePath(uri.fsPath));
        }
    }

    const gitRoot = findGitRoot(workspaceRoot) ?? workspaceRoot;

    const files = filterGitIgnoredPaths(
        gitRoot,
        uris.map((uri) => normalizePath(uri.fsPath)).filter((filePath) => !excluded.has(filePath)),
    );

    const contentCache = new Map<string, string>();
    const getContent = (absPath: string): string => {
        const cached = contentCache.get(absPath);
        if (cached !== undefined) {
            return cached;
        }
        const text = fs.readFileSync(absPath, 'utf-8');
        contentCache.set(absPath, text);
        return text;
    };

    const javaFiles = files.filter((filePath) => getSourceLanguage(filePath) === 'java');
    const javaTypeIndex = buildJavaTypeIndex(javaFiles, getContent);

    const entryPoints = await findEntryPoints(workspaceFolder, workspaceRoot, entryGlobs);
    for (const filePath of filterGitIgnoredPaths(
        gitRoot,
        discoverJavaEntryPoints(workspaceRoot, javaFiles, javaTypeIndex, getContent),
    )) {
        entryPoints.add(filePath);
    }
    for (const filePath of filterGitIgnoredPaths(
        gitRoot,
        discoverPythonEntryPoints(workspaceRoot),
    )) {
        entryPoints.add(normalizePath(filePath));
    }
    for (const filePath of files) {
        if (
            /(^|\/)(vite|webpack|jest|eslint|prettier|tailwind|postcss|next)\.config\.(t|j)sx?$/i.test(
                filePath,
            )
        ) {
            entryPoints.add(filePath);
        }
    }

    const tsConfigCache = new Map<string, TsConfigContext>();
    const dependencies = new Map<string, Set<string>>();
    const importers = new Map<string, Set<string>>();
    const importsByFile = new Map<string, ParsedImport[]>();

    const getTsConfig = (fromFile: string): TsConfigContext => {
        const dir = path.dirname(fromFile);
        const cached = tsConfigCache.get(dir);
        if (cached) {
            return cached;
        }
        const ctx = loadTsConfigForFile(fromFile, workspaceRoot);
        tsConfigCache.set(dir, ctx);
        return ctx;
    };

    const resolve = (fromFile: string, specifier: string): string | 'external' | null => {
        const resolved = resolveImport(fromFile, specifier, workspaceRoot, getTsConfig(fromFile));
        if (!resolved) {
            return null;
        }
        return resolved.type === 'internal' ? resolved.fsPath : 'external';
    };

    for (const filePath of files) {
        const parsed = parseDetailedImports(
            getContent(filePath),
            filePath,
            (spec) => resolve(filePath, spec),
            workspaceRoot,
            javaTypeIndex,
        );
        importsByFile.set(filePath, parsed);

        const deps = new Set<string>();
        for (const item of parsed) {
            if (!item.resolvedPath) {
                continue;
            }
            deps.add(item.resolvedPath);
            const rev = importers.get(item.resolvedPath) ?? new Set<string>();
            rev.add(filePath);
            importers.set(item.resolvedPath, rev);
        }
        dependencies.set(filePath, deps);
    }

    return {
        workspaceRoot,
        files,
        entryPoints,
        relativePath: (absPath) => toRelativePath(absPath, workspaceRoot),
        getContent,
        getDependencies: (absPath) => [...(dependencies.get(absPath) ?? [])],
        getImporters: (absPath) => [...(importers.get(absPath) ?? [])],
        getImports: (absPath) => importsByFile.get(absPath) ?? [],
        resolve,
        javaTypeIndex,
    };
}

export function findReachableFiles(index: ImportIndex, seeds: Set<string>): Set<string> {
    const reachable = new Set<string>();
    const queue = [...seeds];

    while (queue.length > 0) {
        const current = queue.pop();
        if (!current || reachable.has(current)) {
            continue;
        }
        reachable.add(current);
        for (const dep of index.getDependencies(current)) {
            if (!reachable.has(dep)) {
                queue.push(dep);
            }
        }
    }

    return reachable;
}

async function findEntryPoints(
    workspaceFolder: vscode.WorkspaceFolder,
    workspaceRoot: string,
    entryGlobs: string[],
): Promise<Set<string>> {
    const entries = new Set<string>();

    for (const pattern of entryGlobs) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, pattern),
            EXCLUDE_GLOB,
        );
        for (const uri of matches) {
            entries.add(normalizePath(uri.fsPath));
        }
    }

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
                main?: string;
                module?: string;
            };
            for (const field of [pkg.main, pkg.module]) {
                if (!field) {
                    continue;
                }
                const resolved = resolveFilePath(workspaceRoot, field.replace(/^\.\//, ''));
                if (resolved) {
                    entries.add(resolved);
                }
            }
        } catch {
            // ignore invalid package.json
        }
    }

    const gitRoot = findGitRoot(workspaceRoot) ?? workspaceRoot;
    return new Set(filterGitIgnoredPaths(gitRoot, [...entries]));
}

function parseDetailedImports(
    content: string,
    filePath: string,
    resolveFn: (specifier: string) => string | 'external' | null,
    workspaceRoot: string,
    javaTypeIndex: JavaTypeIndex,
): ParsedImport[] {
    const language = getSourceLanguage(filePath);

    if (language === 'python') {
        return parsePythonImports(content, filePath, workspaceRoot).map((resolvedPath) => ({
            specifier: resolvedPath,
            resolvedPath,
            named: new Set<string>(),
            defaultImport: false,
            namespace: false,
            sideEffect: true,
        }));
    }

    if (language === 'java') {
        return parseJavaImports(content, filePath, javaTypeIndex).map((resolvedPath) => ({
            specifier: resolvedPath,
            resolvedPath,
            named: new Set<string>(),
            defaultImport: false,
            namespace: false,
            sideEffect: true,
        }));
    }

    const source = filePath.endsWith('.vue') ? extractVueScript(content) : content;
    const results: ParsedImport[] = [];
    const seen = new Set<string>();

    const add = (specifier: string, clause: string, sideEffect = false) => {
        const key = `${specifier}::${clause}::${sideEffect}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        const resolved = resolveFn(specifier);
        const parsed = parseImportClause(clause);
        results.push({
            specifier,
            resolvedPath: resolved === 'external' ? null : resolved,
            named: parsed.named,
            defaultImport: parsed.defaultImport,
            namespace: parsed.namespace,
            sideEffect,
        });
    };

    for (const regex of [IMPORT_FROM_RE, EXPORT_FROM_RE]) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
            add(match[3], match[2].trim(), false);
        }
    }

    SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
    let sideMatch: RegExpExecArray | null;
    while ((sideMatch = SIDE_EFFECT_IMPORT_RE.exec(source)) !== null) {
        if (/from\s+['"]/.test(sideMatch[0])) {
            continue;
        }
        add(sideMatch[1], '', true);
    }

    for (const regex of [REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
            add(match[1], '', true);
        }
    }

    return results;
}

function parseImportClause(clause: string): {
    named: Set<string>;
    defaultImport: boolean;
    namespace: boolean;
} {
    const named = new Set<string>();
    let defaultImport = false;
    let namespace = false;

    if (!clause) {
        return { named, defaultImport, namespace };
    }

    if (/^\*\s+as\s+\w+/.test(clause)) {
        namespace = true;
        return { named, defaultImport, namespace };
    }

    const braceMatch = clause.match(/\{([^}]*)\}/);
    if (braceMatch) {
        for (const part of braceMatch[1].split(',')) {
            const trimmed = part.trim();
            if (!trimmed) {
                continue;
            }
            const alias = trimmed.split(/\s+as\s+/);
            named.add((alias[1] ?? alias[0]).trim());
        }
        clause = clause.replace(/\{[^}]*\}/, '').trim();
    }

    if (clause && !/^type\s/.test(clause)) {
        defaultImport = true;
    }

    return { named, defaultImport, namespace };
}

function parseImports(content: string, filePath: string): string[] {
    const specifiers = new Set<string>();
    const source = filePath.endsWith('.vue') ? extractVueScript(content) : content;

    for (const regex of [
        /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
        REQUIRE_RE,
        DYNAMIC_IMPORT_RE,
        SIDE_EFFECT_IMPORT_RE,
    ]) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
            specifiers.add(match[1]);
        }
    }

    return [...specifiers];
}

function extractVueScript(content: string): string {
    const blocks = [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    return blocks.map((block) => block[1]).join('\n');
}

export function resolveImport(
    fromFile: string,
    specifier: string,
    workspaceRoot: string,
    tsConfig: TsConfigContext,
): ResolvedImport | null {
    if (specifier.startsWith('.')) {
        const resolved = resolveFilePath(path.dirname(fromFile), specifier);
        return resolved ? { type: 'internal', fsPath: resolved } : null;
    }

    if (!specifier.startsWith('.')) {
        const exactTargets = tsConfig.exactAliases.get(specifier);
        if (exactTargets) {
            for (const targetPattern of exactTargets) {
                const resolved = resolveFilePath(
                    tsConfig.baseUrl,
                    targetPattern.replace(/^\.\//, ''),
                );
                if (resolved) {
                    return { type: 'internal', fsPath: resolved };
                }
            }
        }
    }

    for (const [prefix, targets] of tsConfig.pathAliases) {
        if (!specifier.startsWith(prefix)) {
            continue;
        }
        const rest = specifier.slice(prefix.length);
        for (const targetPattern of targets) {
            const mapped = targetPattern.includes('*')
                ? targetPattern.replace('*', rest)
                : targetPattern;
            const resolved = resolveFilePath(tsConfig.baseUrl, mapped.replace(/^\.\//, ''));
            if (resolved) {
                return { type: 'internal', fsPath: resolved };
            }
        }
    }

    const fromBase = resolveFilePath(tsConfig.baseUrl, specifier);
    if (fromBase) {
        return { type: 'internal', fsPath: fromBase };
    }

    const fromSrc = resolveFilePath(path.join(workspaceRoot, 'src'), specifier);
    if (fromSrc) {
        return { type: 'internal', fsPath: fromSrc };
    }

    if (!specifier.startsWith('.')) {
        return {
            type: 'external',
            name: specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : specifier.split('/')[0],
        };
    }

    return null;
}

function resolveFilePath(fromDir: string, specifier: string): string | null {
    const base = path.resolve(fromDir, specifier);
    for (const ext of RESOLVE_EXTENSIONS) {
        const candidate = normalizePath(base + ext);
        try {
            if (fs.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch {
            // file doesn't exist or isn't accessible
        }
    }
    return null;
}

export function loadTsConfigForFile(filePath: string, workspaceRoot: string): TsConfigContext {
    const configPath = findNearestTsConfig(filePath, workspaceRoot);
    if (!configPath) {
        return {
            baseUrl: path.join(workspaceRoot, 'src'),
            pathAliases: new Map(),
            exactAliases: new Map(),
        };
    }

    try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
            compilerOptions?: {
                baseUrl?: string;
                paths?: Record<string, string[]>;
            };
        };
        const configDir = path.dirname(configPath);
        const baseUrlSetting = raw.compilerOptions?.baseUrl ?? '.';
        const baseUrl = path.resolve(configDir, baseUrlSetting);
        const pathAliases = new Map<string, string[]>();
        const exactAliases = new Map<string, string[]>();
        const paths = raw.compilerOptions?.paths ?? {};

        for (const [key, values] of Object.entries(paths)) {
            if (key.endsWith('/*')) {
                pathAliases.set(key.slice(0, -1), values);
                continue;
            }

            if (key.includes('*')) {
                pathAliases.set(key.replace('*', ''), values);
                continue;
            }

            exactAliases.set(key, values);
        }

        return { baseUrl, pathAliases, exactAliases };
    } catch {
        return {
            baseUrl: path.join(workspaceRoot, 'src'),
            pathAliases: new Map(),
            exactAliases: new Map(),
        };
    }
}

function findNearestTsConfig(filePath: string, workspaceRoot: string): string | null {
    const configNames = ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json'];
    let dir = path.dirname(filePath);
    const root = path.resolve(workspaceRoot);

    while (dir.startsWith(root)) {
        for (const name of configNames) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        if (dir === root) {
            break;
        }
        dir = path.dirname(dir);
    }

    for (const name of configNames) {
        const candidate = path.join(root, name);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

export { parseImports };
