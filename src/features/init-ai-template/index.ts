import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getTemplateFiles } from './templates';
import {
    formatCommandError,
    isGitRepository,
    runGitNexusAnalyze,
    runGitNexusSetup,
    writeTextFile,
    WriteResult,
} from './runners';

interface InitStepResult {
    label: string;
    status: 'ok' | 'skipped' | 'failed';
    detail?: string;
}

export async function initAiTemplate(): Promise<void> {
    const workspaceFolder = await pickWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const existingTemplateFiles = getTemplateFiles().filter((file) =>
        fs.existsSync(path.join(workspaceRoot, file.relativePath)),
    );

    let overwrite = false;
    if (existingTemplateFiles.length > 0) {
        const choice = await vscode.window.showWarningMessage(
            `${existingTemplateFiles.length} AI template file(s) already exist. Overwrite?`,
            { modal: true },
            'Overwrite',
            'Skip existing files',
        );

        if (!choice) {
            return;
        }

        overwrite = choice === 'Overwrite';
    }

    const output = vscode.window.createOutputChannel('Kyo Tools — Init AI Template');
    output.clear();
    output.show(true);

    const log = (line: string) => {
        output.appendLine(line);
    };

    const results: InitStepResult[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Init AI Template',
            cancellable: false,
        },
        async (progress) => {
            progress.report({ message: 'Writing Cursor rules and skills…' });
            for (const file of getTemplateFiles()) {
                const absolutePath = path.join(workspaceRoot, file.relativePath);
                try {
                    const result: WriteResult = await writeTextFile(
                        absolutePath,
                        file.content,
                        overwrite,
                    );
                    if (result === 'skipped') {
                        results.push({
                            label: file.label,
                            status: 'skipped',
                            detail: file.relativePath,
                        });
                        log(`Skipped (exists): ${file.relativePath}`);
                    } else {
                        results.push({
                            label: file.label,
                            status: 'ok',
                            detail: `${result} → ${file.relativePath}`,
                        });
                        log(
                            `${result === 'created' ? 'Created' : 'Updated'}: ${file.relativePath}`,
                        );
                    }
                } catch (error) {
                    const message = formatCommandError(error);
                    results.push({ label: file.label, status: 'failed', detail: message });
                    log(`Failed: ${file.relativePath}\n${message}`);
                }
            }

            progress.report({ message: 'Running gitnexus setup…' });
            try {
                await runGitNexusSetup(workspaceRoot, log);
                results.push({
                    label: 'GitNexus setup',
                    status: 'ok',
                    detail: 'MCP + global skills',
                });
            } catch (error) {
                const message = formatCommandError(error);
                results.push({ label: 'GitNexus setup', status: 'failed', detail: message });
                log(`GitNexus setup failed:\n${message}`);
            }

            if (isGitRepository(workspaceRoot)) {
                progress.report({ message: 'Running gitnexus analyze…' });
                try {
                    await runGitNexusAnalyze(workspaceRoot, log);
                    results.push({
                        label: 'GitNexus analyze',
                        status: 'ok',
                        detail: 'Project index + skills',
                    });
                } catch (error) {
                    const message = formatCommandError(error);
                    results.push({
                        label: 'GitNexus analyze',
                        status: 'failed',
                        detail: message,
                    });
                    log(`GitNexus analyze failed:\n${message}`);
                }
            } else {
                results.push({
                    label: 'GitNexus analyze',
                    status: 'skipped',
                    detail: 'Not a git repository',
                });
                log('Skipped gitnexus analyze: workspace root is not a git repository.');
            }
        },
    );

    const failed = results.filter((item) => item.status === 'failed');
    const ok = results.filter((item) => item.status === 'ok');

    log('');
    log('Summary:');
    for (const item of results) {
        log(`- ${item.label}: ${item.status}${item.detail ? ` (${item.detail})` : ''}`);
    }

    if (failed.length > 0) {
        vscode.window.showWarningMessage(
            `Init AI Template finished with ${failed.length} error(s). See output for details.`,
        );
        return;
    }

    vscode.window
        .showInformationMessage(
            `Init AI Template complete (${ok.length} step(s)). Caveman lite + Ponytail rules are active on new chats. Reload Cursor window to pick up GitNexus MCP if needed.`,
            'Reload Window',
        )
        .then((choice) => {
            if (choice === 'Reload Window') {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        vscode.window.showWarningMessage(
            'Open a workspace folder before running Init AI Template.',
        );
        return undefined;
    }

    if (folders.length === 1) {
        return folders[0];
    }

    const pick = await vscode.window.showQuickPick(
        folders.map((folder) => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder,
        })),
        { placeHolder: 'Select workspace folder for AI template' },
    );

    return pick?.folder;
}
