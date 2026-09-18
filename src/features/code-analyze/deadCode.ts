import * as vscode from 'vscode';
import { isJavaScriptSource } from '../../shared/language';
import { isActiveBarrel, isReexportOnlyBarrel } from '../../shared/javascript/barrelFiles';
import { ImportIndex, findReachableFiles } from '../../shared/javascript/importGraph';
import { findUnusedJavaExports } from './javaExports';
import { findUnusedPythonExports } from './pythonExports';
import {
    AnalyzeFileItem,
    CodeAnalyzeConfig,
    DeadBucket,
    DeadCodeExplorerConfig,
    PRIMARY_BUCKETS,
    UnusedExportItem,
} from './types';
import { lineAt, scriptContent } from '../../shared/code-parser';

const DEFAULT_ENTRY_GLOBS = [
    '**/main.{ts,tsx,js,jsx}',
    'index.{ts,tsx,js,jsx}',
    'src/index.{ts,tsx,js,jsx}',
    '**/App.{tsx,jsx}',
    '**/*.config.{ts,js,mjs,cjs}',
    '**/vite.config.*',
    '**/next.config.*',
    '**/pages/_app.{tsx,jsx}',
    '**/app/layout.{tsx,jsx}',
    '**/main.py',
    '**/__main__.py',
    '**/app.py',
    '**/manage.py',
    '**/wsgi.py',
    '**/asgi.py',
    '**/Main.java',
    '**/*Application.java',
];

const DEFAULT_EXCLUDE_GLOBS = [
    '**/*.test.{ts,tsx,js,jsx}',
    '**/*.spec.{ts,tsx,js,jsx}',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/test_*.py',
    '**/*_test.py',
    '**/tests/**',
    '**/*Test.java',
    '**/test/**',
];

export const getAnalyzeConfig = (): CodeAnalyzeConfig => {
    const config = vscode.workspace.getConfiguration('kyo-tools.codeAnalyze');
    const legacy = vscode.workspace.getConfiguration('kyo-tools.deadCode');

    const readArray = (key: string, fallback: string[]): string[] =>
        config.get<string[]>(key) ?? legacy.get<string[]>(key, fallback);

    return {
        entryGlobs: readArray('entryGlobs', DEFAULT_ENTRY_GLOBS),
        excludeGlobs: readArray('excludeGlobs', DEFAULT_EXCLUDE_GLOBS),
        largeFileLoc: config.get<number>('largeFileLoc', 300),
        largeFunctionLoc: config.get<number>('largeFunctionLoc', 80),
        largeFunctionParams: config.get<number>('largeFunctionParams', 5),
    };
};

const DEFAULT_DEAD_ENTRY_GLOBS = [
    '**/mobile.{js,jsx,ts,tsx}',
    '**/App/mobile.{tsx,jsx,ts,js}',
    '**/index.{js,jsx,ts,tsx}',
    '**/main.{js,jsx,ts,tsx}',
];

const DEFAULT_IGNORE_GLOBS = [
    '**/node_modules/**',
    '**/*.min.js',
    '**/*.{test,spec}.{js,jsx,ts,tsx}',
    '**/*.stories.{js,jsx,ts,tsx}',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/.eslintrc*',
    '**/prettier*',
    '**/generate-react-cli/**',
    '**/*TemplateName*',
];

const DEFAULT_VENDOR_GLOBS = ['public/**/tinymce*/**', 'public/assets/**', '**/vendor/**'];

const DEFAULT_TOOLING_GLOBS = [
    'tools/**',
    'scripts/**',
    '**/webpack*.{js,ts,cjs,mjs}',
    '**/vite.config.*',
    '**/jest.config.*',
    '**/babel.config.*',
    '**/*.config.{js,cjs,mjs,ts}',
];

const DEFAULT_AMBIENT_GLOBS = ['**/*.d.ts', '**/react-app-env.d.ts'];

export const getDeadCodeExplorerConfig = (): DeadCodeExplorerConfig => {
    const config = vscode.workspace.getConfiguration('kyo-tools.deadCodeExplorer');

    const readArray = (key: string, fallback: string[]): string[] =>
        config.get<string[]>(key, fallback);

    const primary = config.get<DeadBucket[]>('primaryBuckets', [...PRIMARY_BUCKETS]);

    return {
        entryGlobs: readArray('entryGlobs', DEFAULT_DEAD_ENTRY_GLOBS),
        ignoreGlobs: readArray('ignoreGlobs', DEFAULT_IGNORE_GLOBS),
        vendorGlobs: readArray('vendorGlobs', DEFAULT_VENDOR_GLOBS),
        toolingGlobs: readArray('toolingGlobs', DEFAULT_TOOLING_GLOBS),
        ambientGlobs: readArray('ambientGlobs', DEFAULT_AMBIENT_GLOBS),
        primaryBuckets: primary.length > 0 ? primary : [...PRIMARY_BUCKETS],
        discoverBundlerEntries: config.get<boolean>('discoverBundlerEntries', true),
    };
};

export const findUnusedFiles = (scopedFiles: string[], index: ImportIndex): AnalyzeFileItem[] => {
    const items: AnalyzeFileItem[] = [];

    for (const filePath of scopedFiles) {
        if (index.entryPoints.has(filePath)) {
            continue;
        }
        if (isActiveBarrel(filePath, index)) {
            continue;
        }
        if (index.getImporters(filePath).length === 0) {
            items.push({
                relativePath: index.relativePath(filePath),
                absolutePath: filePath,
                detail: 'No imports found in workspace',
            });
        }
    }

    return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const findOrphanModules = (scopedFiles: string[], index: ImportIndex): AnalyzeFileItem[] => {
    const reachable = findReachableFiles(index, index.entryPoints);
    const items: AnalyzeFileItem[] = [];

    for (const filePath of scopedFiles) {
        if (index.entryPoints.has(filePath) || reachable.has(filePath)) {
            continue;
        }
        if (isActiveBarrel(filePath, index, reachable)) {
            continue;
        }
        items.push({
            relativePath: index.relativePath(filePath),
            absolutePath: filePath,
            detail: 'Not reachable from configured entry points',
        });
    }

    return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

const buildReexportMap = (
    index: ImportIndex,
): {
    starMap: Map<string, Set<string>>;
    namedMap: Map<string, Map<string, Set<string>>>;
} => {
    const starMap = new Map<string, Set<string>>();
    const namedMap = new Map<string, Map<string, Set<string>>>();
    const starRe = /export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g;
    const namedRe = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    for (const filePath of index.files) {
        const content = index.getContent(filePath);

        starRe.lastIndex = 0;
        let starMatch: RegExpExecArray | null;
        while ((starMatch = starRe.exec(content)) !== null) {
            const resolved = index.resolve(filePath, starMatch[1]);
            if (!resolved || resolved === 'external') {
                continue;
            }
            const set = starMap.get(resolved) ?? new Set<string>();
            set.add(filePath);
            starMap.set(resolved, set);
        }

        namedRe.lastIndex = 0;
        let namedMatch: RegExpExecArray | null;
        while ((namedMatch = namedRe.exec(content)) !== null) {
            const resolved = index.resolve(filePath, namedMatch[2]);
            if (!resolved || resolved === 'external') {
                continue;
            }
            const barrelNames = namedMap.get(resolved) ?? new Map<string, Set<string>>();
            for (const part of namedMatch[1].split(',')) {
                const trimmed = part.trim();
                if (!trimmed) {
                    continue;
                }
                const alias = trimmed.split(/\s+as\s+/);
                const exportedName = (alias[1] ?? alias[0]).trim();
                const set = barrelNames.get(exportedName) ?? new Set<string>();
                set.add(filePath);
                barrelNames.set(exportedName, set);
            }
            namedMap.set(resolved, barrelNames);
        }
    }
    return { starMap, namedMap };
};

const isReexportedViaAliveBarrel = (
    modulePath: string,
    index: ImportIndex,
    reexports: {
        starMap: Map<string, Set<string>>;
        namedMap: Map<string, Map<string, Set<string>>>;
    },
    reachable: Set<string>,
): boolean => {
    const starBarrels = reexports.starMap.get(modulePath);
    if (starBarrels && starBarrels.size > 0) {
        for (const barrel of starBarrels) {
            if (index.entryPoints.has(barrel) || reachable.has(barrel)) {
                return true;
            }
            if (index.getImporters(barrel).length > 0) {
                return true;
            }
        }
    }

    const namedBarrels = reexports.namedMap.get(modulePath);
    if (namedBarrels && namedBarrels.size > 0) {
        for (const [, barrelSet] of namedBarrels) {
            for (const barrel of barrelSet) {
                if (index.entryPoints.has(barrel) || reachable.has(barrel)) {
                    return true;
                }
                if (index.getImporters(barrel).length > 0) {
                    return true;
                }
            }
        }
    }

    return false;
};
export const findUnusedExports = (
    scopedFiles: string[],
    index: ImportIndex,
): UnusedExportItem[] => {
    const items: UnusedExportItem[] = [];

    const reexports = buildReexportMap(index);
    const reachable = findReachableFiles(index, index.entryPoints);

    for (const filePath of scopedFiles) {
        if (!isJavaScriptSource(filePath)) {
            continue;
        }
        const content = index.getContent(filePath);
        if (isReexportOnlyBarrel(content, filePath)) {
            continue;
        }

        const starReexported = isReexportedViaAliveBarrel(filePath, index, reexports, reachable);

        const exports = extractJavaScriptExports(content, filePath);
        if (exports.length === 0) {
            continue;
        }
        const usage = collectJavaScriptExportUsage(index, filePath);

        for (const exp of exports) {
            if (exp.isTypeOnly || usage.namespaceImports) {
                continue;
            }
            if (exp.isDefault) {
                if (!usage.defaultImport && !usage.named.has('default')) {
                    items.push(toExportItem(index, filePath, exp));
                }
                continue;
            }
            if (starReexported) {
                continue;
            }
            if (!usage.named.has(exp.name)) {
                items.push(toExportItem(index, filePath, exp));
            }
        }
    }

    items.push(...findUnusedPythonExports(scopedFiles, index));
    items.push(...findUnusedJavaExports(scopedFiles, index, index.javaTypeIndex));
    return items.sort(
        (a, b) =>
            a.relativePath.localeCompare(b.relativePath) ||
            a.exportName.localeCompare(b.exportName),
    );
};

const toExportItem = (
    index: ImportIndex,
    filePath: string,
    exp: ExtractedExport,
): UnusedExportItem => {
    return {
        relativePath: index.relativePath(filePath),
        absolutePath: filePath,
        exportName: exp.isDefault ? 'default' : exp.name,
        kind: exp.kind,
        line: exp.line,
    };
};

interface ExtractedExport {
    name: string;
    kind: string;
    isDefault: boolean;
    isTypeOnly: boolean;
    line?: number;
}

const extractJavaScriptExports = (content: string, filePath: string): ExtractedExport[] => {
    const source = scriptContent(content, filePath);
    const exports: ExtractedExport[] = [];
    const seen = new Set<string>();

    const add = (item: ExtractedExport) => {
        const key = `${item.isDefault ? 'default' : item.name}:${item.kind}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        exports.push(item);
    };

    const addMatch = (match: RegExpExecArray, item: Omit<ExtractedExport, 'line'>) => {
        add({ ...item, line: lineAt(source, match.index) });
    };

    const directPatterns: Array<[RegExp, string]> = [
        [/export\s+async\s+function\s+(\w+)/g, 'function'],
        [/export\s+function\s+(\w+)/g, 'function'],
        [/export\s+class\s+(\w+)/g, 'class'],
        [/export\s+enum\s+(\w+)/g, 'enum'],
        [/export\s+const\s+(\w+)/g, 'const'],
        [/export\s+let\s+(\w+)/g, 'let'],
        [/export\s+var\s+(\w+)/g, 'var'],
    ];

    for (const [regex, kind] of directPatterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
            addMatch(match, {
                name: match[1],
                kind,
                isDefault: false,
                isTypeOnly: false,
            });
        }
    }

    const typePatterns: Array<[RegExp, string]> = [
        [/export\s+type\s+(\w+)/g, 'type'],
        [/export\s+interface\s+(\w+)/g, 'interface'],
    ];
    for (const [regex, kind] of typePatterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(source)) !== null) {
            addMatch(match, {
                name: match[1],
                kind,
                isDefault: false,
                isTypeOnly: true,
            });
        }
    }

    const defaultMatch = /export\s+default/m.exec(source);
    if (defaultMatch) {
        add({
            name: 'default',
            kind: 'default',
            isDefault: true,
            isTypeOnly: false,
            line: lineAt(source, defaultMatch.index),
        });
    }

    const exportListRe = /export\s+\{([^}]+)\}/g;
    let listMatch: RegExpExecArray | null;
    while ((listMatch = exportListRe.exec(source)) !== null) {
        if (/from\s+['"]/.test(listMatch[0])) {
            continue;
        }
        for (const part of listMatch[1].split(',')) {
            const trimmed = part.trim();
            if (!trimmed) {
                continue;
            }
            const alias = trimmed.split(/\s+as\s+/);
            addMatch(listMatch, {
                name: (alias[1] ?? alias[0]).trim(),
                kind: 'named',
                isDefault: false,
                isTypeOnly: false,
            });
        }
    }

    return exports;
};

const collectJavaScriptExportUsage = (
    index: ImportIndex,
    modulePath: string,
): {
    named: Set<string>;
    defaultImport: boolean;
    namespaceImports: boolean;
} => {
    const named = new Set<string>();
    let defaultImport = false;
    let namespaceImports = false;

    for (const filePath of index.files) {
        for (const imp of index.getImports(filePath)) {
            if (imp.resolvedPath !== modulePath) {
                continue;
            }
            if (imp.namespace) {
                namespaceImports = true;
            }
            if (imp.defaultImport) {
                defaultImport = true;
            }
            for (const name of imp.named) {
                named.add(name);
            }
        }

        const content = index.getContent(filePath);
        const reexportRe = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        while ((match = reexportRe.exec(content)) !== null) {
            const resolved = index.resolve(filePath, match[2]);
            if (resolved !== modulePath) {
                continue;
            }
            for (const part of match[1].split(',')) {
                const trimmed = part.trim();
                if (!trimmed) {
                    continue;
                }
                const alias = trimmed.split(/\s+as\s+/);
                named.add((alias[0] ?? alias[1]).trim());
            }
        }
    }

    return { named, defaultImport, namespaceImports };
};
