import { ImportIndex } from '../../shared/javascript/importGraph';
import { DeadCodeAnalyzer } from '../code-analyze/deadCode';
import { UnusedExportItem } from '../code-analyze/types';
import { isTestPath } from './graphFilter';

export { isTestPath };

export type UsageFlag = 'unused' | 'test-only';

export interface SymbolUsage {
    name: string;
    /** Files importing this symbol by name (`default` for default imports). */
    users: number;
}

/**
 * Usage facts over the whole index, for spotting dead files (nothing imports them) and utilities
 * (many files, from many places, import them). Cheap facts are computed up front; unused exports
 * of a file are computed on demand.
 */
export class GraphInsights {
    private readonly flags = new Map<string, UsageFlag>();
    private readonly fanIn = new Map<string, number>();
    private readonly symbolUsers = new Map<string, Map<string, Set<string>>>();
    private readonly namespaceUsers = new Map<string, Set<string>>();
    private readonly unusedExportCache = new Map<string, UnusedExportItem[]>();
    private analyzer: DeadCodeAnalyzer | undefined;

    constructor(private readonly index: ImportIndex) {
        const rel = (abs: string) => index.relativePath(abs).replace(/\\/g, '/');

        for (const abs of index.files) {
            for (const imp of index.getImports(abs)) {
                const target = imp.resolvedPath;
                if (!target || target === abs) {
                    continue;
                }
                const names = this.symbolUsers.get(target) ?? new Map<string, Set<string>>();
                this.symbolUsers.set(target, names);
                const add = (name: string) => {
                    const users = names.get(name) ?? new Set<string>();
                    users.add(abs);
                    names.set(name, users);
                };
                imp.named.forEach(add);
                if (imp.defaultImport) {
                    add('default');
                }
                if (imp.namespace) {
                    const users = this.namespaceUsers.get(target) ?? new Set<string>();
                    users.add(abs);
                    this.namespaceUsers.set(target, users);
                }
            }
        }

        const unused = new Set(
            new DeadCodeAnalyzer(index).findUnusedFiles(index.files).map((item) => item.absolutePath),
        );
        for (const abs of index.files) {
            const importers = index.getImporters(abs).filter((importer) => importer !== abs);
            this.fanIn.set(abs, importers.length);
            if (isTestPath(rel(abs))) {
                continue;
            }
            if (unused.has(abs)) {
                this.flags.set(abs, 'unused');
            } else if (
                importers.length > 0 &&
                !index.entryPoints.has(abs) &&
                importers.every((importer) => isTestPath(rel(importer)))
            ) {
                this.flags.set(abs, 'test-only');
            }
        }
    }

    flagOf(abs: string): UsageFlag | undefined {
        return this.flags.get(abs);
    }

    fanInOf(abs: string): number {
        return this.fanIn.get(abs) ?? 0;
    }

    importersOf(abs: string): string[] {
        return this.index.getImporters(abs).filter((importer) => importer !== abs);
    }

    /** Named symbols imported from `abs`, most used first. */
    symbolsOf(abs: string): SymbolUsage[] {
        const names = this.symbolUsers.get(abs);
        if (!names) {
            return [];
        }
        return [...names.entries()]
            .map(([name, users]) => ({ name, users: users.size }))
            .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
    }

    namespaceUsersOf(abs: string): number {
        return this.namespaceUsers.get(abs)?.size ?? 0;
    }

    /** Exports nobody imports (JS/TS, Python, Java); computed on first request per file. */
    unusedExportsOf(abs: string): UnusedExportItem[] {
        const cached = this.unusedExportCache.get(abs);
        if (cached) {
            return cached;
        }
        this.analyzer ??= new DeadCodeAnalyzer(this.index);
        const items = this.analyzer.findUnusedExports([abs]);
        this.unusedExportCache.set(abs, items);
        return items;
    }
}
