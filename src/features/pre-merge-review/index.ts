import * as vscode from 'vscode';
import { isDarkTheme } from '../../shared/html';
import { resolveFolderUri } from '../../shared/resolveUri';
import { runPreMergeReview } from './analyze';
import { getCurrentBranch, listGitBranches, resolveGitRoot } from './gitDiff';
import { PreMergeReviewPanel } from './panel';

export async function pickCompareBranch(
    gitRoot: string,
    currentBranch: string,
): Promise<string | undefined> {
    const branches = await listGitBranches(gitRoot, currentBranch);
    if (branches.length === 0) {
        vscode.window.showWarningMessage('No other branches found to compare.');
        return undefined;
    }

    const pick = await vscode.window.showQuickPick(
        branches.map((branch) => ({
            label: branch,
            description: branch.startsWith('origin/') ? 'remote branch' : 'local branch',
        })),
        {
            title: 'Pre-Merge Review',
            placeHolder: `Current branch: ${currentBranch} — select branch to compare with`,
        },
    );

    return pick?.label;
}

export async function openPreMergeReview(
    folderUri?: vscode.Uri,
    existingPanel?: PreMergeReviewPanel,
    compareBranch?: string,
    forcePickBranch = false,
): Promise<void> {
    const folder = folderUri ?? (await resolveFolderUri());
    if (!folder) {
        return;
    }

    const gitRoot = resolveGitRoot(folder.fsPath);
    const currentBranch = await getCurrentBranch(gitRoot);
    const selectedBranch =
        !forcePickBranch && compareBranch
            ? compareBranch
            : await pickCompareBranch(gitRoot, currentBranch);

    if (!selectedBranch) {
        return;
    }

    const panel =
        existingPanel ?? PreMergeReviewPanel.open(currentBranch, selectedBranch, isDarkTheme());
    panel.bindReload(() => openPreMergeReview(folder, panel, selectedBranch, false));
    panel.bindChangeBranch(() => openPreMergeReview(folder, panel, undefined, true));

    if (existingPanel) {
        panel.showLoading(currentBranch, selectedBranch);
    }

    try {
        const report = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Pre-merge review: ${currentBranch} ↔ ${selectedBranch}…`,
                cancellable: false,
            },
            async () => runPreMergeReview(folder.fsPath, selectedBranch),
        );

        panel.showReport(report);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Pre-merge review failed';
        vscode.window.showErrorMessage(message);
        panel.dispose();
    }
}
