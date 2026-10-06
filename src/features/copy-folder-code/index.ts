import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { formatFilesForAi } from '../../shared/aiFormat';
import { normalizePath, toRelativePath } from '../../shared/fs';
import { listGitVisibleFiles } from '../../shared/gitignore';

const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    'target',
    '.git',
    '.gitnexus',
    '.next',
    '.nuxt',
    '.turbo',
    '.cache',
    '.vscode-test',
    '.idea',
    '.gradle',
    '.venv',
    'venv',
    '__pycache__',
]);

const SKIP_FILES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'poetry.lock',
    'Cargo.lock',
    'composer.lock',
    '.DS_Store',
]);

const SKIP_EXTS = new Set([
    // images / design
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.tiff', '.psd', '.svg',
    // fonts
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    // media
    '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi', '.flac',
    // archives / packages
    '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz', '.vsix', '.jar', '.war',
    // compiled / binary
    '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.pyc', '.o', '.a', '.node',
    // documents / data blobs
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.db', '.sqlite', '.sqlite3',
    // generated
    '.map', '.lock', '.log',
]);

const MINIFIED_SUFFIXES = ['.min.js', '.min.css'];

/** Single files above this size are treated as generated/data and skipped. */
const MAX_FILE_BYTES = 512 * 1024;
/** Safety cap on how many files are considered at all. */
const MAX_CANDIDATE_FILES = 5000;
/** Ask before copying more than this many characters (~250k tokens). */
const LARGE_COPY_CHARS = 1_000_000;

const isSkippedPath = (filePath: string, folderPath: string): boolean => {
    const rel = path.relative(folderPath, filePath).replace(/\\/g, '/');
    const parts = rel.split('/');
    const fileName = parts[parts.length - 1];

    if (parts.slice(0, -1).some((part) => SKIP_DIRS.has(part))) {
        return true;
    }
    if (SKIP_FILES.has(fileName)) {
        return true;
    }

    const lower = fileName.toLowerCase();
    if (MINIFIED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
        return true;
    }
    return SKIP_EXTS.has(path.extname(lower));
};

/** Walks until one file past the cap so truncation can be detected. */
const walkFolder = async (folderPath: string): Promise<string[]> => {
    const files: string[] = [];
    const limit = MAX_CANDIDATE_FILES + 1;

    const walk = async (dir: string): Promise<void> => {
        if (files.length >= limit) {
            return;
        }

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (files.length >= limit) {
                return;
            }
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) {
                    await walk(fullPath);
                }
            } else if (entry.isFile() && !isSkippedPath(fullPath, folderPath)) {
                files.push(fullPath);
            }
        }
    };

    await walk(folderPath);
    return files;
};

interface CollectResult {
    files: string[];
    skippedLarge: number;
    truncated: boolean;
}

/** Git-visible files (respects .gitignore) when inside a repo, else a filesystem walk. */
const collectFolderFiles = async (folderPath: string): Promise<CollectResult> => {
    const gitFiles = await listGitVisibleFiles(folderPath);
    const candidates = gitFiles?.length ? gitFiles : await walkFolder(folderPath);

    const filtered = [...new Set(candidates.map(normalizePath))]
        .filter((filePath) => !isSkippedPath(filePath, folderPath))
        .sort((a, b) => a.localeCompare(b));

    const truncated = filtered.length > MAX_CANDIDATE_FILES;
    const limited = filtered.slice(0, MAX_CANDIDATE_FILES);

    const files: string[] = [];
    let skippedLarge = 0;
    for (const filePath of limited) {
        try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile()) {
                continue;
            }
            if (stat.size > MAX_FILE_BYTES) {
                skippedLarge++;
                continue;
            }
            files.push(filePath);
        } catch {
            // Deleted-but-tracked or unreadable; skip.
        }
    }

    return { files, skippedLarge, truncated };
};

const formatSize = (chars: number): string => {
    if (chars >= 1024 * 1024) {
        return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(chars / 1024))} KB`;
};

const estimateTokens = (chars: number): string => {
    const tokens = Math.round(chars / 4);
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
};

export const copyFolderCode = async (folderUri: vscode.Uri): Promise<void> => {
    const stat = await fs.stat(folderUri.fsPath);
    const folderPath = normalizePath(
        stat.isDirectory() ? folderUri.fsPath : path.dirname(folderUri.fsPath),
    );
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderPath));
    const baseRoot = workspaceFolder?.uri.fsPath ?? path.dirname(folderPath);
    const folderLabel = toRelativePath(folderPath, baseRoot);

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Collecting code from ${folderLabel}`,
            cancellable: true,
        },
        async (progress, token) => {
            const collected = await collectFolderFiles(folderPath);
            if (token.isCancellationRequested) {
                return undefined;
            }

            let lastReported = 0;
            const formatted = await formatFilesForAi(collected.files, baseRoot, (done, total) => {
                const pct = Math.floor((done / Math.max(total, 1)) * 100);
                if (pct > lastReported) {
                    progress.report({ increment: pct - lastReported, message: `${done}/${total}` });
                    lastReported = pct;
                }
            });
            return token.isCancellationRequested ? undefined : { collected, formatted };
        },
    );

    if (!result) {
        return;
    }

    const { collected, formatted } = result;
    if (!formatted.text) {
        void vscode.window.showWarningMessage(`No source files found to copy in ${folderLabel}.`);
        return;
    }

    const chars = formatted.text.length;
    const sizeInfo = `${formatSize(chars)}, ~${estimateTokens(chars)} tokens`;

    if (chars > LARGE_COPY_CHARS) {
        const choice = await vscode.window.showWarningMessage(
            `${folderLabel} produces a large clipboard payload: ${formatted.fileCount} file(s), ${sizeInfo}. Copy anyway?`,
            { modal: true },
            'Copy',
        );
        if (choice !== 'Copy') {
            return;
        }
    }

    await vscode.env.clipboard.writeText(formatted.text);

    const skipped = formatted.skippedCount + collected.skippedLarge;
    const notes: string[] = [];
    if (skipped > 0) {
        notes.push(`skipped ${skipped} binary/large/unreadable`);
    }
    if (collected.truncated) {
        notes.push(`limited to first ${MAX_CANDIDATE_FILES} files`);
    }
    const suffix = notes.length ? ` (${notes.join('; ')})` : '';

    void vscode.window.showInformationMessage(
        `Copied ${formatted.fileCount} file(s) from ${folderLabel} for AI — ${sizeInfo}${suffix}`,
    );
};
