import { findJavaSamePackageDependencies, JavaTypeIndex } from '../../shared/java/graph';
import { ImportIndex } from '../../shared/javascript/importGraph';
import { lineAt, stripJavaCommentsAndStrings } from '../../shared/code-parser';
import { UnusedExportItem } from './types';

interface ExtractedExport {
    name: string;
    kind: string;
    line?: number;
    className?: string;
}

export function findUnusedJavaExports(
    scopedFiles: string[],
    index: ImportIndex,
    javaTypeIndex: JavaTypeIndex,
): UnusedExportItem[] {
    const items: UnusedExportItem[] = [];

    for (const filePath of scopedFiles) {
        if (!filePath.endsWith('.java')) {
            continue;
        }

        const content = index.getContent(filePath);
        const exports = extractJavaExports(content);
        if (exports.length === 0) {
            continue;
        }

        const usage = collectJavaExportUsage(filePath, content, index, javaTypeIndex);

        for (const exp of exports) {
            const usageKey = exp.className ? `${exp.className}.${exp.name}` : exp.name;
            if (!usage.has(usageKey) && !usage.has(exp.name)) {
                items.push({
                    relativePath: index.relativePath(filePath),
                    absolutePath: filePath,
                    exportName: exp.className ? `${exp.className}.${exp.name}` : exp.name,
                    kind: exp.kind,
                    line: exp.line,
                });
            }
        }
    }

    return items;
}

function extractJavaExports(content: string): ExtractedExport[] {
    const exports: ExtractedExport[] = [];
    const seen = new Set<string>();
    const className =
        content.match(
            /(?:^|\n)\s*public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+(\w+)/,
        )?.[1] ?? null;

    const add = (item: ExtractedExport) => {
        const key = item.className ? `${item.className}.${item.name}` : item.name;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        exports.push(item);
    };

    if (className) {
        add({
            name: className,
            kind: 'type',
            line: lineAt(
                content,
                content.search(new RegExp(`\\b(?:class|interface|enum|record)\\s+${className}\\b`)),
            ),
            className,
        });
    }

    const staticFieldRe =
        /(?:^|\n)\s*public\s+static\s+(?:final\s+)?[\w<>,\[\].\s?]+\s+(\w+)\s*(?:=|;)/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = staticFieldRe.exec(content)) !== null) {
        if (!className) {
            continue;
        }
        add({
            name: fieldMatch[1],
            kind: 'field',
            line: lineAt(content, fieldMatch.index),
            className,
        });
    }

    const staticMethodRe =
        /(?:^|\n)\s*public\s+static\s+(?:<[^>]+>\s+)?[\w<>,\[\].\s?]+\s+(\w+)\s*\(/g;
    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = staticMethodRe.exec(content)) !== null) {
        if (!className || methodMatch[1] === className) {
            continue;
        }
        add({
            name: methodMatch[1],
            kind: 'method',
            line: lineAt(content, methodMatch.index),
            className,
        });
    }

    return exports;
}

function collectJavaExportUsage(
    modulePath: string,
    moduleContent: string,
    index: ImportIndex,
    javaTypeIndex: JavaTypeIndex,
): Set<string> {
    const used = new Set<string>();
    const className = javaTypeIndex.fileToSimpleName.get(modulePath);
    if (!className) {
        return used;
    }

    for (const filePath of index.files) {
        if (filePath === modulePath) {
            continue;
        }

        const content = stripJavaCommentsAndStrings(index.getContent(filePath));

        if (content.includes(`${className}.`)) {
            const memberRe = new RegExp(`\\b${escapeRegExp(className)}\\.(\\w+)\\b`, 'g');
            let match: RegExpExecArray | null;
            while ((match = memberRe.exec(content)) !== null) {
                used.add(`${className}.${match[1]}`);
                used.add(match[1]);
            }
        }

        if (new RegExp(`\\b${escapeRegExp(className)}\\b`).test(content)) {
            used.add(className);
            used.add(`${className}.${className}`);
        }

        const staticImportRe = /import\s+static\s+([\w.]+(?:\.\w+)?)\s*;/g;
        staticImportRe.lastIndex = 0;
        let staticMatch: RegExpExecArray | null;
        while ((staticMatch = staticImportRe.exec(content)) !== null) {
            const targetFile = resolveStaticImport(staticMatch[1], javaTypeIndex);
            if (targetFile !== modulePath) {
                continue;
            }
            const member = staticMatch[1].includes('.')
                ? staticMatch[1].slice(staticMatch[1].lastIndexOf('.') + 1)
                : staticMatch[1];
            used.add(member);
            used.add(`${className}.${member}`);
        }
    }

    for (const dep of findJavaSamePackageDependencies(moduleContent, modulePath, javaTypeIndex)) {
        const depContent = stripJavaCommentsAndStrings(index.getContent(dep));
        if (className && new RegExp(`\\b${escapeRegExp(className)}\\b`).test(depContent)) {
            used.add(className);
        }
    }

    return used;
}

function resolveStaticImport(specifier: string, javaTypeIndex: JavaTypeIndex): string | null {
    const direct = javaTypeIndex.classToFile.get(specifier);
    if (direct) {
        return direct;
    }

    const lastDot = specifier.lastIndexOf('.');
    if (lastDot <= 0) {
        return null;
    }

    return javaTypeIndex.classToFile.get(specifier.slice(0, lastDot)) ?? null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
