import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ANALYZE_SOURCE_GLOB, EXCLUDE_GLOB } from '../constants';
import { createContentCache, normalizePath, toRelativePath } from '../fs';
import { filterGitIgnoredPaths, findGitRoot } from '../gitignore';
import { discoverJavaEntryPoints } from '../java/entryPoints';
import { buildJavaTypeIndex, JavaTypeIndex, parseJavaImports } from '../java/graph';
import { getSourceLanguage } from '../language';
import { discoverPythonEntryPoints } from '../python/entryPoints';
import { parsePythonImports } from '../python/graph';
import { extractVueScript } from '../code-parser';
import { isReexportOnlyBarrel } from './barrelFiles';
import { getCachedImportIndex, setCachedImportIndex } from '../importIndexCache';

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
    | { type: 'external'; name: string }
    | { type: 'unresolved'; specifier: string };

const NODE_BUILTINS = new Set([
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'https',
    'module',
    'net',
    'os',
    'path',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'worker_threads',
    'zlib',
]);

const isNodeBuiltin = (specifier: string): boolean => {
    const base = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    return NODE_BUILTINS.has(base);
};

export const resolveFilePath = (fromDir: string, specifier: string): string | null => {
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
};

export const resolveImport = (
    fromFile: string,
    specifier: string,
    workspaceRoot: string,
    tsConfig: TsConfigContext,
): ResolvedImport | null => {
    if (specifier.startsWith('.')) {
        const resolved = resolveFilePath(path.dirname(fromFile), specifier);
        return resolved
            ? { type: 'internal', fsPath: resolved }
            : { type: 'unresolved', specifier };
    }

    const exactTargets = tsConfig.exactAliases.get(specifier);
    if (exactTargets) {
        for (const targetPattern of exactTargets) {
            const resolved = resolveFilePath(tsConfig.baseUrl, targetPattern.replace(/^\.\//, ''));
            if (resolved) {
                return { type: 'internal', fsPath: resolved };
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

    if (isNodeBuiltin(specifier)) {
        return { type: 'external', name: specifier };
    }

    return {
        type: 'external',
        name: specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0],
    };
};

export const findNearestTsConfig = (filePath: string, workspaceRoot: string): string | null => {
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
};

export const loadTsConfigForFile = (filePath: string, workspaceRoot: string): TsConfigContext => {
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
};

export const findReachableFiles = (index: ImportIndex, seeds: Set<string>): Set<string> => {
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
};

export const buildImportIndex = async (
    workspaceFolder: vscode.WorkspaceFolder,
    entryGlobs: string[],
    excludeGlobs: string[],
): Promise<ImportIndex> => {
    return ImportGraphBuilder.build(workspaceFolder, entryGlobs, excludeGlobs);
};

export class ImportGraphBuilder {
    private readonly workspaceRoot: string;
    private readonly getContent: (absPath: string) => string;
    private javaTypeIndex: JavaTypeIndex = {
        classToFile: new Map(),
        packageToFiles: new Map(),
        fileToPackage: new Map(),
        fileToSimpleName: new Map(),
    };
    private tsConfigCache = new Map<string, TsConfigContext>();
    private readonly dependencies = new Map<string, Set<string>>();
    private readonly importers = new Map<string, Set<string>>();
    private readonly importsByFile = new Map<string, ParsedImport[]>();
    private entryPoints = new Set<string>();
    private files: string[] = [];

    private constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.getContent = createContentCache();
    }

    static async build(
        workspaceFolder: vscode.WorkspaceFolder,
        entryGlobs: string[],
        excludeGlobs: string[],
    ): Promise<ImportIndex> {
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const cached = getCachedImportIndex(workspaceRoot);
        if (cached) {
            return cached;
        }

        const builder = new ImportGraphBuilder(workspaceRoot);
        await builder.scan(workspaceFolder, entryGlobs, excludeGlobs);
        return builder.toIndex();
    }

    getDependencies(absPath: string): string[] {
        return [...(this.dependencies.get(absPath) ?? [])];
    }

    getImporters(absPath: string): string[] {
        return [...(this.importers.get(absPath) ?? [])];
    }

    getImports(absPath: string): ParsedImport[] {
        return this.importsByFile.get(absPath) ?? [];
    }

    resolve(fromFile: string, specifier: string): string | 'external' | null {
        const resolved = resolveImport(fromFile, specifier, this.workspaceRoot, this.getTsConfig(fromFile));
        if (!resolved) {
            return null;
        }
        if (resolved.type === 'internal') {
            return resolved.fsPath;
        }
        if (resolved.type === 'external') {
            return 'external';
        }
        return null;
    }

    relativePath(absPath: string): string {
        return toRelativePath(absPath, this.workspaceRoot);
    }

    private async scan(
        workspaceFolder: vscode.WorkspaceFolder,
        entryGlobs: string[],
        excludeGlobs: string[],
    ): Promise<void> {
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

        const gitRoot = findGitRoot(this.workspaceRoot) ?? this.workspaceRoot;

        this.files = filterGitIgnoredPaths(
            gitRoot,
            uris.map((uri) => normalizePath(uri.fsPath)).filter((filePath) => !excluded.has(filePath)),
        );

        const javaFiles = this.files.filter((filePath) => getSourceLanguage(filePath) === 'java');
        this.javaTypeIndex = buildJavaTypeIndex(javaFiles, this.getContent);

        this.entryPoints = await this.findEntryPoints(workspaceFolder, entryGlobs);
        for (const filePath of filterGitIgnoredPaths(
            gitRoot,
            discoverJavaEntryPoints(this.workspaceRoot, javaFiles, this.javaTypeIndex, this.getContent),
        )) {
            this.entryPoints.add(filePath);
        }
        for (const filePath of filterGitIgnoredPaths(
            gitRoot,
            discoverPythonEntryPoints(this.workspaceRoot),
        )) {
            this.entryPoints.add(normalizePath(filePath));
        }
        for (const filePath of this.files) {
            if (
                /(^|\/)(vite|webpack|jest|eslint|prettier|tailwind|postcss|next)\.config\.(t|j)sx?$/i.test(
                    filePath,
                )
            ) {
                this.entryPoints.add(filePath);
            }
        }

        for (const entry of [...this.entryPoints]) {
            if (isReexportOnlyBarrel(this.getContent(entry), entry)) {
                this.entryPoints.delete(entry);
            }
        }

        for (const filePath of this.files) {
            const parsed = this.parseDetailedImports(filePath);
            this.importsByFile.set(filePath, parsed);

            const deps = new Set<string>();
            for (const item of parsed) {
                if (!item.resolvedPath) {
                    continue;
                }
                deps.add(item.resolvedPath);
                const rev = this.importers.get(item.resolvedPath) ?? new Set<string>();
                rev.add(filePath);
                this.importers.set(item.resolvedPath, rev);
            }
            this.dependencies.set(filePath, deps);
        }
    }

    private toIndex(): ImportIndex {
        const result: ImportIndex = {
            workspaceRoot: this.workspaceRoot,
            files: this.files,
            entryPoints: this.entryPoints,
            relativePath: (absPath) => this.relativePath(absPath),
            getContent: this.getContent,
            getDependencies: (absPath) => this.getDependencies(absPath),
            getImporters: (absPath) => this.getImporters(absPath),
            getImports: (absPath) => this.getImports(absPath),
            resolve: (fromFile, specifier) => this.resolve(fromFile, specifier),
            javaTypeIndex: this.javaTypeIndex,
        };

        setCachedImportIndex(this.workspaceRoot, result);
        return result;
    }

    private async findEntryPoints(
        workspaceFolder: vscode.WorkspaceFolder,
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

        const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
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
                    const resolved = resolveFilePath(this.workspaceRoot, field.replace(/^\.\//, ''));
                    if (resolved) {
                        entries.add(resolved);
                    }
                }
            } catch {
                // ignore invalid package.json
            }
        }

        const gitRoot = findGitRoot(this.workspaceRoot) ?? this.workspaceRoot;
        return new Set(filterGitIgnoredPaths(gitRoot, [...entries]));
    }

    private parseDetailedImports(filePath: string): ParsedImport[] {
        const language = getSourceLanguage(filePath);

        if (language === 'python') {
            return parsePythonImports(this.getContent(filePath), filePath, this.workspaceRoot).map(
                (resolvedPath) => ({
                    specifier: resolvedPath,
                    resolvedPath,
                    named: new Set<string>(),
                    defaultImport: false,
                    namespace: false,
                    sideEffect: true,
                }),
            );
        }

        if (language === 'java') {
            return parseJavaImports(this.getContent(filePath), filePath, this.javaTypeIndex).map(
                (resolvedPath) => ({
                    specifier: resolvedPath,
                    resolvedPath,
                    named: new Set<string>(),
                    defaultImport: false,
                    namespace: false,
                    sideEffect: true,
                }),
            );
        }

        const content = this.getContent(filePath);
        const source = filePath.endsWith('.vue') ? extractVueScript(content) : content;
        const results: ParsedImport[] = [];
        const seen = new Set<string>();

        const add = (specifier: string, clause: string, sideEffect = false) => {
            const key = `${specifier}::${clause}::${sideEffect}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);

            const resolved = this.resolve(filePath, specifier);
            const parsed = ImportGraphBuilder.parseImportClause(clause);
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

    private static parseImportClause(
        clause: string,
    ): {
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

    private getTsConfig(fromFile: string): TsConfigContext {
        const dir = path.dirname(fromFile);
        const cached = this.tsConfigCache.get(dir);
        if (cached) {
            return cached;
        }
        const ctx = loadTsConfigForFile(fromFile, this.workspaceRoot);
        this.tsConfigCache.set(dir, ctx);
        return ctx;
    }
}
