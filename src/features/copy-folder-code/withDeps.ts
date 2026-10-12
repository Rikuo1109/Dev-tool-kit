import * as vscode from 'vscode';
import { estimateTokens, joinFilesForAi, readFilesForAi } from '../../shared/aiFormat';
import { toSignatures } from '../../shared/aiSignatures';
import { normalizePath } from '../../shared/fs';
import { getCachedImportIndex } from '../../shared/importIndexCache';
import { findReachableFiles, ImportIndex } from '../../shared/javascript/importGraph';
import { formatSizeInfo } from './index';

const SIGNATURES_NOTE =
    '> Dependencies below are shown as signatures only (function bodies replaced with `{ … }`).';

interface ScopeItem extends vscode.QuickPickItem {
    files: string[];
}

interface ModeItem extends vscode.QuickPickItem {
    signatures: boolean;
}

/** Same index source as Code Graph: reuse the cached one, otherwise build it lazily. */
const getImportIndex = async (workspaceFolder: vscode.WorkspaceFolder): Promise<ImportIndex> => {
    const cached = getCachedImportIndex(workspaceFolder.uri.fsPath);
    if (cached) {
        return cached;
    }
    const { buildImportIndex } = await import('../../shared/javascript/importGraph.js');
    const { getAnalyzeConfig, getDeadCodeExplorerConfig } =
        await import('../code-analyze/deadCode.js');
    const config = getAnalyzeConfig();
    const entryGlobs = [...config.entryGlobs, ...getDeadCodeExplorerConfig().entryGlobs];
    return buildImportIndex(workspaceFolder, entryGlobs, config.excludeGlobs, {
        javaEntryAnnotations: config.javaEntryAnnotations,
    });
};

const uniqueExcept = (paths: Iterable<string>, exclude: string): string[] => {
    return [...new Set(paths)].filter((p) => p !== exclude).sort((a, b) => a.localeCompare(b));
};

const describeCost = (files: string[], index: ImportIndex): string => {
    const chars = files.reduce((sum, file) => sum + index.getContent(file).length, 0);
    return `~${estimateTokens(chars)} tokens`;
};

const buildScopeItems = (target: string, index: ImportIndex): ScopeItem[] => {
    const direct = uniqueExcept(index.getDependencies(target), target);
    const transitive = uniqueExcept(findReachableFiles(index, new Set([target])), target);
    const dependents = uniqueExcept(index.getImporters(target), target);
    const directAndDependents = uniqueExcept([...direct, ...dependents], target);

    const item = (label: string, detail: string, files: string[]): ScopeItem => ({
        label,
        description: `${files.length} file(s) + target — ${describeCost([target, ...files], index)} (full)`,
        detail,
        files,
    });

    return [
        item('Direct dependencies', 'Files this file imports', direct),
        item('All dependencies', 'Everything reachable through imports', transitive),
        item(
            'Direct dependencies + dependents',
            'Files this file imports and files that import it',
            directAndDependents,
        ),
    ];
};

export const copyFileWithDependencies = async (fileUri: vscode.Uri): Promise<void> => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
        throw new Error('File is not inside a workspace folder');
    }

    const target = normalizePath(fileUri.fsPath);
    const index = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Analyzing imports…' },
        () => getImportIndex(workspaceFolder),
    );

    const scope = await vscode.window.showQuickPick(buildScopeItems(target, index), {
        title: `Copy ${index.relativePath(target)} with…`,
    });
    if (!scope) {
        return;
    }

    let signatures = false;
    if (scope.files.length > 0) {
        const modes: ModeItem[] = [
            { label: 'Full source', signatures: false },
            {
                label: 'Signatures only for dependencies',
                detail: 'Target file stays complete; dependency bodies become { … }',
                signatures: true,
            },
        ];
        const mode = await vscode.window.showQuickPick(modes, { title: 'Dependency detail' });
        if (!mode) {
            return;
        }
        signatures = mode.signatures;
    }

    const root = workspaceFolder.uri.fsPath;
    const [targetRead, depsRead] = await Promise.all([
        readFilesForAi([target], root),
        readFilesForAi(scope.files, root),
    ]);
    if (targetRead.files.length === 0) {
        throw new Error('Could not read the selected file');
    }

    const parts = [joinFilesForAi(targetRead.files)];
    if (depsRead.files.length > 0) {
        if (signatures) {
            parts.push(SIGNATURES_NOTE);
        }
        parts.push(
            joinFilesForAi(depsRead.files, (file) =>
                signatures ? toSignatures(file.content, file.relativePath) : file.content,
            ),
        );
    }
    const text = parts.join('\n\n');

    await vscode.env.clipboard.writeText(text);

    const skipped =
        depsRead.skippedCount > 0 ? ` (skipped ${depsRead.skippedCount} unreadable)` : '';
    void vscode.window.showInformationMessage(
        `Copied ${index.relativePath(target)} + ${depsRead.files.length} file(s) for AI — ${formatSizeInfo(text.length)}${skipped}`,
    );
};
