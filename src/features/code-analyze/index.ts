import * as path from 'path';
import * as vscode from 'vscode';
import {
    buildImportIndex,
    isPathInsideFolder,
    normalizePath,
} from '../../shared/javascript/importGraph';
import { isDarkTheme } from '../../shared/html';
import {
    findOrphanModules,
    findUnusedExports,
    findUnusedFiles,
    getAnalyzeConfig,
} from './deadCode';
import { findDuplicateCode } from './duplicates';
import { findLargeFiles, findLargeFunctions } from './largeUnits';
import { CodeAnalyzePanel } from './panel';
import { CodeAnalyzeReport } from './types';

export type {
    AnalyzeFileItem,
    CodeAnalyzeReport,
    DuplicateGroup,
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
                progress.report({ message: 'Building import graph…' });
                const index = await buildImportIndex(
                    workspaceFolder,
                    config.entryGlobs,
                    config.excludeGlobs,
                );

                const scopedFiles = index.files.filter((file) =>
                    isPathInsideFolder(file, folderPath),
                );

                progress.report({ message: 'Finding unused code…' });
                const unusedFiles = findUnusedFiles(scopedFiles, index);
                const orphanModules = findOrphanModules(scopedFiles, index);
                const unusedExports = findUnusedExports(scopedFiles, index);

                progress.report({ message: 'Detecting duplicate code…' });
                const duplicates = findDuplicateCode(scopedFiles, index, config);

                progress.report({ message: 'Finding large files and functions…' });
                const largeFiles = findLargeFiles(scopedFiles, index, config);
                const largeFunctions = findLargeFunctions(scopedFiles, index, config);

                return {
                    folderName,
                    folderPath,
                    scannedFiles: scopedFiles.length,
                    unusedFiles,
                    orphanModules,
                    unusedExports,
                    duplicates,
                    largeFiles,
                    largeFunctions,
                    entryPoints: [...index.entryPoints]
                        .filter((entry) => isPathInsideFolder(entry, folderPath))
                        .map((entry) => ({
                            relativePath: index.relativePath(entry),
                            absolutePath: entry,
                        })),
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
