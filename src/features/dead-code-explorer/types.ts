export type DeadBucket =
    'dead' | 'likely-dead' | 'runtime' | 'entry' | 'tooling' | 'ambient' | 'vendor' | 'unknown';

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

export interface DeadCodeReport {
    folderName: string;
    folderPath: string;
    scannedFiles: number;
    /** Primary Files tab (dead + likely-dead by default). */
    deadFiles: DeadItem[];
    /** All classified file findings including noise buckets. */
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
