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

export interface DuplicateLocation {
  relativePath: string;
  absolutePath: string;
  startLine: number;
  endLine: number;
}

export interface DuplicateGroup {
  kind: "exact" | "structural";
  lineCount: number;
  locations: DuplicateLocation[];
  suggestion: string;
  preview: string;
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
  duplicates: DuplicateGroup[];
  largeFiles: LargeFileItem[];
  largeFunctions: LargeFunctionItem[];
  entryPoints: EntryPointItem[];
  durationMs: number;
}

export interface CodeAnalyzeConfig {
  entryGlobs: string[];
  excludeGlobs: string[];
  duplicateMinLines: number;
  largeFileLoc: number;
  largeFunctionLoc: number;
  largeFunctionParams: number;
}
