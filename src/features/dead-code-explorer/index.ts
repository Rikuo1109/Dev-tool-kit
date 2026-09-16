import * as path from 'path';
import * as vscode from 'vscode';
import { findUnusedExports, getAnalyzeConfig } from '../code-analyze/deadCode';
import { UnusedExportItem } from '../code-analyze/types';
import {
    buildImportIndex,
    isPathInsideFolder,
    normalizePath,
} from '../../shared/javascript/importGraph';
import { isDarkTheme } from '../../shared/html';
import { buildAssetGraph } from './assetGraph';
import { classifyDeadFiles } from './classifyFiles';
import { getDeadCodeExplorerConfig } from './config';
import { discoverBundlerEntries } from './entryDiscovery';
import { findDeadApis, findDeadCss, findDeadRoutes } from './heuristics';
import { DeadCodeExplorerPanel } from './panel';
import { DeadCodeReport, DeadItem } from './types';

const CLASS_KINDS = new Set(['class']);
const FUNCTION_KINDS = new Set(['function', 'named', 'default', 'method']);
const CONSTANT_KINDS = new Set(['const', 'let', 'var', 'enum']);

function toDeadItem(item: UnusedExportItem): DeadItem {
    return {
        relativePath: item.relativePath,
        absolutePath: item.absolutePath,
        name: item.exportName,
        detail: item.kind,
        line: item.line,
        bucket: 'dead',
        confidence: 'medium',
        reason: 'export_unused',
        falsePositiveHint: 'Export may be used via dynamic import or re-export aliases.',
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
        throw new Error('Folder is not inside a workspace');
    }

    const folderPath = normalizePath(folderUri.fsPath);
    const folderName = path.basename(folderPath);
    const analyzeConfig = getAnalyzeConfig();
    const explorerConfig = getDeadCodeExplorerConfig();
    const isDark = isDarkTheme();
    const panel = existingPanel ?? DeadCodeExplorerPanel.open(folderName, isDark);
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
                progress.report({ message: 'Discovering entries…' });
                const entryGlobs = [...analyzeConfig.entryGlobs, ...explorerConfig.entryGlobs];
                const discovered = explorerConfig.discoverBundlerEntries
                    ? await discoverBundlerEntries(
                          workspaceFolder,
                          workspaceFolder.uri.fsPath,
                          explorerConfig.entryGlobs,
                      )
                    : { entries: [] as string[], labels: new Map<string, string>() };

                progress.report({ message: 'Building import graph…' });
                const index = await buildImportIndex(
                    workspaceFolder,
                    entryGlobs,
                    analyzeConfig.excludeGlobs,
                );

                // Merge discovered bundler entries into index entry set for reachability
                for (const entry of discovered.entries) {
                    index.entryPoints.add(entry);
                    if (!discovered.labels.has(entry)) {
                        discovered.labels.set(entry, 'discovered entry');
                    }
                }

                const scopedFiles = index.files.filter((file) =>
                    isPathInsideFolder(file, folderPath),
                );

                progress.report({ message: 'Building runtime asset graph…' });
                const assetGraph = await buildAssetGraph(
                    workspaceFolder,
                    workspaceFolder.uri.fsPath,
                    index,
                );

                progress.report({ message: 'Classifying files…' });
                const classified = classifyDeadFiles({
                    scopedFiles,
                    index,
                    config: explorerConfig,
                    discoveredEntries: discovered.entries,
                    entryLabels: discovered.labels,
                    assetGraph,
                    primaryBuckets: explorerConfig.primaryBuckets,
                });

                progress.report({ message: 'Finding unused exports…' });
                const unusedExports = findUnusedExports(scopedFiles, index);
                const { deadClasses, deadFunctions, deadConstants } = groupExports(unusedExports);

                progress.report({ message: 'Scanning routes, APIs, CSS…' });
                const [deadRoutes, deadApis, deadCss] = await Promise.all([
                    findDeadRoutes(folderPath, index),
                    findDeadApis(folderPath, index),
                    findDeadCss(folderUri, folderPath, index),
                ]);

                return {
                    folderName,
                    folderPath,
                    scannedFiles: scopedFiles.length,
                    deadFiles: classified.primary,
                    allDeadFiles: classified.all,
                    filesSummary: classified.summary,
                    deadClasses,
                    deadFunctions,
                    deadConstants,
                    deadRoutes,
                    deadApis,
                    deadCss,
                    discoveredEntries: discovered.entries.map((abs) => index.relativePath(abs)),
                    durationMs: Date.now() - startedAt,
                } satisfies DeadCodeReport;
            },
        );

        panel.showReport(report);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Dead Code Explorer failed';
        vscode.window.showErrorMessage(message);
        panel.dispose();
    }
}
