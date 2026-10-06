import * as path from 'path';
import * as vscode from 'vscode';
import { formatFilesForAi } from '../../shared/aiFormat';
import { normalizePath, toRelativePath } from '../../shared/fs';
import { isDarkTheme } from '../../shared/html';
import { getCachedImportIndex } from '../../shared/importIndexCache';
import { ImportIndex } from '../../shared/javascript/importGraph';
import { openFileInEditor } from '../../shared/openInEditor';
import { getCodeGraphHtml, getCodeGraphLoadingHtml } from './panel';
import { CodeGraphData, GraphEdge, GraphExpansion, GraphNode } from './types';

export type { CodeGraphData, GraphExpansion } from './types';

const buildCodeGraph = async (
    fileUri: vscode.Uri,
    onProgress?: (message: string) => void,
): Promise<CodeGraphData> => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
        throw new Error('File is not inside a workspace folder');
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const normalizedTarget = normalizePath(fileUri.fsPath);

    onProgress?.('Analyzing imports…');

    const index = await getOrBuildIndex(workspaceFolder);
    const dependencies = collectDependencies(normalizedTarget, workspaceRoot, index);

    onProgress?.('Finding dependents…');

    const dependents = findDependents(normalizedTarget, workspaceRoot, index);

    return toGraphData(normalizedTarget, workspaceRoot, dependencies, dependents);
};

const expandGraphNode = async (fileUri: vscode.Uri, nodePath: string): Promise<GraphExpansion> => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
        throw new Error('File is not inside a workspace folder');
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const normalizedCenter = normalizePath(nodePath);

    if (!isInSrcFolder(normalizedCenter, workspaceRoot)) {
        return { centerPath: normalizedCenter, nodes: [], edges: [] };
    }

    const index = await getOrBuildIndex(workspaceFolder);
    const dependencies = collectDependencies(normalizedCenter, workspaceRoot, index);
    const dependents = findDependents(normalizedCenter, workspaceRoot, index);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const [depPath, rel] of dependencies) {
        nodes.push({ id: depPath, label: rel, group: 'dependency' });
        edges.push({ from: normalizedCenter, to: depPath });
    }

    for (const [depPath, rel] of dependents) {
        if (depPath === normalizedCenter) {
            continue;
        }
        nodes.push({ id: depPath, label: rel, group: 'dependent' });
        edges.push({ from: depPath, to: normalizedCenter });
    }

    return { centerPath: normalizedCenter, nodes, edges };
};

const getOrBuildIndex = async (workspaceFolder: vscode.WorkspaceFolder): Promise<ImportIndex> => {
    const cached = getCachedImportIndex(workspaceFolder.uri.fsPath);
    if (cached) {
        return cached;
    }
    const { buildImportIndex } = await import('../../shared/javascript/importGraph.js');
    const { getAnalyzeConfig, getDeadCodeExplorerConfig } =
        await import('../code-analyze/deadCode.js');
    const config = getAnalyzeConfig();
    const explorerConfig = getDeadCodeExplorerConfig();
    const entryGlobs = [...config.entryGlobs, ...explorerConfig.entryGlobs];
    return buildImportIndex(workspaceFolder, entryGlobs, config.excludeGlobs);
};

const collectDependencies = (
    filePath: string,
    workspaceRoot: string,
    index: ImportIndex,
): Map<string, string> => {
    const normalizedTarget = normalizePath(filePath);
    const dependencies = new Map<string, string>();

    for (const imp of index.getImports(filePath)) {
        if (!imp.resolvedPath) {
            continue;
        }
        if (
            imp.resolvedPath !== normalizedTarget &&
            isInSrcFolder(imp.resolvedPath, workspaceRoot)
        ) {
            dependencies.set(imp.resolvedPath, toRelativePath(imp.resolvedPath, workspaceRoot));
        }
    }

    return dependencies;
};

const findDependents = (
    normalizedTarget: string,
    workspaceRoot: string,
    index: ImportIndex,
): Map<string, string> => {
    const dependents = new Map<string, string>();

    for (const importerPath of index.getImporters(normalizedTarget)) {
        const importerNorm = normalizePath(importerPath);
        if (importerNorm !== normalizedTarget && isInSrcFolder(importerNorm, workspaceRoot)) {
            dependents.set(importerNorm, toRelativePath(importerNorm, workspaceRoot));
        }
    }

    return dependents;
};

const isInSrcFolder = (absolutePath: string, workspaceRoot: string): boolean => {
    const relative = toRelativePath(normalizePath(absolutePath), workspaceRoot).replace(/\\/g, '/');
    return relative === 'src' || relative.startsWith('src/');
};

const toGraphData = (
    targetPath: string,
    workspaceRoot: string,
    dependencies: Map<string, string>,
    dependents: Map<string, string>,
): CodeGraphData => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    const addNode = (id: string, label: string, group: GraphNode['group']) => {
        if (nodeIds.has(id)) {
            return;
        }
        nodeIds.add(id);
        nodes.push({ id, label, group });
    };

    const targetLabel = toRelativePath(targetPath, workspaceRoot);
    addNode(targetPath, targetLabel, 'current');

    for (const [depPath, rel] of dependencies) {
        addNode(depPath, rel, 'dependency');
        edges.push({ from: targetPath, to: depPath });
    }

    for (const [depPath, rel] of dependents) {
        addNode(depPath, rel, 'dependent');
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
};

export const openCodeGraph = async (fileUri: vscode.Uri): Promise<void> => {
    const fileName = path.basename(fileUri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    const relativePath = workspaceFolder
        ? toRelativePath(fileUri.fsPath, workspaceFolder.uri.fsPath)
        : fileName;

    const panel = vscode.window.createWebviewPanel(
        'kyoToolsCodeGraph',
        `Code Graph — ${fileName}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
    );

    const showLoading = (status?: string) => {
        panel.webview.html = getCodeGraphLoadingHtml(relativePath, isDarkTheme(), status);
    };

    showLoading();

    const render = async () => {
        showLoading();

        try {
            const data = await buildCodeGraph(fileUri, (message) => {
                panel.webview.postMessage({ type: 'loadingStatus', message });
            });

            panel.webview.html = getCodeGraphHtml(data, isDarkTheme());
        } catch (error) {
            const errMessage =
                error instanceof Error ? error.message : 'Failed to build code graph';
            vscode.window.showErrorMessage(errMessage);
            showLoading(errMessage);
        }
    };

    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'copy' && typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
            return;
        }

        if (message.type === 'copyContent' && Array.isArray(message.paths)) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
            if (!workspaceFolder) {
                return;
            }

            const paths = (message.paths as unknown[]).filter(
                (value): value is string => typeof value === 'string',
            );
            const { text } = await formatFilesForAi(paths, workspaceFolder.uri.fsPath);

            if (!text) {
                void vscode.window.showWarningMessage('Could not read selected files for copy');
                return;
            }

            await vscode.env.clipboard.writeText(text);
            void vscode.window.showInformationMessage(
                `Copied content of ${paths.length} file(s) for AI`,
            );
            return;
        }

        if (message.type === 'expand' && typeof message.path === 'string') {
            try {
                const expansion = await expandGraphNode(fileUri, message.path);
                panel.webview.postMessage({ type: 'expandResult', ...expansion });
            } catch (error) {
                const errMessage = error instanceof Error ? error.message : 'Failed to expand node';
                panel.webview.postMessage({
                    type: 'expandError',
                    path: message.path,
                    message: errMessage,
                });
            }
            return;
        }

        if (message.type === 'open' && typeof message.path === 'string') {
            await openFileInEditor(message.path);
            return;
        }

        if (message.type === 'reload') {
            try {
                await render();
            } catch (error) {
                const errMessage =
                    error instanceof Error ? error.message : 'Failed to reload code graph';
                vscode.window.showErrorMessage(errMessage);
            }
        }
    });

    await render();
};
