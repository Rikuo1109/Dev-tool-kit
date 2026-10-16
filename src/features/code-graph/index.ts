import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { formatFilesForAi } from '../../shared/aiFormat';
import { ANALYZE_SOURCE_GLOB } from '../../shared/constants';
import { normalizePath, toRelativePath } from '../../shared/fs';
import { isDarkTheme } from '../../shared/html';
import { ImportIndex } from '../../shared/javascript/importGraph';
import { openFileInEditor } from '../../shared/openInEditor';
import { ClusterModel } from './clusterGraph';
import { getClusterGraphHtml } from './clusterPanel';
import {
    createFilteredIndex,
    DEFAULT_GRAPH_FILTER,
    evaluateGraphFilter,
    GraphFilterOptions,
    sanitizeGraphFilter,
} from './graphFilter';
import { groupDirOf, GroupMode } from './groupTree';
import { GraphInsights } from './insights';
import { getCodeGraphHtml, getCodeGraphLoadingHtml } from './panel';
import {
    ClusterLevel,
    CodeGraphData,
    FileUsage,
    GraphEdge,
    GraphExpansion,
    GraphNode,
    LevelInsights,
} from './types';

export type { CodeGraphData, GraphExpansion } from './types';

/** Ask before copying more than this many characters (~250k tokens). */
const LARGE_COPY_CHARS = 1_000_000;
const STALE_DEBOUNCE_MS = 500;
/** Workspace-state key holding the user's graph filter (text + toggles). */
const FILTER_STATE_KEY = 'kyo-tools.codeGraph.filter';

const indexFileSets = new WeakMap<ImportIndex, Set<string>>();

/** Files the graph knows about: everything the index scanned (tests included). */
const isIndexed = (index: ImportIndex, filePath: string): boolean => {
    let files = indexFileSets.get(index);
    if (!files) {
        files = new Set(index.files);
        indexFileSets.set(index, files);
    }
    return files.has(normalizePath(filePath));
};

/**
 * Code Graph keeps its own index slot: unlike Code Analyze it includes test files, so tests show
 * up as dependents. `force` rebuilds instead of reusing the 5-minute cache.
 */
const getOrBuildIndex = async (
    workspaceFolder: vscode.WorkspaceFolder,
    force = false,
): Promise<ImportIndex> => {
    const { buildImportIndex } = await import('../../shared/javascript/importGraph.js');
    const { getAnalyzeConfig, getDeadCodeExplorerConfig } =
        await import('../code-analyze/deadCode.js');
    const config = getAnalyzeConfig();
    const explorerConfig = getDeadCodeExplorerConfig();
    const entryGlobs = [...config.entryGlobs, ...explorerConfig.entryGlobs];
    return buildImportIndex(workspaceFolder, entryGlobs, [], {
        cacheKey: `${workspaceFolder.uri.fsPath}::code-graph`,
        force,
        javaEntryAnnotations: config.javaEntryAnnotations,
    });
};

// ─── Focus view (one file, its dependencies and dependents) ─────────────────

const collectDependencies = (
    filePath: string,
    workspaceRoot: string,
    index: ImportIndex,
): Map<string, string> => {
    const normalizedTarget = normalizePath(filePath);
    const dependencies = new Map<string, string>();

    for (const imp of index.getImports(normalizedTarget)) {
        if (!imp.resolvedPath) {
            continue;
        }
        if (imp.resolvedPath !== normalizedTarget && isIndexed(index, imp.resolvedPath)) {
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
        if (importerNorm !== normalizedTarget && isIndexed(index, importerNorm)) {
            dependents.set(importerNorm, toRelativePath(importerNorm, workspaceRoot));
        }
    }

    return dependents;
};

const buildFocusGraph = (targetPath: string, index: ImportIndex): CodeGraphData => {
    const workspaceRoot = index.workspaceRoot;
    const normalizedTarget = normalizePath(targetPath);
    const dependencies = collectDependencies(normalizedTarget, workspaceRoot, index);
    const dependents = findDependents(normalizedTarget, workspaceRoot, index);

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

    const targetLabel = toRelativePath(normalizedTarget, workspaceRoot);
    addNode(normalizedTarget, targetLabel, 'current');

    for (const [depPath, rel] of dependencies) {
        addNode(depPath, rel, 'dependency');
        edges.push({ from: normalizedTarget, to: depPath });
    }

    for (const [depPath, rel] of dependents) {
        addNode(depPath, rel, 'dependent');
        edges.push({ from: depPath, to: normalizedTarget });
    }

    return {
        fileName: path.basename(normalizedTarget),
        relativePath: targetLabel,
        rootPath: normalizedTarget,
        nodes,
        edges,
        stats: {
            dependencies: dependencies.size,
            dependents: dependents.size,
        },
    };
};

const expandFocusNode = (nodePath: string, index: ImportIndex): GraphExpansion => {
    const workspaceRoot = index.workspaceRoot;
    const normalizedCenter = normalizePath(nodePath);
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

// ─── Panel ──────────────────────────────────────────────────────────────────

const errorText = (error: unknown, fallback: string): string => {
    return error instanceof Error ? error.message : fallback;
};

const isDirectory = async (fsPath: string): Promise<boolean> => {
    try {
        return (await fs.stat(fsPath)).isDirectory();
    } catch {
        return false;
    }
};

const MAX_HUBS = 40;
const MAX_HUB_SYMBOLS = 30;
const MAX_UNUSED_LISTED = 300;

const dirOf = (rel: string): string => path.posix.dirname(rel);

/** Adds usage facts (dead files, hubs) to a level built by the cluster model. */
export const decorateLevel = (
    level: ClusterLevel,
    model: ClusterModel,
    insights: GraphInsights,
) => {
    const relOf = (abs: string) => model.relOf(abs) ?? abs;

    for (const node of level.nodes) {
        const abs = model.absOf(node.id);
        if (abs) {
            node.fanIn = insights.fanInOf(abs);
            node.usage = insights.flagOf(abs);
            continue;
        }
        if (node.kind !== 'cluster') {
            continue;
        }
        let unusedCount = 0;
        let top: { abs: string; fanIn: number } | undefined;
        for (const file of model.filesUnder(node.id)) {
            if (insights.flagOf(file) === 'unused') {
                unusedCount++;
            }
            const fanIn = insights.fanInOf(file);
            if (!top || fanIn > top.fanIn) {
                top = { abs: file, fanIn };
            }
        }
        node.unusedCount = unusedCount;
        if (top && top.fanIn > 1) {
            node.topHub = { label: path.posix.basename(relOf(top.abs)), fanIn: top.fanIn };
        }
    }

    const scoped = model.filesUnder(level.path);
    const item = (abs: string, count?: number) => ({
        id: relOf(abs),
        label: relOf(abs),
        path: abs,
        count,
    });
    const byPath = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

    const insightsForLevel: LevelInsights = {
        unused: scoped
            .filter((abs) => insights.flagOf(abs) === 'unused')
            .map((abs) => item(abs))
            .sort(byPath)
            .slice(0, MAX_UNUSED_LISTED),
        testOnly: scoped
            .filter((abs) => insights.flagOf(abs) === 'test-only')
            .map((abs) => item(abs))
            .sort(byPath)
            .slice(0, MAX_UNUSED_LISTED),
        hubs: scoped
            .map((abs) => ({ abs, fanIn: insights.fanInOf(abs) }))
            .filter(({ fanIn }) => fanIn > 1)
            .sort((a, b) => b.fanIn - a.fanIn)
            .slice(0, MAX_HUBS)
            .map(({ abs, fanIn }) => ({
                ...item(abs, fanIn),
                spread: new Set(insights.importersOf(abs).map((imp) => dirOf(relOf(imp)))).size,
            })),
        hubSymbols: scoped
            .flatMap((abs) =>
                insights
                    .symbolsOf(abs)
                    .filter((symbol) => symbol.name !== 'default' && symbol.users > 1)
                    .map((symbol) => ({
                        id: relOf(abs),
                        label: symbol.name,
                        path: abs,
                        count: symbol.users,
                    })),
            )
            .sort((a, b) => b.count - a.count)
            .slice(0, MAX_HUB_SYMBOLS),
    };
    level.insights = insightsForLevel;
    return level;
};

export const fileUsageOf = (
    abs: string,
    model: ClusterModel,
    insights: GraphInsights,
): FileUsage => {
    const relOf = (file: string) => model.relOf(file) ?? file;
    return {
        fanIn: insights.fanInOf(abs),
        spread: new Set(insights.importersOf(abs).map((imp) => dirOf(relOf(imp)))).size,
        usage: insights.flagOf(abs),
        symbols: insights.symbolsOf(abs),
        namespaceUsers: insights.namespaceUsersOf(abs),
        unusedExports: insights
            .unusedExportsOf(abs)
            .map((exp) => ({ name: exp.exportName, kind: exp.kind, line: exp.line })),
    };
};

/** Real folder path → the folder id groups use (JVM source roots are dropped). */
const groupFolder = (dir: string): string => (dir ? groupDirOf(`${dir}/_`) : '');

const stringArray = (value: unknown): string[] => {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
};

/**
 * Opens the folder-cluster graph positioned at `uri` (a file is selected inside its folder,
 * a folder is entered). "Focus graph" switches the same panel to the single-file view.
 */
export const openCodeGraph = async (
    uri: vscode.Uri,
    extensionUri: vscode.Uri,
    state?: vscode.Memento,
): Promise<void> => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        throw new Error('File is not inside a workspace folder');
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const targetName = path.basename(uri.fsPath) || workspaceFolder.name;
    const visRoot = vscode.Uri.joinPath(extensionUri, 'media');

    const panel = vscode.window.createWebviewPanel(
        'kyoToolsCodeGraph',
        `Code Graph — ${targetName}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [visRoot] },
    );

    const assets = () => ({
        visScriptUri: panel.webview
            .asWebviewUri(vscode.Uri.joinPath(visRoot, 'vis-network.min.js'))
            .toString(),
        cspSource: panel.webview.cspSource,
    });

    /** Everything the scanner found; the focus view always reads this. */
    let baseIndex: ImportIndex | undefined;
    /** What clusters, insights and the full map read: `baseIndex` narrowed by the user's filter. */
    let index: ImportIndex | undefined;
    let model: ClusterModel | undefined;
    /** The filter as the user left it (persisted); may be invalid or match nothing. */
    let typedFilter: GraphFilterOptions = sanitizeGraphFilter(state?.get(FILTER_STATE_KEY));
    let filterInfo: { kept: number; total: number } | undefined;
    let insights: GraphInsights | undefined;
    let mode: GroupMode = 'folders';
    /** Models per grouping mode for the current index (community detection is built on demand). */
    let models: Partial<Record<GroupMode, ClusterModel>> = {};
    let showPackages = false;
    /** Where the cluster view opens next: an absolute file or folder path. */
    let clusterTarget = normalizePath(uri.fsPath);
    let focusTarget: string | undefined;
    let disposed = false;

    const post = (message: unknown) => {
        if (!disposed) {
            void panel.webview.postMessage(message);
        }
    };

    /** Makes `kept` (or everything, when null) the graph's file set and rebuilds what depends on it. */
    const commitView = (kept: Set<string> | null) => {
        const base = baseIndex!;
        index = kept ? createFilteredIndex(base, kept) : base;
        filterInfo = kept ? { kept: kept.size, total: base.files.length } : undefined;
        models = {};
        post({ type: 'loading', message: 'Finding unused files and hubs…' });
        insights = new GraphInsights(index);
    };

    const ensureModel = async (force = false): Promise<ClusterModel> => {
        if (force || !baseIndex) {
            post({ type: 'loading', message: force ? 'Rebuilding index…' : 'Building index…' });
            baseIndex = await getOrBuildIndex(workspaceFolder, force);
            // The saved filter is re-applied on every rebuild; one that no longer fits is dropped.
            const evaluated = evaluateGraphFilter(baseIndex, typedFilter);
            commitView(evaluated.kept);
            post({ type: 'filterStatus', error: evaluated.error });
        }
        if (!models[mode]) {
            if (mode === 'communities') {
                post({ type: 'loading', message: 'Detecting communities…' });
            }
            models[mode] = new ClusterModel(index!, mode);
        }
        model = models[mode];
        return model!;
    };

    /** The panel is showing every file at once; grouping-mode changes keep it that way. */
    let fullView = false;

    const sendFullMap = () => {
        if (!model) {
            return;
        }
        fullView = true;
        const built = model.buildFullMap();
        built.filter = filterInfo;
        post({ type: 'level', level: insights ? decorateLevel(built, model, insights) : built });
    };

    const sendLevel = (level: string, focus?: string) => {
        if (!model) {
            return;
        }
        fullView = false;
        const built = model.buildLevel(level, { showPackages, focus });
        built.filter = filterInfo;
        post({ type: 'level', level: insights ? decorateLevel(built, model, insights) : built });
    };

    const sendTarget = async (target: string) => {
        const current = await ensureModel();
        const rel = toRelativePath(target, workspaceRoot).replace(/\\/g, '/');
        if (current.hasFile(target)) {
            sendLevel(current.levelForFile(rel), rel);
        } else if (await isDirectory(target)) {
            sendLevel(current.levelForDir(groupFolder(rel === '.' ? '' : rel)));
        } else {
            // Not a source file the index knows (e.g. JSON): open its folder.
            sendLevel(current.levelForDir(groupFolder(path.posix.dirname(rel))));
        }
    };

    const showClusters = (target: string) => {
        focusTarget = undefined;
        clusterTarget = target;
        panel.title = `Code Graph — ${path.basename(target) || workspaceFolder.name}`;
        panel.webview.html = getClusterGraphHtml(
            toRelativePath(target, workspaceRoot) || workspaceFolder.name,
            isDarkTheme(),
            assets(),
        );
    };

    const showFocus = async (target: string, force = false) => {
        focusTarget = target;
        const relativePath = toRelativePath(target, workspaceRoot);
        panel.title = `Code Graph — ${path.basename(target)}`;
        panel.webview.html = getCodeGraphLoadingHtml(relativePath, isDarkTheme());
        try {
            if (force || !baseIndex) {
                await ensureModel(force);
            }
            // The focus view ignores the filter: it always shows the file's real neighbours.
            panel.webview.html = getCodeGraphHtml(
                buildFocusGraph(target, baseIndex!),
                isDarkTheme(),
                assets(),
            );
        } catch (error) {
            const message = errorText(error, 'Failed to build code graph');
            vscode.window.showErrorMessage(message);
            panel.webview.html = getCodeGraphLoadingHtml(relativePath, isDarkTheme(), message);
        }
    };

    const copyContent = async (filePaths: string[]) => {
        const { text, fileCount } = await formatFilesForAi(filePaths, workspaceRoot);
        if (!text) {
            void vscode.window.showWarningMessage('Could not read selected files for copy');
            return;
        }
        if (text.length > LARGE_COPY_CHARS) {
            const choice = await vscode.window.showWarningMessage(
                `Copying ${fileCount} file(s), ~${Math.round(text.length / 4000)}k tokens. Copy anyway?`,
                { modal: true },
                'Copy',
            );
            if (choice !== 'Copy') {
                return;
            }
        }
        await vscode.env.clipboard.writeText(text);
        void vscode.window.showInformationMessage(`Copied content of ${fileCount} file(s) for AI`);
    };

    // Flag the panel as stale when source files change; rebuilding is left to Reload.
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, ANALYZE_SOURCE_GLOB),
    );
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    const markStale = (changed: vscode.Uri) => {
        if (!model || /[\\/](node_modules|dist|build|out|\.git)[\\/]/.test(changed.fsPath)) {
            return;
        }
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => post({ type: 'stale' }), STALE_DEBOUNCE_MS);
    };
    watcher.onDidChange(markStale);
    watcher.onDidCreate(markStale);
    watcher.onDidDelete(markStale);

    panel.onDidDispose(() => {
        disposed = true;
        clearTimeout(staleTimer);
        watcher.dispose();
    });

    panel.webview.onDidReceiveMessage(async (message) => {
        try {
            await handleMessage(message);
        } catch (error) {
            const text = errorText(error, 'Code graph action failed');
            vscode.window.showErrorMessage(text);
            post({ type: 'error', message: text });
        }
    });

    const handleMessage = async (message: Record<string, unknown>) => {
        switch (message?.type) {
            // ── cluster view ──
            case 'ready':
                post({ type: 'filterInit', options: typedFilter });
                await sendTarget(clusterTarget);
                return;
            case 'filter': {
                typedFilter = sanitizeGraphFilter(message);
                void state?.update(FILTER_STATE_KEY, typedFilter);
                await ensureModel();
                const evaluated = evaluateGraphFilter(baseIndex!, typedFilter);
                post({ type: 'filterStatus', error: evaluated.error });
                if (evaluated.error) {
                    // Keep the graph as it is; the panel shows the problem next to the box.
                    return;
                }
                commitView(evaluated.kept);
                const current = await ensureModel();
                if (fullView) {
                    sendFullMap();
                    return;
                }
                // Stay on the same level (and file) when it still exists in the filtered graph.
                const focus =
                    typeof message.focus === 'string' && current.absOf(message.focus)
                        ? message.focus
                        : undefined;
                sendLevel(typeof message.path === 'string' ? message.path : current.rootLevel, focus);
                return;
            }
            case 'navigate': {
                await ensureModel();
                const focus = typeof message.focus === 'string' ? message.focus : undefined;
                sendLevel(typeof message.path === 'string' ? message.path : '', focus);
                return;
            }
            case 'navigateFile':
                if (typeof message.rel === 'string') {
                    const current = await ensureModel();
                    sendLevel(current.levelForFile(message.rel), message.rel);
                }
                return;
            case 'navigateDir':
                if (typeof message.dir === 'string') {
                    const current = await ensureModel();
                    sendLevel(current.levelForDir(groupFolder(message.dir)));
                }
                return;
            case 'packages':
                showPackages = message.show === true;
                return;
            case 'fullMap':
                await ensureModel();
                sendFullMap();
                return;
            case 'mode': {
                mode = message.mode === 'communities' ? 'communities' : 'folders';
                const current = await ensureModel();
                // The full map is recoloured by the new grouping instead of leaving it.
                if (fullView && typeof message.dir !== 'string') {
                    sendFullMap();
                    return;
                }
                // Keep the selected file in view across modes when there is one.
                const focus = typeof message.focus === 'string' ? message.focus : undefined;
                if (focus && current.absOf(focus)) {
                    sendLevel(current.levelForFile(focus), focus);
                } else if (typeof message.dir === 'string') {
                    sendLevel(current.levelForDir(groupFolder(message.dir)));
                } else {
                    sendLevel(current.rootLevel);
                }
                return;
            }
            case 'detail':
                if (model && typeof message.path === 'string' && typeof message.id === 'string') {
                    const detail = model.nodeDetail(message.path, message.id);
                    if (detail.kind === 'file' && detail.absolutePath && insights) {
                        detail.fileUsage = fileUsageOf(detail.absolutePath, model, insights);
                    }
                    post({ type: 'detail', detail });
                }
                return;
            case 'edgeDetail':
                if (
                    model &&
                    typeof message.path === 'string' &&
                    typeof message.from === 'string' &&
                    typeof message.to === 'string'
                ) {
                    post({
                        type: 'edgeDetail',
                        detail: model.edgeDetail(
                            message.path,
                            message.from,
                            message.to,
                            showPackages,
                        ),
                    });
                }
                return;
            case 'search':
                if (model && typeof message.query === 'string') {
                    post({ type: 'searchResults', hits: model.search(message.query) });
                }
                return;
            case 'openRel': {
                const abs = typeof message.rel === 'string' ? model?.absOf(message.rel) : undefined;
                if (abs) {
                    await openFileInEditor(abs);
                }
                return;
            }
            case 'focusFile':
                if (typeof message.path === 'string') {
                    await showFocus(message.path);
                }
                return;
            case 'copyPaths': {
                const ids = stringArray(message.ids);
                if (!model || !ids.length) {
                    return;
                }
                const rels = ids
                    .flatMap((id) => model!.filesUnder(id))
                    .map((abs) => toRelativePath(abs, workspaceRoot));
                await vscode.env.clipboard.writeText(rels.join('\n'));
                void vscode.window.showInformationMessage(`Copied ${rels.length} path(s)`);
                return;
            }

            // ── focus view ──
            case 'clusters':
                showClusters(typeof message.path === 'string' ? message.path : clusterTarget);
                return;
            case 'expand':
                if (typeof message.path === 'string' && baseIndex) {
                    post({ type: 'expandResult', ...expandFocusNode(message.path, baseIndex) });
                }
                return;
            case 'copy':
                if (typeof message.text === 'string') {
                    await vscode.env.clipboard.writeText(message.text);
                }
                return;

            // ── shared ──
            case 'copyContent': {
                if (Array.isArray(message.paths)) {
                    await copyContent(stringArray(message.paths));
                } else if (model) {
                    await copyContent(
                        stringArray(message.ids).flatMap((id) => model!.filesUnder(id)),
                    );
                }
                return;
            }
            case 'open':
                if (typeof message.path === 'string') {
                    const line = typeof message.line === 'number' ? message.line : 0;
                    await openFileInEditor(message.path, line);
                }
                return;
            case 'reload':
                if (focusTarget) {
                    await showFocus(focusTarget, true);
                    return;
                }
                await ensureModel(true);
                if (fullView) {
                    sendFullMap();
                } else if (typeof message.path === 'string') {
                    sendLevel(message.path);
                } else {
                    await sendTarget(clusterTarget);
                }
                return;
        }
    };

    showClusters(clusterTarget);
};
