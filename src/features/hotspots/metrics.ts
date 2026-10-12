import { promises as fs } from 'fs';
import * as path from 'path';
import { mapWithConcurrency } from '../../shared/async';
import {
    blockLineCount,
    countLoc,
    extractCodeBlocks,
    scriptContent,
    stripJavaCommentsAndStrings,
} from '../../shared/code-parser';
import { isPathInsideFolder, normalizePath, toRelativePath } from '../../shared/fs';
import { getSourceLanguage } from '../../shared/language';
import { ChurnResult } from './churn';

const READ_CONCURRENCY = 16;
/** Files bigger than this are generated/vendored more often than hand-written. */
const MAX_FILE_BYTES = 1024 * 1024;
const BRACE_DECISIONS_RE = /\b(?:if|for|while|case|catch)\b|&&|\|\||(?<!\?)\?(?![.?:])/g;
const PYTHON_DECISIONS_RE = /\b(?:if|elif|for|while|except|and|or)\b/g;

export interface FileComplexity {
    loc: number;
    /** Cyclomatic-style decision-point count for the whole file, plus one. */
    complexity: number;
    maxFunctionLoc: number;
}

export interface HotspotItem extends FileComplexity {
    relativePath: string;
    absolutePath: string;
    commits: number;
    linesChanged: number;
    authors: number;
    /** 0–100, relative to the hottest file in the folder. */
    score: number;
}

export interface HotspotReport {
    folderName: string;
    months: number;
    items: HotspotItem[];
    /** Files with commits in range that are no longer source files on disk (deleted, binary…). */
    skippedCount: number;
    repoCount: number;
    failedRepos: string[];
}

const stripForDecisions = (content: string, filePath: string): string => {
    if (getSourceLanguage(filePath) === 'python') {
        return content
            .replace(/("""|''')[\s\S]*?\1/g, ' ')
            .replace(/#.*$/gm, ' ')
            .replace(/"(\\.|[^"\\\n])*"/g, ' ')
            .replace(/'(\\.|[^'\\\n])*'/g, ' ');
    }
    return stripJavaCommentsAndStrings(content).replace(/`(\\.|[^`\\])*`/g, ' ');
};

export const measureComplexity = (content: string, filePath: string): FileComplexity => {
    const source = scriptContent(content, filePath);
    const stripped = stripForDecisions(source, filePath);
    const pattern =
        getSourceLanguage(filePath) === 'python' ? PYTHON_DECISIONS_RE : BRACE_DECISIONS_RE;
    const decisions = stripped.match(pattern)?.length ?? 0;
    const maxFunctionLoc = extractCodeBlocks(source, filePath).reduce(
        (max, block) => Math.max(max, blockLineCount(block)),
        0,
    );
    return { loc: countLoc(source), complexity: decisions + 1, maxFunctionLoc };
};

const readSource = async (filePath: string): Promise<string | undefined> => {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
            return undefined;
        }
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return undefined; // Deleted since the commit, or unreadable.
    }
};

/** Joins churn with current complexity; score = churn × complexity, normalised to 0–100. */
export const buildHotspotReport = async (
    folder: string,
    months: number,
    churn: ChurnResult,
): Promise<HotspotReport> => {
    const root = normalizePath(folder);
    const candidates = [...churn.files.keys()].filter(
        (filePath) =>
            getSourceLanguage(filePath) !== 'unknown' && isPathInsideFolder(filePath, root),
    );

    const measured = await mapWithConcurrency(candidates, READ_CONCURRENCY, async (filePath) => {
        const content = await readSource(filePath);
        return content === undefined ? undefined : { filePath, ...measureComplexity(content, filePath) };
    });

    const items: HotspotItem[] = [];
    for (const entry of measured) {
        if (!entry) {
            continue;
        }
        const fileChurn = churn.files.get(entry.filePath)!;
        items.push({
            relativePath: toRelativePath(entry.filePath, root),
            absolutePath: entry.filePath,
            commits: fileChurn.commits,
            linesChanged: fileChurn.linesChanged,
            authors: fileChurn.authors.size,
            loc: entry.loc,
            complexity: entry.complexity,
            maxFunctionLoc: entry.maxFunctionLoc,
            score: 0,
        });
    }

    const maxRaw = items.reduce((max, item) => Math.max(max, item.commits * item.complexity), 0);
    for (const item of items) {
        item.score = maxRaw > 0 ? Math.round((100 * item.commits * item.complexity) / maxRaw) : 0;
    }
    items.sort((a, b) => b.score - a.score || b.commits - a.commits);

    return {
        folderName: path.basename(root) || root,
        months,
        items,
        skippedCount: candidates.length - items.length,
        repoCount: churn.repoCount,
        failedRepos: churn.failedRepos,
    };
};
