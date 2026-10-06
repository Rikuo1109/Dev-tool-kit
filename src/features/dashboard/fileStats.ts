import { promises as fs } from 'fs';
import { extname } from 'path';
import { mapWithConcurrency } from '../../shared/async';
import { REPO_WALK_SKIP_DIRS, scanFolderRespectingRepos } from '../../shared/gitignore';

interface LineCounts {
    code: number;
    blank: number;
    comment: number;
}

interface FileCacheEntry {
    mtimeMs: number;
    size: number;
    /** `null` when the file was empty or unreadable (skipped, same as before). */
    counts: LineCounts | null;
}

/** Per-file line counts keyed by absolute path; reused while mtime and size are unchanged. */
export type FileStatsCache = Map<string, FileCacheEntry>;

const COMPRESSED_EXTS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz']);
const FILE_CONCURRENCY = 32;

const LANG_MAP: Record<string, string> = {
    '.js': 'JavaScript',
    '.ts': 'TypeScript',
    '.jsx': 'JavaScript',
    '.tsx': 'TypeScript',
    '.py': 'Python',
    '.java': 'Java',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.css': 'CSS',
    '.html': 'HTML',
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.md': 'Markdown',
    '.sh': 'Shell',
};

const countCodeLines = (content: string): LineCounts => {
    const lines = content.split('\n');
    let code = 0,
        blank = 0,
        comment = 0;
    let inBlockComment = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Block comments
        if (trimmed.includes('/*')) {
            inBlockComment = true;
        }
        if (inBlockComment) {
            comment++;
            if (trimmed.includes('*/')) {
                inBlockComment = false;
            }
            continue;
        }

        // Blank lines
        if (!trimmed) {
            blank++;
        } else if (trimmed.startsWith('//')) {
            comment++;
        } else {
            code++;
        }
    }

    return { code, blank, comment };
};

export interface FolderScan {
    /** Files to count, in deterministic depth-first order. */
    files: string[];
    /** Repos inside the folder (any nesting level) whose history should be merged. */
    subrepos: string[];
}

const isUnderExcludedDir = (filePath: string, excludeDirs: Set<string>): boolean => {
    return filePath.split(/[/\\]/).some((part) => excludeDirs.has(part));
};

/**
 * Lists the files the dashboard counts and the nested repos whose history it merges.
 * Outside git, each inner repo is listed through git so its own .gitignore applies.
 */
export const scanFolder = async (
    dirPath: string,
    excludeDirs = REPO_WALK_SKIP_DIRS,
): Promise<FolderScan> => {
    const scan = await scanFolderRespectingRepos(dirPath, {
        skipEntry: (name) => name.startsWith('.') || excludeDirs.has(name),
        keepRepoFile: (file) => !isUnderExcludedDir(file, excludeDirs),
    });
    return { files: scan.files, subrepos: scan.nestedRepos };
};

const readCounts = async (
    fullPath: string,
    cache: FileStatsCache | undefined,
): Promise<LineCounts | null> => {
    let stat;
    try {
        stat = await fs.stat(fullPath);
    } catch {
        cache?.delete(fullPath);
        return null;
    }

    const cached = cache?.get(fullPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.counts;
    }

    let counts: LineCounts | null = null;
    if (stat.size > 0) {
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            counts = content ? countCodeLines(content) : null;
        } catch {
            counts = null; // Skip unreadable files (e.g. directories behind symlinks)
        }
    }

    cache?.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, counts });
    return counts;
};

/**
 * Builds the cloc-shaped record consumed by `parseClocData` from a `scanFolder` file list.
 * Only files whose mtime/size changed since the previous call are re-read.
 */
export const countFiles = async (
    files: string[],
    cache?: FileStatsCache,
): Promise<Record<string, unknown>> => {
    const filesToProcess = files.filter(
        (filePath) => !COMPRESSED_EXTS.has(extname(filePath).toLowerCase()),
    );

    const allCounts = await mapWithConcurrency(filesToProcess, FILE_CONCURRENCY, (fullPath) =>
        readCounts(fullPath, cache),
    );

    if (cache) {
        const live = new Set(filesToProcess);
        for (const key of cache.keys()) {
            if (!live.has(key)) {
                cache.delete(key);
            }
        }
    }

    const result: Record<string, unknown> = {};
    let totalFiles = 0;
    let totalCode = 0;
    let totalBlank = 0;
    let totalComment = 0;

    filesToProcess.forEach((fullPath, index) => {
        const counts = allCounts[index];
        if (!counts) {
            return;
        }
        const ext = extname(fullPath).toLowerCase();
        result[fullPath] = {
            blank: counts.blank,
            comment: counts.comment,
            code: counts.code,
            language: LANG_MAP[ext] || ext.slice(1).toUpperCase() || 'Unknown',
        };
        totalFiles++;
        totalCode += counts.code;
        totalBlank += counts.blank;
        totalComment += counts.comment;
    });

    result.SUM = {
        nFiles: totalFiles,
        code: totalCode,
        blank: totalBlank,
        comment: totalComment,
    };

    return result;
};
