import * as fs from 'fs';
import { SourceLanguage } from '../../shared/language';
import { checkJava } from './checkers/java';
import { checkJavaScript } from './checkers/javascript';
import { checkPython } from './checkers/python';
import { checkDependencyChanges } from './checkers/dependencies';
import {
    FileCheckContext,
    FileChecker,
    FileDiff,
    PreMergeReviewReport,
    ReviewIssue,
} from './types';
import {
    collectBranchComparisonDiffs,
    getCurrentBranch,
    readFileAtRef,
    resolveGitRoot,
} from './gitDiff';

const CHECKERS: Record<SourceLanguage, FileChecker | undefined> = {
    javascript: checkJavaScript,
    python: checkPython,
    java: checkJava,
    unknown: undefined,
};

export async function runPreMergeReview(
    folderPath: string,
    compareBranch: string,
): Promise<PreMergeReviewReport> {
    const startedAt = Date.now();
    const gitRoot = resolveGitRoot(folderPath);
    const currentBranch = await getCurrentBranch(gitRoot);

    const fileDiffs = await collectBranchComparisonDiffs(gitRoot, compareBranch, 'HEAD');
    const issues: ReviewIssue[] = [];

    for (const diff of fileDiffs) {
        issues.push(...(await analyzeFileDiff(gitRoot, diff)));
    }

    issues.push(...(await checkDependencyChanges(gitRoot, compareBranch, 'HEAD')));

    return {
        currentBranch,
        compareBranch,
        changedFiles: fileDiffs.length,
        scannedFiles: fileDiffs.length,
        issues: sortIssues(issues),
        durationMs: Date.now() - startedAt,
    };
}

async function analyzeFileDiff(gitRoot: string, diff: FileDiff): Promise<ReviewIssue[]> {
    const checker = CHECKERS[diff.language];
    if (!checker) {
        return [];
    }

    const fileContent =
        (await readFileAtRef(gitRoot, diff.relativePath, diff.contentRef)) ||
        (fs.existsSync(diff.absolutePath) ? fs.readFileSync(diff.absolutePath, 'utf-8') : '');

    const ctx: FileCheckContext = {
        diff,
        fileContent,
        isTypeScript: /\.tsx?$/i.test(diff.relativePath),
    };

    return checker(ctx);
}

function sortIssues(issues: ReviewIssue[]): ReviewIssue[] {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    return issues.sort(
        (a, b) =>
            a.relativePath.localeCompare(b.relativePath) ||
            severityRank[a.severity] - severityRank[b.severity] ||
            a.line - b.line,
    );
}
