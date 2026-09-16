import { ImportIndex } from '../../shared/javascript/importGraph';
import { parsePythonImportBindings } from '../../shared/python/graph';
import { lineAt } from './sourceUtils';
import { UnusedExportItem } from './types';

interface ExtractedExport {
    name: string;
    kind: string;
    line?: number;
}

export function findUnusedPythonExports(
    scopedFiles: string[],
    index: ImportIndex,
): UnusedExportItem[] {
    const items: UnusedExportItem[] = [];

    for (const filePath of scopedFiles) {
        if (!filePath.endsWith('.py')) {
            continue;
        }

        const content = index.getContent(filePath);
        const exports = extractPythonExports(content);
        if (exports.length === 0) {
            continue;
        }

        const usage = collectPythonExportUsage(filePath, index);
        if (usage.has('*')) {
            continue;
        }

        for (const exp of exports) {
            if (!usage.has(exp.name)) {
                items.push({
                    relativePath: index.relativePath(filePath),
                    absolutePath: filePath,
                    exportName: exp.name,
                    kind: exp.kind,
                    line: exp.line,
                });
            }
        }
    }

    return items;
}

function extractPythonExports(content: string): ExtractedExport[] {
    const explicitAll = parseAllList(content);
    if (explicitAll.length > 0) {
        return explicitAll.map((name) => ({
            name,
            kind: 'symbol',
        }));
    }

    const exports: ExtractedExport[] = [];
    const seen = new Set<string>();

    const add = (name: string, kind: string, line?: number) => {
        if (name.startsWith('_') || seen.has(name)) {
            return;
        }
        seen.add(name);
        exports.push({ name, kind, line });
    };

    for (const line of content.split('\n')) {
        if (/^\s/.test(line)) {
            continue;
        }

        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const defMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
        if (defMatch) {
            add(defMatch[1], 'function', lineAt(content, content.indexOf(line)));
            continue;
        }

        const classMatch = trimmed.match(/^class\s+(\w+)/);
        if (classMatch) {
            add(classMatch[1], 'class', lineAt(content, content.indexOf(line)));
            continue;
        }

        const constMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
        if (constMatch) {
            add(constMatch[1], 'constant', lineAt(content, content.indexOf(line)));
        }
    }

    return exports;
}

function parseAllList(content: string): string[] {
    const match = content.match(/__all__\s*=\s*(?:\[([^\]]+)\]|\(([^)]+)\))/);
    if (!match) {
        return [];
    }

    const raw = match[1] ?? match[2] ?? '';
    return raw
        .split(',')
        .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

function collectPythonExportUsage(modulePath: string, index: ImportIndex): Set<string> {
    const used = new Set<string>();

    for (const filePath of index.files) {
        if (filePath === modulePath) {
            continue;
        }

        const content = index.getContent(filePath);
        const bindings = parsePythonImportBindings(content, filePath, index.workspaceRoot);

        for (const binding of bindings) {
            if (binding.resolvedPath !== modulePath) {
                continue;
            }

            if (binding.isWildcard) {
                used.add('*');
                continue;
            }

            for (const name of binding.importedNames) {
                used.add(name);
            }

            if (binding.moduleAlias) {
                for (const name of extractModuleAttributeUsage(content, binding.moduleAlias)) {
                    used.add(name);
                }
            }
        }
    }

    if (used.has('*')) {
        return used;
    }

    return used;
}

function extractModuleAttributeUsage(content: string, moduleAlias: string): string[] {
    const names = new Set<string>();
    const re = new RegExp(`\\b${escapeRegExp(moduleAlias)}\\.(\\w+)\\b`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
        names.add(match[1]);
    }
    return [...names];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
