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

export interface AiFileContent {
    relativePath: string;
    content: string;
}

export interface AiReadResult {
    files: AiFileContent[];
    skippedCount: number;
}

/** Reads files once (open buffers win over disk) so callers can format them several ways. */
export const readFilesForAi = async (
    filePaths: string[],
    workspaceRoot: string,
    onProgress?: (done: number, total: number) => void,
): Promise<AiReadResult> => {
    const openDocs = indexOpenDocuments();
    const files: AiFileContent[] = [];
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
            const relativePath = toRelativePath(normalizePath(filePath), workspaceRoot);
            files.push({ relativePath, content });
        } catch {
            skippedCount++;
        }
    }

    return { files, skippedCount };
};

/** Joins file blocks; `transform` rewrites each file's content (e.g. signatures only). */
export const joinFilesForAi = (
    files: AiFileContent[],
    transform?: (file: AiFileContent) => string,
): string => {
    return files
        .map((file) =>
            formatFileBlockForAi(file.relativePath, transform ? transform(file) : file.content),
        )
        .join('\n\n');
};

export const formatFilesForAi = async (
    filePaths: string[],
    workspaceRoot: string,
    onProgress?: (done: number, total: number) => void,
): Promise<AiFormatResult> => {
    const { files, skippedCount } = await readFilesForAi(filePaths, workspaceRoot, onProgress);
    return { text: joinFilesForAi(files), fileCount: files.length, skippedCount };
};

/** Rough token estimate (~4 chars per token), formatted like `12k`. */
export const estimateTokens = (chars: number): string => {
    const tokens = Math.round(chars / 4);
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
};
