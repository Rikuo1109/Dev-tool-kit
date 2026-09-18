import { lineAt, stripJavaCommentsAndStrings } from '../../shared/code-parser';
import { findJavaSamePackageDependencies, JavaTypeIndex } from '../../shared/java/graph';
import { ImportIndex } from '../../shared/javascript/importGraph';
import { escapeRegExp } from '../../shared/string';
import { UnusedExportItem } from './types';

interface ExtractedExport {
    name: string;
    kind: string;
    line?: number;
    className?: string;
}

export const findUnusedJavaExports = (
    scopedFiles: string[],
    index: ImportIndex,
    javaTypeIndex: JavaTypeIndex,
): UnusedExportItem[] => {
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
};

const extractClassBody = (content: string): string | null => {
    const classMatch = content.match(
        /(?:^|\n)\s*public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+\w+[^{]*\{/,
    );
    if (!classMatch) {
        return null;
    }
    const startIdx = content.indexOf('{', classMatch.index!);
    if (startIdx < 0) {
        return null;
    }
    let depth = 0;
    for (let i = startIdx; i < content.length; i++) {
        if (content[i] === '{') {
            depth++;
        } else if (content[i] === '}') {
            depth--;
            if (depth === 0) {
                return content.slice(startIdx + 1, i);
            }
        }
    }
    return null;
};

const extractJavaExports = (content: string): ExtractedExport[] => {
    const exports: ExtractedExport[] = [];
    const seen = new Set<string>();
    const className =
        content.match(
            /(?:^|\n)\s*public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+(\w+)/,
        )?.[1] ?? null;

    const body = className ? extractClassBody(content) : null;
    const searchArea = body ?? content;

    const add = (item: ExtractedExport) => {
        const key = item.className ? `${item.className}.${item.name}` : item.name;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        exports.push(item);
    };

    if (className) {
        const classBodyOffset = body ? content.indexOf(body) - 1 : 0;
        add({
            name: className,
            kind: 'type',
            line: lineAt(
                content,
                content.search(new RegExp(`\\b(?:class|interface|enum|record)\\s+${className}\\b`)),
            ),
            className,
        });

        const staticFieldRe =
            /(?:^|\n)\s*public\s+static\s+(?:final\s+)?[\w<>,\[\].\s?]+\s+(\w+)\s*(?:=|;)/g;
        let fieldMatch: RegExpExecArray | null;
        while ((fieldMatch = staticFieldRe.exec(searchArea)) !== null) {
            add({
                name: fieldMatch[1],
                kind: 'field',
                line: lineAt(content, classBodyOffset + fieldMatch.index),
                className,
            });
        }

        const staticMethodRe =
            /(?:^|\n)\s*public\s+static\s+(?:<[^>]+>\s+)?[\w<>,\[\].\s?]+\s+(\w+)\s*\(/g;
        let methodMatch: RegExpExecArray | null;
        while ((methodMatch = staticMethodRe.exec(searchArea)) !== null) {
            if (methodMatch[1] === className) {
                continue;
            }
            add({
                name: methodMatch[1],
                kind: 'method',
                line: lineAt(content, classBodyOffset + methodMatch.index),
                className,
            });
        }
    }

    return exports;
};

const collectJavaExportUsage = (
    modulePath: string,
    moduleContent: string,
    index: ImportIndex,
    javaTypeIndex: JavaTypeIndex,
): Set<string> => {
    const used = new Set<string>();
    const className = javaTypeIndex.fileToSimpleName.get(modulePath);
    if (!className) {
        return used;
    }

    const candidateFiles = new Set<string>();
    for (const importer of index.getImporters(modulePath)) {
        candidateFiles.add(importer);
    }
    for (const dep of findJavaSamePackageDependencies(moduleContent, modulePath, javaTypeIndex)) {
        candidateFiles.add(dep);
    }

    for (const filePath of candidateFiles) {
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

    return used;
};

const resolveStaticImport = (specifier: string, javaTypeIndex: JavaTypeIndex): string | null => {
    const direct = javaTypeIndex.classToFile.get(specifier);
    if (direct) {
        return direct;
    }

    const lastDot = specifier.lastIndexOf('.');
    if (lastDot <= 0) {
        return null;
    }

    return javaTypeIndex.classToFile.get(specifier.slice(0, lastDot)) ?? null;
};
