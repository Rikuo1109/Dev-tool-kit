export interface AnalyzeFileItem {
    relativePath: string;
    absolutePath: string;
    detail?: string;
}

export interface UnusedExportItem {
    relativePath: string;
    absolutePath: string;
    exportName: string;
    kind: string;
    line?: number;
}

export interface EntryPointItem {
    relativePath: string;
    absolutePath: string;
}

export interface LargeFileItem {
    relativePath: string;
    absolutePath: string;
    loc: number;
    threshold: number;
    suggestion: string;
}

export interface LargeFunctionItem {
    relativePath: string;
    absolutePath: string;
    name: string;
    startLine: number;
    endLine: number;
    loc: number;
    paramCount: number;
    suggestion: string;
}

export interface CodeAnalyzeReport {
    folderName: string;
    folderPath: string;
    scannedFiles: number;
    unusedFiles: AnalyzeFileItem[];
    orphanModules: AnalyzeFileItem[];
    unusedExports: UnusedExportItem[];
    largeFiles: LargeFileItem[];
    largeFunctions: LargeFunctionItem[];
    entryPoints: EntryPointItem[];
    durationMs: number;
}

export interface CodeAnalyzeConfig {
    entryGlobs: string[];
    excludeGlobs: string[];
    largeFileLoc: number;
    largeFunctionLoc: number;
    largeFunctionParams: number;
}
