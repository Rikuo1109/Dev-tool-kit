import { lineAt } from './textMetrics';

export interface CodeBlock {
    startLine: number;
    endLine: number;
    text: string;
}

export const extractCodeBlocks = (source: string, filePath: string) => {
    if (filePath.endsWith('.py')) {
        return extractPythonBlocks(source);
    }
    if (filePath.endsWith('.java')) {
        return extractJavaBlocks(source);
    }
    return extractBraceBlocks(source);
};

const extractPythonBlocks = (source: string): CodeBlock[] => {
    const lines = source.split('\n');
    const blocks: CodeBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(\s*)(?:async\s+)?(?:def|class)\s+(\w+)/);
        if (!match) {
            continue;
        }
        const indent = match[1].length;
        const startLine = i + 1;
        let endLine = startLine;
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j];
            if (!next.trim()) {
                endLine = j + 1;
                continue;
            }
            const nextIndent = next.match(/^(\s*)/)?.[1].length ?? 0;
            if (nextIndent <= indent) {
                break;
            }
            endLine = j + 1;
        }
        blocks.push({
            startLine,
            endLine,
            text: lines.slice(i, endLine).join('\n'),
        });
    }
    return dedupeBlocks(blocks);
};

const extractJavaBlocks = (source: string): CodeBlock[] => {
    const openers = [
        /(?:^|\n)\s*(?:@[\w().,\s"=]+\s+)*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?[\w\[\].,\s<>?]+\s+\w+\s*\([^{;]*\)\s*\{/g,
        /(?:^|\n)\s*(?:@[\w().,\s"=]+\s+)*[\w\[\].,\s<>?]+\s+\w+\s*\([^{;]*\)\s*\{/g,
    ];
    const starts = new Set<number>();
    for (const pattern of openers) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const braceIndex = source.indexOf('{', match.index);
            if (braceIndex >= 0) {
                starts.add(braceIndex);
            }
        }
    }
    const blocks: CodeBlock[] = [];
    for (const braceIndex of [...starts].sort((a, b) => a - b)) {
        const block = readBraceBlock(source, braceIndex);
        if (block) {
            blocks.push(block);
        }
    }
    return dedupeBlocks(blocks);
};

const extractBraceBlocks = (source: string) => {
    const blocks: CodeBlock[] = [];
    const openers = [
        /export\s+(?:async\s+)?function\s+\w+/g,
        /(?:^|\s)(?:async\s+)?function\s+\w+/g,
        /export\s+(?:default\s+)?(?:async\s+)?(?:function|\()/g,
        /(?:^|\s)(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g,
        /(?:^|\s)\w+\s*\([^)]*\)\s*\{/g,
        /(?:^|\s)(?:public|private|protected|static|async)\s+\w+\s*\([^)]*\)\s*\{/g,
    ];
    const starts = new Set<number>();
    for (const pattern of openers) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const braceIndex = source.indexOf('{', match.index);
            if (braceIndex >= 0) {
                starts.add(braceIndex);
            }
        }
    }
    for (const braceIndex of [...starts].sort((a, b) => a - b)) {
        const block = readBraceBlock(source, braceIndex);
        if (block) {
            blocks.push(block);
        }
    }
    return dedupeBlocks(blocks);
};

const readBraceBlock = (source: string, openBrace: number): CodeBlock | undefined => {
    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        const char = source[i];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                const text = source.slice(openBrace, i + 1);
                return {
                    startLine: lineAt(source, openBrace),
                    endLine: lineAt(source, i),
                    text,
                };
            }
        }
    }
    return undefined;
};

const dedupeBlocks = (blocks: CodeBlock[]): CodeBlock[] => {
    const seen = new Set<string>();
    const unique: CodeBlock[] = [];
    for (const block of blocks.sort((a, b) => a.startLine - b.startLine)) {
        const key = `${block.startLine}:${block.endLine}:${block.text.length}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(block);
    }
    return unique;
};
