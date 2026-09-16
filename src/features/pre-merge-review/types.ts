import { SourceLanguage } from '../../shared/language';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface ReviewIssue {
    relativePath: string;
    absolutePath: string;
    line: number;
    severity: IssueSeverity;
    category: string;
    message: string;
}

export interface AddedLine {
    lineNumber: number;
    content: string;
}

export interface FileDiff {
    relativePath: string;
    absolutePath: string;
    language: SourceLanguage;
    addedLines: AddedLine[];
    contentRef: string;
}

export interface PreMergeReviewReport {
    currentBranch: string;
    compareBranch: string;
    changedFiles: number;
    scannedFiles: number;
    issues: ReviewIssue[];
    durationMs: number;
}

export interface FileCheckContext {
    diff: FileDiff;
    fileContent: string;
    isTypeScript: boolean;
}

export type FileChecker = (ctx: FileCheckContext) => ReviewIssue[];
