import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizePath, toRelativePath } from './fs';

export interface AiFormatResult {
    text: string;
    fileCount: number;
    skippedCount: number;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.json': 'json',
    '.md': 'markdown',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.py': 'python',
    '.java': 'java',
    '.kt': 'kotlin',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.sql': 'sql',
    '.sh': 'bash',
};

const BINARY_SNIFF_BYTES = 8000;

export const languageFromPath = (filePath: string): string => {
    return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] ?? '';
};

const looksBinary = (buffer: Uint8Array): boolean => {
    const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < end; i++) {
        if (buffer[i] === 0) {
            return true;
        }
    }
    return false;
};

const indexOpenDocuments = (): Map<string, vscode.TextDocument> => {
    const docs = new Map<string, vscode.TextDocument>();
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file') {
            docs.set(normalizePath(doc.uri.fsPath), doc);
        }
    }
    return docs;
};

/** Prefer open editor buffers (includes unsaved edits); otherwise read from disk, skipping binaries. */
const readTextForAi = async (
    filePath: string,
    openDocs: Map<string, vscode.TextDocument>,
): Promise<string | undefined> => {
    const openDoc = openDocs.get(normalizePath(filePath));
    if (openDoc) {
        return openDoc.getText();
    }
    const buffer = await fs.readFile(filePath);
    if (looksBinary(buffer)) {
        return undefined;
    }
    return buffer.toString('utf-8');
};

/** Use a fence longer than any backtick run inside the content so nested fences stay intact. */
const pickFence = (content: string): string => {
    let longest = 0;
    for (const match of content.matchAll(/`{3,}/g)) {
        longest = Math.max(longest, match[0].length);
    }
    return '`'.repeat(Math.max(3, longest + 1));
};

export const formatFileBlockForAi = (relativePath: string, content: string): string => {
    const lang = languageFromPath(relativePath);
    const fence = pickFence(content);
    const header = lang ? `${fence}${lang}:${relativePath}` : `${fence}${relativePath}`;
    const body = content.endsWith('\n') ? content : `${content}\n`;
    return `${header}\n${body}${fence}`;
};

export const formatFilesForAi = async (
    filePaths: string[],
    workspaceRoot: string,
    onProgress?: (done: number, total: number) => void,
): Promise<AiFormatResult> => {
    const openDocs = indexOpenDocuments();
    const blocks: string[] = [];
    let skippedCount = 0;

    for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        onProgress?.(i, filePaths.length);
        try {
            const content = await readTextForAi(filePath, openDocs);
            if (content === undefined) {
                skippedCount++;
                continue;
            }
            const rel = toRelativePath(normalizePath(filePath), workspaceRoot);
            blocks.push(formatFileBlockForAi(rel, content));
        } catch {
            skippedCount++;
        }
    }

    return { text: blocks.join('\n\n'), fileCount: blocks.length, skippedCount };
};
