import * as path from "path";
import * as vscode from "vscode";
import {
  ImportIndex,
  buildImportIndex,
  findReachableFiles,
  isPathInsideFolder,
  normalizePath,
} from "../../shared/importGraph";
import { isActiveBarrel, isReexportOnlyBarrel } from "../../shared/barrelFiles";
import { isDarkTheme } from "../../shared/html";
import { DeadCodePanel } from "./panel";
import {
  DeadCodeItem,
  DeadCodeReport,
  UnusedExportItem,
} from "./types";

export type { DeadCodeItem, DeadCodeReport, UnusedExportItem } from "./types";

const DEFAULT_ENTRY_GLOBS = [
  "**/main.{ts,tsx,js,jsx}",
  "**/index.{ts,tsx,js,jsx}",
  "**/App.{tsx,jsx}",
  "**/*.config.{ts,js,mjs,cjs}",
  "**/vite.config.*",
  "**/next.config.*",
  "**/pages/_app.{tsx,jsx}",
  "**/app/layout.{tsx,jsx}",
];

const DEFAULT_EXCLUDE_GLOBS = [
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/__tests__/**",
  "**/__mocks__/**",
];

export async function scanDeadCodeInFolder(
  folderUri: vscode.Uri,
  existingPanel?: DeadCodePanel,
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri);
  if (!workspaceFolder) {
    throw new Error("Folder is not inside a workspace");
  }

  const folderPath = normalizePath(folderUri.fsPath);
  const folderName = path.basename(folderPath);
  const config = vscode.workspace.getConfiguration("kyo-tools.deadCode");
  const entryGlobs = config.get<string[]>("entryGlobs", DEFAULT_ENTRY_GLOBS);
  const excludeGlobs = config.get<string[]>("excludeGlobs", DEFAULT_EXCLUDE_GLOBS);

  const isDark = isDarkTheme();
  const panel = existingPanel ?? DeadCodePanel.open(folderName, isDark);
  panel.bindFolder(folderUri, () => scanDeadCodeInFolder(folderUri, panel));
  if (existingPanel) {
    panel.showLoading(folderName);
  }
  const startedAt = Date.now();

  try {
    const report = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Scanning dead code in ${folderName}…`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Building import graph…" });
        const index = await buildImportIndex(
          workspaceFolder,
          entryGlobs,
          excludeGlobs,
        );

        progress.report({ message: "Finding unused files…" });
        const scopedFiles = index.files.filter((file) =>
          isPathInsideFolder(file, folderPath),
        );

        const unusedFiles = findUnusedFiles(scopedFiles, index);
        progress.report({ message: "Finding orphan modules…" });
        const orphanModules = findOrphanModules(scopedFiles, index);
        progress.report({ message: "Finding unused exports…" });
        const unusedExports = findUnusedExports(scopedFiles, index);

        return {
          folderName,
          folderPath,
          scannedFiles: scopedFiles.length,
          unusedFiles,
          orphanModules,
          unusedExports,
          entryPoints: [...index.entryPoints]
            .filter((entry) => isPathInsideFolder(entry, folderPath))
            .map((entry) => index.relativePath(entry)),
          durationMs: Date.now() - startedAt,
        };
      },
    );

    panel.showReport(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dead code scan failed";
    vscode.window.showErrorMessage(message);
    panel.dispose();
  }
}

function findUnusedFiles(
  scopedFiles: string[],
  index: ImportIndex,
): DeadCodeItem[] {
  const items: DeadCodeItem[] = [];

  for (const filePath of scopedFiles) {
    if (index.entryPoints.has(filePath)) {
      continue;
    }

    if (isActiveBarrel(filePath, index)) {
      continue;
    }

    const importers = index.getImporters(filePath);
    if (importers.length === 0) {
      items.push({
        relativePath: index.relativePath(filePath),
        absolutePath: filePath,
        detail: "No imports found in workspace",
      });
    }
  }

  return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findOrphanModules(
  scopedFiles: string[],
  index: ImportIndex,
): DeadCodeItem[] {
  const reachable = findReachableFiles(index, index.entryPoints);
  const items: DeadCodeItem[] = [];

  for (const filePath of scopedFiles) {
    if (index.entryPoints.has(filePath) || reachable.has(filePath)) {
      continue;
    }

    if (isActiveBarrel(filePath, index, reachable)) {
      continue;
    }

    items.push({
      relativePath: index.relativePath(filePath),
      absolutePath: filePath,
      detail: "Not reachable from configured entry points",
    });
  }

  return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findUnusedExports(
  scopedFiles: string[],
  index: ImportIndex,
): UnusedExportItem[] {
  const items: UnusedExportItem[] = [];

  for (const filePath of scopedFiles) {
    const content = index.getContent(filePath);
    if (isReexportOnlyBarrel(content, filePath)) {
      continue;
    }

    const exports = extractExports(content, filePath);
    if (exports.length === 0) {
      continue;
    }

    const usage = collectExportUsage(index, filePath);

    for (const exp of exports) {
      if (exp.isTypeOnly) {
        continue;
      }

      if (usage.namespaceImports) {
        continue;
      }

      if (exp.isDefault) {
        if (!usage.defaultImport) {
          items.push(toExportItem(index, filePath, exp));
        }
        continue;
      }

      if (!usage.named.has(exp.name)) {
        items.push(toExportItem(index, filePath, exp));
      }
    }
  }

  return items.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath) ||
    a.exportName.localeCompare(b.exportName),
  );
}

function toExportItem(
  index: ImportIndex,
  filePath: string,
  exp: ExtractedExport,
): UnusedExportItem {
  return {
    relativePath: index.relativePath(filePath),
    absolutePath: filePath,
    exportName: exp.isDefault ? "default" : exp.name,
    kind: exp.kind,
  };
}

interface ExtractedExport {
  name: string;
  kind: string;
  isDefault: boolean;
  isTypeOnly: boolean;
}

function extractExports(content: string, filePath: string): ExtractedExport[] {
  const source = filePath.endsWith(".vue")
    ? content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)?.join("\n") ?? content
    : content;

  const exports: ExtractedExport[] = [];
  const seen = new Set<string>();

  const add = (item: ExtractedExport) => {
    const key = `${item.isDefault ? "default" : item.name}:${item.kind}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    exports.push(item);
  };

  const directPatterns: Array<[RegExp, string]> = [
    [/export\s+async\s+function\s+(\w+)/g, "function"],
    [/export\s+function\s+(\w+)/g, "function"],
    [/export\s+class\s+(\w+)/g, "class"],
    [/export\s+enum\s+(\w+)/g, "enum"],
    [/export\s+const\s+(\w+)/g, "const"],
    [/export\s+let\s+(\w+)/g, "let"],
    [/export\s+var\s+(\w+)/g, "var"],
  ];

  for (const [regex, kind] of directPatterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      add({ name: match[1], kind, isDefault: false, isTypeOnly: false });
    }
  }

  const typePatterns: Array<[RegExp, string]> = [
    [/export\s+type\s+(\w+)/g, "type"],
    [/export\s+interface\s+(\w+)/g, "interface"],
  ];
  for (const [regex, kind] of typePatterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      add({ name: match[1], kind, isDefault: false, isTypeOnly: true });
    }
  }

  if (/export\s+default/.test(source)) {
    add({ name: "default", kind: "default", isDefault: true, isTypeOnly: false });
  }

  const exportListRe = /export\s+\{([^}]+)\}/g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = exportListRe.exec(source)) !== null) {
    if (/from\s+['"]/.test(listMatch[0])) {
      continue;
    }
    for (const part of listMatch[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const alias = trimmed.split(/\s+as\s+/);
      add({
        name: (alias[1] ?? alias[0]).trim(),
        kind: "named",
        isDefault: false,
        isTypeOnly: false,
      });
    }
  }

  return exports;
}

function collectExportUsage(index: ImportIndex, modulePath: string): {
  named: Set<string>;
  defaultImport: boolean;
  namespaceImports: boolean;
} {
  const named = new Set<string>();
  let defaultImport = false;
  let namespaceImports = false;

  for (const filePath of index.files) {
    for (const imp of index.getImports(filePath)) {
      if (imp.resolvedPath !== modulePath) {
        continue;
      }
      if (imp.namespace) {
        namespaceImports = true;
      }
      if (imp.defaultImport) {
        defaultImport = true;
      }
      for (const name of imp.named) {
        named.add(name);
      }
    }

    const content = index.getContent(filePath);
    const reexportRe =
      /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = reexportRe.exec(content)) !== null) {
      const resolved = index.resolve(filePath, match[2]);
      if (resolved !== modulePath) {
        continue;
      }
      for (const part of match[1].split(",")) {
        const trimmed = part.trim();
        if (!trimmed) {
          continue;
        }
        const alias = trimmed.split(/\s+as\s+/);
        named.add((alias[0] ?? alias[1]).trim());
      }
    }
  }

  return { named, defaultImport, namespaceImports };
}
