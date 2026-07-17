import * as vscode from "vscode";
import { DeadBucket, PRIMARY_BUCKETS } from "./types";

export interface DeadCodeExplorerConfig {
  /** Extra entry globs merged with codeAnalyze.entryGlobs. */
  entryGlobs: string[];
  /** Path globs excluded from primary dead consideration (classified out). */
  ignoreGlobs: string[];
  /** Vendor path globs → bucket vendor. */
  vendorGlobs: string[];
  /** Tooling path globs → bucket tooling. */
  toolingGlobs: string[];
  /** Ambient path globs → bucket ambient. */
  ambientGlobs: string[];
  /** Buckets shown in primary Files list. */
  primaryBuckets: DeadBucket[];
  /** Scan webpack/vite config files for entry + copy patterns. */
  discoverBundlerEntries: boolean;
}

const DEFAULT_ENTRY_GLOBS = [
  "**/mobile.{js,jsx,ts,tsx}",
  "**/App/mobile.{tsx,jsx,ts,js}",
  "**/index.{js,jsx,ts,tsx}",
  "**/main.{js,jsx,ts,tsx}",
];

const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/*.min.js",
  "**/*.{test,spec}.{js,jsx,ts,tsx}",
  "**/*.stories.{js,jsx,ts,tsx}",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/.eslintrc*",
  "**/prettier*",
  "**/generate-react-cli/**",
  "**/*TemplateName*",
];

const DEFAULT_VENDOR_GLOBS = [
  "public/**/tinymce*/**",
  "public/assets/**",
  "**/vendor/**",
];

const DEFAULT_TOOLING_GLOBS = [
  "tools/**",
  "scripts/**",
  "**/webpack*.{js,ts,cjs,mjs}",
  "**/vite.config.*",
  "**/jest.config.*",
  "**/babel.config.*",
  "**/*.config.{js,cjs,mjs,ts}",
];

const DEFAULT_AMBIENT_GLOBS = ["**/*.d.ts", "**/react-app-env.d.ts"];

export function getDeadCodeExplorerConfig(): DeadCodeExplorerConfig {
  const config = vscode.workspace.getConfiguration(
    "kyo-tools.deadCodeExplorer",
  );

  const readArray = (key: string, fallback: string[]): string[] =>
    config.get<string[]>(key, fallback);

  const primary = config.get<DeadBucket[]>("primaryBuckets", [
    ...PRIMARY_BUCKETS,
  ]);

  return {
    entryGlobs: readArray("entryGlobs", DEFAULT_ENTRY_GLOBS),
    ignoreGlobs: readArray("ignoreGlobs", DEFAULT_IGNORE_GLOBS),
    vendorGlobs: readArray("vendorGlobs", DEFAULT_VENDOR_GLOBS),
    toolingGlobs: readArray("toolingGlobs", DEFAULT_TOOLING_GLOBS),
    ambientGlobs: readArray("ambientGlobs", DEFAULT_AMBIENT_GLOBS),
    primaryBuckets: primary.length > 0 ? primary : [...PRIMARY_BUCKETS],
    discoverBundlerEntries: config.get<boolean>("discoverBundlerEntries", true),
  };
}
