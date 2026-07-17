import * as path from "path";
import * as vscode from "vscode";
import {
  findOrphanModules,
  findUnusedExports,
  findUnusedFiles,
  getAnalyzeConfig,
} from "../code-analyze/deadCode";
import { UnusedExportItem } from "../code-analyze/types";
import {
  buildImportIndex,
  isPathInsideFolder,
  normalizePath,
} from "../../shared/javascript/importGraph";
import { isDarkTheme } from "../../shared/html";
import {
  findDeadApis,
  findDeadCss,
  findDeadRoutes,
} from "./heuristics";
import { DeadCodeExplorerPanel } from "./panel";
import { DeadCodeReport, DeadItem } from "./types";

export type { DeadCodeReport, DeadItem } from "./types";

const CLASS_KINDS = new Set(["class"]);
const FUNCTION_KINDS = new Set(["function", "named", "default", "method"]);
const CONSTANT_KINDS = new Set(["const", "let", "var", "enum"]);

function toDeadItem(item: UnusedExportItem): DeadItem {
  return {
    relativePath: item.relativePath,
    absolutePath: item.absolutePath,
    name: item.exportName,
    detail: item.kind,
    line: item.line,
  };
}

function groupExports(unusedExports: UnusedExportItem[]): {
  deadClasses: DeadItem[];
  deadFunctions: DeadItem[];
  deadConstants: DeadItem[];
} {
  const deadClasses: DeadItem[] = [];
  const deadFunctions: DeadItem[] = [];
  const deadConstants: DeadItem[] = [];

  for (const item of unusedExports) {
    if (CLASS_KINDS.has(item.kind)) {
      deadClasses.push(toDeadItem(item));
    } else if (CONSTANT_KINDS.has(item.kind)) {
      deadConstants.push(toDeadItem(item));
    } else if (FUNCTION_KINDS.has(item.kind)) {
      deadFunctions.push(toDeadItem(item));
    }
  }

  return { deadClasses, deadFunctions, deadConstants };
}

export async function openDeadCodeExplorer(
  folderUri: vscode.Uri,
  existingPanel?: DeadCodeExplorerPanel,
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri);
  if (!workspaceFolder) {
    throw new Error("Folder is not inside a workspace");
  }

  const folderPath = normalizePath(folderUri.fsPath);
  const folderName = path.basename(folderPath);
  const config = getAnalyzeConfig();
  const isDark = isDarkTheme();
  const panel =
    existingPanel ?? DeadCodeExplorerPanel.open(folderName, isDark);
  panel.bindFolder(folderUri, () => openDeadCodeExplorer(folderUri, panel));
  if (existingPanel) {
    panel.showLoading(folderName);
  }

  const startedAt = Date.now();

  try {
    const report = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Dead Code Explorer — ${folderName}…`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Building import graph…" });
        const index = await buildImportIndex(
          workspaceFolder,
          config.entryGlobs,
          config.excludeGlobs,
        );

        const scopedFiles = index.files.filter((file) =>
          isPathInsideFolder(file, folderPath),
        );

        progress.report({ message: "Finding unused files & exports…" });
        const unusedFiles = findUnusedFiles(scopedFiles, index);
        const orphanModules = findOrphanModules(scopedFiles, index);
        const unusedExports = findUnusedExports(scopedFiles, index);
        const { deadClasses, deadFunctions, deadConstants } =
          groupExports(unusedExports);

        const deadFiles: DeadItem[] = [
          ...unusedFiles.map((item) => ({
            relativePath: item.relativePath,
            absolutePath: item.absolutePath,
            detail: item.detail ?? "No imports found in workspace",
          })),
          ...orphanModules.map((item) => ({
            relativePath: item.relativePath,
            absolutePath: item.absolutePath,
            detail: item.detail ?? "Not reachable from entry points",
          })),
        ];

        // Dedupe by path, keep first detail
        const seenFiles = new Set<string>();
        const dedupedFiles = deadFiles.filter((item) => {
          if (seenFiles.has(item.absolutePath)) {
            return false;
          }
          seenFiles.add(item.absolutePath);
          return true;
        });

        progress.report({ message: "Scanning routes, APIs, CSS…" });
        const [deadRoutes, deadApis, deadCss] = await Promise.all([
          findDeadRoutes(folderPath, index),
          findDeadApis(folderPath, index),
          findDeadCss(folderUri, folderPath, index),
        ]);

        return {
          folderName,
          folderPath,
          scannedFiles: scopedFiles.length,
          deadFiles: dedupedFiles.sort((a, b) =>
            a.relativePath.localeCompare(b.relativePath),
          ),
          deadClasses,
          deadFunctions,
          deadConstants,
          deadRoutes,
          deadApis,
          deadCss,
          durationMs: Date.now() - startedAt,
        } satisfies DeadCodeReport;
      },
    );

    panel.showReport(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dead Code Explorer failed";
    vscode.window.showErrorMessage(message);
    panel.dispose();
  }
}
