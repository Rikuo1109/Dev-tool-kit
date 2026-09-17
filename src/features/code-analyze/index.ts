import * as path from 'path';
import * as vscode from 'vscode';
import { isPathInsideFolder, normalizePath } from '../../shared/fs';
import { isDarkTheme } from '../../shared/html';
import { buildImportIndex } from '../../shared/javascript/importGraph';
import { discoverBundlerEntries } from './dead-explorer/entryDiscovery';
import {
    findOrphanModules,
    findUnusedExports,
    findUnusedFiles,
    getAnalyzeConfig,
    getDeadCodeExplorerConfig,
} from './deadCode';
import { findLargeFiles, findLargeFunctions } from './largeUnits';
import { CodeAnalyzePanel } from './panel';
import { CodeAnalyzeReport, DeadItem, UnusedExportItem } from './types';

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

export type {
    AnalyzeFileItem,
    CodeAnalyzeReport,
    DeadItem,
    LargeFileItem,
    LargeFunctionItem,
    UnusedExportItem,
} from './types';

export async function analyzeCodeInFolder(
    folderUri: vscode.Uri,
    existingPanel?: CodeAnalyzePanel,
): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri);
    if (!workspaceFolder) {
        throw new Error('Folder is not inside a workspace');
    }

    const folderPath = normalizePath(folderUri.fsPath);
    const folderName = path.basename(folderPath);
    const config = getAnalyzeConfig();
    const explorerConfig = getDeadCodeExplorerConfig();
    const isDark = isDarkTheme();
    const panel = existingPanel ?? CodeAnalyzePanel.open(folderName, isDark);
    panel.bindFolder(folderUri, () => analyzeCodeInFolder(folderUri, panel));
    if (existingPanel) {
        panel.showLoading(folderName);
    }
    const startedAt = Date.now();

    try {
        const report = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Analyzing code in ${folderName}…`,
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: 'Discovering entries…' });
                const entryGlobs = [...config.entryGlobs, ...explorerConfig.entryGlobs];
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
                    config.excludeGlobs,
                );

                for (const entry of discovered.entries) {
                    index.entryPoints.add(entry);
                    if (!discovered.labels.has(entry)) {
                        discovered.labels.set(entry, 'discovered entry');
                    }
                }

                const scopedFiles = index.files.filter((file) =>
                    isPathInsideFolder(file, folderPath),
                );

                progress.report({ message: 'Finding unused code…' });
                const unusedFiles = findUnusedFiles(scopedFiles, index);
                const orphanModules = findOrphanModules(scopedFiles, index);
                const unusedExports = findUnusedExports(scopedFiles, index);

                progress.report({ message: 'Detecting duplicate code…' });

                progress.report({ message: 'Finding large files and functions…' });
                const largeFiles = findLargeFiles(scopedFiles, index, config);
                const largeFunctions = findLargeFunctions(scopedFiles, index, config);

                progress.report({ message: 'Finding unused exports by kind…' });
                const { deadClasses, deadFunctions, deadConstants } = groupExports(unusedExports);

                return {
                    folderName,
                    folderPath,
                    scannedFiles: scopedFiles.length,
                    unusedFiles,
                    orphanModules,
                    unusedExports,
                    largeFiles,
                    largeFunctions,
                    entryPoints: [...index.entryPoints]
                        .filter((entry) => isPathInsideFolder(entry, folderPath))
                        .map((entry) => ({
                            relativePath: index.relativePath(entry),
                            absolutePath: entry,
                        })),
                    deadClasses,
                    deadFunctions,
                    deadConstants,

                    discoveredEntries: discovered.entries.map((abs) => index.relativePath(abs)),
                    durationMs: Date.now() - startedAt,
                } satisfies CodeAnalyzeReport;
            },
        );

        panel.showReport(report);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Code analyze failed';
        vscode.window.showErrorMessage(message);
        panel.dispose();
    }
}
