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
import { getCodeGraphHtml } from "./panel";
import { CodeGraphData, GraphEdge, GraphNode } from "./types";

export type { CodeGraphData } from "./types";

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

  const dependencies = new Map<string, string>();
  const externalDeps = new Set<string>();
  const targetImports = parseImports(
    await readText(fileUri),
    fileUri.fsPath,
  );

  for (const specifier of targetImports) {
    const resolved = resolveImport(
      fileUri.fsPath,
      specifier,
      workspaceRoot,
      tsConfig,
    );
    if (!resolved) {
      continue;
    }
    if (resolved.type === "external") {
      externalDeps.add(resolved.name);
      continue;
    }
    if (resolved.fsPath !== normalizedTarget) {
      dependencies.set(
        resolved.fsPath,
        toRelativePath(resolved.fsPath, workspaceRoot),
      );
    }
  }

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
    externalDeps,
  );
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
    dependents.set(filePath, rel);
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
        resolved.fsPath === normalizedTarget
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

function toGraphData(
  targetPath: string,
  workspaceRoot: string,
  dependencies: Map<string, string>,
  dependents: Map<string, string>,
  externalDeps: Set<string>,
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

  for (const pkg of externalDeps) {
    const id = `ext:${pkg}`;
    addNode(id, pkg, "external");
    edges.push({ from: targetPath, to: id });
  }

  return {
    fileName: path.basename(targetPath),
    relativePath: targetLabel,
    nodes,
    edges,
    stats: {
      dependencies: dependencies.size,
      dependents: dependents.size,
      external: externalDeps.size,
    },
  };
}

async function readText(uri: vscode.Uri): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return doc.getText();
}

export async function openCodeGraph(fileUri: vscode.Uri): Promise<void> {
  const fileName = path.basename(fileUri.fsPath);

  const panel = vscode.window.createWebviewPanel(
    "kyoToolsCodeGraph",
    `Code Graph — ${fileName}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  const render = async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Building code graph for ${fileName}…`,
        cancellable: false,
      },
      async (progress) => {
        const data = await buildCodeGraph(fileUri, (message) => {
          progress.report({ message });
        });

        panel.webview.html = getCodeGraphHtml(data, isDarkTheme());
      },
    );
  };

  panel.webview.onDidReceiveMessage(async (message) => {
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
