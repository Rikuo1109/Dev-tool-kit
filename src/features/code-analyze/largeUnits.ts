import { ImportIndex } from '../../shared/javascript/importGraph';
import { extractCodeBlocks } from './sourceUtils';
import { blockLineCount, countLoc, scriptContent } from '../../shared/code-parser';
import { CodeAnalyzeConfig, LargeFileItem, LargeFunctionItem } from './types';

export function findLargeFiles(
    scopedFiles: string[],
    index: ImportIndex,
    config: CodeAnalyzeConfig,
): LargeFileItem[] {
    const items: LargeFileItem[] = [];

    for (const filePath of scopedFiles) {
        const content = scriptContent(index.getContent(filePath), filePath);
        const loc = countLoc(content);
        if (loc <= config.largeFileLoc) {
            continue;
        }

        items.push({
            relativePath: index.relativePath(filePath),
            absolutePath: filePath,
            loc,
            threshold: config.largeFileLoc,
            suggestion: `File has ${loc} non-empty lines (>${config.largeFileLoc}). Split by feature/domain into smaller modules.`,
        });
    }

    return items.sort((a, b) => b.loc - a.loc);
}

export function findLargeFunctions(
    scopedFiles: string[],
    index: ImportIndex,
    config: CodeAnalyzeConfig,
): LargeFunctionItem[] {
    const items: LargeFunctionItem[] = [];

    for (const filePath of scopedFiles) {
        const source = scriptContent(index.getContent(filePath), filePath);
        const lines = source.split('\n');
        const blocks = extractCodeBlocks(source, filePath);

        for (const block of blocks) {
            const snippetStart = Math.max(0, block.startLine - 4);
            const snippet = lines.slice(snippetStart, block.startLine).join('\n');
            const name = extractFunctionName(snippet) ?? 'anonymous';
            const paramCount = countParams(snippet);
            const loc = blockLineCount(block);

            if (loc <= config.largeFunctionLoc && paramCount <= config.largeFunctionParams) {
                continue;
            }

            items.push({
                relativePath: index.relativePath(filePath),
                absolutePath: filePath,
                name,
                startLine: block.startLine,
                endLine: block.endLine,
                loc,
                paramCount,
                suggestion: buildFunctionSuggestion(loc, paramCount, config),
            });
        }
    }

    return items.sort((a, b) => b.loc - a.loc || b.paramCount - a.paramCount);
}

function extractFunctionName(snippet: string): string | undefined {
    const patterns = [
        /export\s+(?:async\s+)?function\s+(\w+)/,
        /(?:async\s+)?function\s+(\w+)/,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
        /(?:async\s+)?def\s+(\w+)\s*\(/,
        /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>,\[\]\s.?]+\s+(\w+)\s*\(/,
        /[\w<>,\[\].\s?]+\s+(\w+)\s*\([^{;]*\)\s*\{/,
        /(\w+)\s*\([^)]*\)\s*\{/,
    ];

    for (const pattern of patterns) {
        const match = snippet.match(pattern);
        if (
            match?.[1] &&
            !['if', 'for', 'while', 'switch', 'catch', 'class', 'interface', 'enum'].includes(
                match[1],
            )
        ) {
            return match[1];
        }
    }

    return undefined;
}

function countParams(signature: string): number {
    const match = signature.match(/\(([^)]*)\)/) ?? signature.match(/def\s+\w+\s*\(([^)]*)\)/);
    if (!match) {
        return 0;
    }
    return match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean).length;
}

function buildFunctionSuggestion(
    loc: number,
    paramCount: number,
    config: CodeAnalyzeConfig,
): string {
    const parts: string[] = [];
    if (loc > config.largeFunctionLoc) {
        parts.push(
            `Split into smaller functions (${loc} lines, threshold ${config.largeFunctionLoc})`,
        );
    }
    if (paramCount > config.largeFunctionParams) {
        parts.push(`Reduce parameters (${paramCount}) — group into an options object`);
    }
    return `${parts.join('. ')}.`;
}
