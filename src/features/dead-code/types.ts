export interface DeadCodeItem {
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

export interface DeadCodeReport {
  folderName: string;
  folderPath: string;
  scannedFiles: number;
  unusedFiles: DeadCodeItem[];
  orphanModules: DeadCodeItem[];
  unusedExports: UnusedExportItem[];
  entryPoints: EntryPointItem[];
  durationMs: number;
}
