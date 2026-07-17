export interface DeadItem {
  relativePath: string;
  absolutePath: string;
  name?: string;
  detail?: string;
  line?: number;
}

export interface DeadCodeReport {
  folderName: string;
  folderPath: string;
  scannedFiles: number;
  deadFiles: DeadItem[];
  deadClasses: DeadItem[];
  deadFunctions: DeadItem[];
  deadConstants: DeadItem[];
  deadRoutes: DeadItem[];
  deadApis: DeadItem[];
  deadCss: DeadItem[];
  durationMs: number;
}
