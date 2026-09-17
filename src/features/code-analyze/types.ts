export type DeadBucket =
    | 'dead'
    | 'likely-dead'
    | 'runtime'
    | 'entry'
    | 'tooling'
    | 'ambient'
    | 'vendor'
    | 'unknown';

export type DeadConfidence = 'high' | 'medium' | 'low';

export type DeadReason =
    | 'no_importers'
    | 'unreachable_from_entries'
    | 'not_in_asset_graph'
    | 'classified_path'
    | 'runtime_ref'
    | 'entry_seed'
    | 'barrel_reexport'
    | 'export_unused';

export interface DeadItem {
    relativePath: string;
    absolutePath: string;
    name?: string;
    detail?: string;
    line?: number;
    bucket?: DeadBucket;
    confidence?: DeadConfidence;
    reason?: DeadReason;
    falsePositiveHint?: string;
}

export interface BucketCounts {
    dead: number;
    'likely-dead': number;
    runtime: number;
    entry: number;
    tooling: number;
    ambient: number;
    vendor: number;
    unknown: number;
}

export interface FilesSummary {
    totalClassified: number;
    primaryCount: number;
    noiseCount: number;
    noisePercent: number;
    byBucket: BucketCounts;
}

export const PRIMARY_BUCKETS: DeadBucket[] = ['dead', 'likely-dead'];

export const EMPTY_BUCKET_COUNTS = (): BucketCounts => ({
    dead: 0,
    'likely-dead': 0,
    runtime: 0,
    entry: 0,
    tooling: 0,
    ambient: 0,
    vendor: 0,
    unknown: 0,
});

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
    deadFiles: DeadItem[];
    allDeadFiles: DeadItem[];
    filesSummary: FilesSummary;
    deadClasses: DeadItem[];
    deadFunctions: DeadItem[];
    deadConstants: DeadItem[];
    deadRoutes: DeadItem[];
    deadApis: DeadItem[];
    deadCss: DeadItem[];
    discoveredEntries: string[];
    durationMs: number;
}

export interface CodeAnalyzeConfig {
    entryGlobs: string[];
    excludeGlobs: string[];
    largeFileLoc: number;
    largeFunctionLoc: number;
    largeFunctionParams: number;
}

export interface DeadCodeExplorerConfig {
    entryGlobs: string[];
    ignoreGlobs: string[];
    vendorGlobs: string[];
    toolingGlobs: string[];
    ambientGlobs: string[];
    primaryBuckets: DeadBucket[];
    discoverBundlerEntries: boolean;
}
