import * as path from "path";
import * as vscode from "vscode";
import { EXCLUDE_GLOB, SOURCE_GLOB } from "../../shared/constants";
import {
  loadTsConfigForFile,
  normalizePath,
  parseImports,
  resolveImport,
  toRelativePath,
} from "../../shared/importGraph";
import { isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import { getCodeGraphHtml, getCodeGraphLoadingHtml } from "./panel";
import { CodeGraphData, GraphEdge, GraphExpansion, GraphNode } from "./types";

export type { CodeGraphData, GraphExpansion } from "./types";

export async function buildCodeGraph(
  fileUri: vscode.Uri,
  onProgress?: (message: string) => void,
): Promise<CodeGraphData> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    throw new Error("File is not inside a workspace folder");
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const normalizedTarget = normalizePath(fileUri.fsPath);
  const tsConfig = loadTsConfigForFile(fileUri.fsPath, workspaceRoot);

  onProgress?.("Analyzing imports…");

  const dependencies = await collectDependencies(
    normalizedTarget,
    workspaceRoot,
    tsConfig,
  );

  onProgress?.("Finding dependents…");

  const dependents = await findDependents(
    fileUri,
    normalizedTarget,
    workspaceRoot,
    tsConfig,
  );

  return toGraphData(
    normalizedTarget,
    workspaceRoot,
    dependencies,
    dependents,
  );
}

export async function expandGraphNode(
  fileUri: vscode.Uri,
  nodePath: string,
): Promise<GraphExpansion> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    throw new Error("File is not inside a workspace folder");
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const normalizedCenter = normalizePath(nodePath);

  if (!isInSrcFolder(normalizedCenter, workspaceRoot)) {
    return { centerPath: normalizedCenter, nodes: [], edges: [] };
  }

  const centerUri = vscode.Uri.file(normalizedCenter);
  const tsConfig = loadTsConfigForFile(normalizedCenter, workspaceRoot);
  const dependencies = await collectDependencies(
    normalizedCenter,
    workspaceRoot,
    tsConfig,
  );
  const dependents = await findDependents(
    centerUri,
    normalizedCenter,
    workspaceRoot,
    tsConfig,
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const [depPath, rel] of dependencies) {
    nodes.push({ id: depPath, label: rel, group: "dependency" });
    edges.push({ from: normalizedCenter, to: depPath });
  }

  for (const [depPath, rel] of dependents) {
    if (depPath === normalizedCenter) {
      continue;
    }
    nodes.push({ id: depPath, label: rel, group: "dependent" });
    edges.push({ from: depPath, to: normalizedCenter });
  }

  return { centerPath: normalizedCenter, nodes, edges };
}

async function collectDependencies(
  filePath: string,
  workspaceRoot: string,
  tsConfig: ReturnType<typeof loadTsConfigForFile>,
): Promise<Map<string, string>> {
  const normalizedTarget = normalizePath(filePath);
  const dependencies = new Map<string, string>();
  const targetImports = parseImports(
    await readText(vscode.Uri.file(filePath)),
    filePath,
  );

  for (const specifier of targetImports) {
    const resolved = resolveImport(
      filePath,
      specifier,
      workspaceRoot,
      tsConfig,
    );
    if (resolved?.type !== "internal") {
      continue;
    }
    if (
      resolved.fsPath !== normalizedTarget &&
      isInSrcFolder(resolved.fsPath, workspaceRoot)
    ) {
      dependencies.set(
        resolved.fsPath,
        toRelativePath(resolved.fsPath, workspaceRoot),
      );
    }
  }

  return dependencies;
}

async function findDependents(
  fileUri: vscode.Uri,
  normalizedTarget: string,
  workspaceRoot: string,
  tsConfig: ReturnType<typeof loadTsConfigForFile>,
): Promise<Map<string, string>> {
  const dependents = new Map<string, string>();

  const refDependents = await findDependentsViaReferences(
    fileUri,
    normalizedTarget,
    workspaceRoot,
  );
  for (const [filePath, rel] of refDependents) {
    if (isInSrcFolder(filePath, workspaceRoot)) {
      dependents.set(filePath, rel);
    }
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!workspaceFolder) {
    return dependents;
  }

  const allFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, SOURCE_GLOB),
    EXCLUDE_GLOB,
  );

  for (const candidate of allFiles) {
    const candidatePath = normalizePath(candidate.fsPath);
    if (candidatePath === normalizedTarget || dependents.has(candidatePath)) {
      continue;
    }

    const imports = parseImports(await readText(candidate), candidate.fsPath);
    for (const specifier of imports) {
      const resolved = resolveImport(
        candidate.fsPath,
        specifier,
        workspaceRoot,
        tsConfig,
      );
      if (
        resolved?.type === "internal" &&
        resolved.fsPath === normalizedTarget &&
        isInSrcFolder(candidatePath, workspaceRoot)
      ) {
        dependents.set(
          candidatePath,
          toRelativePath(candidatePath, workspaceRoot),
        );
        break;
      }
    }
  }

  return dependents;
}

async function findDependentsViaReferences(
  fileUri: vscode.Uri,
  normalizedTarget: string,
  workspaceRoot: string,
): Promise<Map<string, string>> {
  const dependents = new Map<string, string>();
  const document = await vscode.workspace.openTextDocument(fileUri);
  const anchorPositions = await getReferenceAnchorPositions(document);

  for (const position of anchorPositions) {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      fileUri,
      position,
    );

    if (!references?.length) {
      continue;
    }

    for (const reference of references) {
      if (reference.uri.scheme !== "file") {
        continue;
      }

      const refPath = normalizePath(reference.uri.fsPath);
      if (refPath === normalizedTarget) {
        continue;
      }

      if (!refPath.startsWith(normalizePath(workspaceRoot))) {
        continue;
      }

      if (!isInSrcFolder(refPath, workspaceRoot)) {
        continue;
      }

      dependents.set(refPath, toRelativePath(refPath, workspaceRoot));
    }
  }

  return dependents;
}

async function getReferenceAnchorPositions(
  document: vscode.TextDocument,
): Promise<vscode.Position[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[]
  >("vscode.executeDocumentSymbolProvider", document.uri);

  const positions: vscode.Position[] = [];

  if (symbols?.length) {
    collectSymbolPositions(symbols, positions);
  }

  if (!positions.length) {
    positions.push(...findExportPositions(document.getText(), document));
  }

  return positions;
}

function collectSymbolPositions(
  symbols: vscode.DocumentSymbol[],
  positions: vscode.Position[],
): void {
  for (const symbol of symbols) {
    if (isExportLikeSymbol(symbol.kind) && positions.length < 8) {
      positions.push(symbol.selectionRange.start);
    }

    if (symbol.children.length > 0) {
      collectSymbolPositions(symbol.children, positions);
    }
  }
}

function findExportPositions(
  content: string,
  document: vscode.TextDocument,
): vscode.Position[] {
  const positions: vscode.Position[] = [];
  const patterns = [
    /export\s+default\s+(?:async\s+)?function\s+\w+/g,
    /export\s+(?:async\s+)?function\s+\w+/g,
    /export\s+(?:default\s+)?(?:const|let|var|class)\s+\w+/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      positions.push(document.positionAt(match.index));
      if (positions.length >= 8) {
        return positions;
      }
    }
  }

  return positions.length ? positions : [document.positionAt(0)];
}

function isExportLikeSymbol(kind: vscode.SymbolKind): boolean {
  return (
    kind === vscode.SymbolKind.Function ||
    kind === vscode.SymbolKind.Class ||
    kind === vscode.SymbolKind.Variable ||
    kind === vscode.SymbolKind.Constant ||
    kind === vscode.SymbolKind.Interface ||
    kind === vscode.SymbolKind.Enum ||
    kind === vscode.SymbolKind.Module ||
    kind === vscode.SymbolKind.Method
  );
}

function isInSrcFolder(absolutePath: string, workspaceRoot: string): boolean {
  const relative = toRelativePath(
    normalizePath(absolutePath),
    workspaceRoot,
  ).replace(/\\/g, "/");
  return relative === "src" || relative.startsWith("src/");
}

function toGraphData(
  targetPath: string,
  workspaceRoot: string,
  dependencies: Map<string, string>,
  dependents: Map<string, string>,
): CodeGraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, label: string, group: GraphNode["group"]) => {
    if (nodeIds.has(id)) {
      return;
    }
    nodeIds.add(id);
    nodes.push({ id, label, group });
  };

  const targetLabel = toRelativePath(targetPath, workspaceRoot);
  addNode(targetPath, targetLabel, "current");

  for (const [depPath, rel] of dependencies) {
    addNode(depPath, rel, "dependency");
    edges.push({ from: targetPath, to: depPath });
  }

  for (const [depPath, rel] of dependents) {
    addNode(depPath, rel, "dependent");
    edges.push({ from: depPath, to: targetPath });
  }

  return {
    fileName: path.basename(targetPath),
    relativePath: targetLabel,
    rootPath: targetPath,
    nodes,
    edges,
    stats: {
      dependencies: dependencies.size,
      dependents: dependents.size,
    },
  };
}

async function readText(uri: vscode.Uri): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return doc.getText();
}

function languageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".vue": "vue",
    ".sql": "sql",
    ".sh": "bash",
  };
  return byExt[ext] ?? "";
}

async function formatFilesForAi(
  filePaths: string[],
  workspaceRoot: string,
): Promise<string> {
  const blocks: string[] = [];

  for (const filePath of filePaths) {
    try {
      const content = await readText(vscode.Uri.file(filePath));
      const rel = toRelativePath(normalizePath(filePath), workspaceRoot);
      const lang = languageFromPath(filePath);
      const fence = lang ? `\`\`\`${lang}:${rel}` : `\`\`\`${rel}`;
      blocks.push(`${fence}\n${content}\n\`\`\``);
    } catch {
      // Skip unreadable files.
    }
  }

  return blocks.join("\n\n");
}

export async function openCodeGraph(fileUri: vscode.Uri): Promise<void> {
  const fileName = path.basename(fileUri.fsPath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
  const relativePath = workspaceFolder
    ? toRelativePath(fileUri.fsPath, workspaceFolder.uri.fsPath)
    : fileName;

  const panel = vscode.window.createWebviewPanel(
    "kyoToolsCodeGraph",
    `Code Graph — ${fileName}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const showLoading = (status?: string) => {
    panel.webview.html = getCodeGraphLoadingHtml(
      relativePath,
      isDarkTheme(),
      status,
    );
  };

  showLoading();

  const render = async () => {
    showLoading();

    try {
      const data = await buildCodeGraph(fileUri, (message) => {
        panel.webview.postMessage({ type: "loadingStatus", message });
      });

      panel.webview.html = getCodeGraphHtml(data, isDarkTheme());
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : "Failed to build code graph";
      vscode.window.showErrorMessage(errMessage);
      showLoading(errMessage);
    }
  };

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "copy" && typeof message.text === "string") {
      await vscode.env.clipboard.writeText(message.text);
      return;
    }

    if (message.type === "copyContent" && Array.isArray(message.paths)) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (!workspaceFolder) {
        return;
      }

      const paths = (message.paths as unknown[]).filter(
        (value): value is string => typeof value === "string",
      );
      const text = await formatFilesForAi(
        paths,
        workspaceFolder.uri.fsPath,
      );

      if (!text) {
        void vscode.window.showWarningMessage(
          "Could not read selected files for copy",
        );
        return;
      }

      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(
        `Copied content of ${paths.length} file(s) for AI`,
      );
      return;
    }

    if (message.type === "expand" && typeof message.path === "string") {
      try {
        const expansion = await expandGraphNode(fileUri, message.path);
        panel.webview.postMessage({ type: "expandResult", ...expansion });
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : "Failed to expand node";
        panel.webview.postMessage({
          type: "expandError",
          path: message.path,
          message: errMessage,
        });
      }
      return;
    }

    if (message.type === "open" && typeof message.path === "string") {
      await openFileInEditor(message.path);
      return;
    }

    if (message.type === "reload") {
      try {
        await render();
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : "Failed to reload code graph";
        vscode.window.showErrorMessage(errMessage);
      }
    }
  });

  await render();
}
