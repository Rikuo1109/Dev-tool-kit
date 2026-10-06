import * as vscode from 'vscode';
import { isDarkTheme } from '../../shared/html';
import { openFileInEditor } from '../../shared/openInEditor';
import { getDashboardHtml, parseClocData } from './cloc';
import { countFiles, FileStatsCache, scanFolder } from './fileStats';
import { GitChangeAnalyzer, GitLogCache } from './gitChanges';

let activePanel: vscode.WebviewPanel | undefined;

export const openDashboard = async (folder: string, extensionUri: vscode.Uri): Promise<void> => {
    const folderName = folder.split(/[/\\]/).pop() ?? folder;

    if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.One);
        return;
    }

    try {
        const panel = vscode.window.createWebviewPanel(
            'codeDashboard',
            `Code Dashboard — ${folderName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            },
        );

        activePanel = panel;
        panel.onDidDispose(() => {
            if (activePanel === panel) {
                activePanel = undefined;
            }
        });

        // Per-panel caches: unchanged files are not re-read and unchanged HEADs skip `git log`.
        const fileCache: FileStatsCache = new Map();
        const gitLogCache: GitLogCache = new Map();
        let inFlight: Promise<void> | undefined;

        const computeAndRender = async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Analyzing ${folderName}…`,
                    cancellable: false,
                },
                async () => {
                    // One scan decides both the counted files and the repos whose history is merged.
                    const scan = await scanFolder(folder);
                    const analyzer = new GitChangeAnalyzer(folder, gitLogCache, scan.subrepos);
                    const [raw, { stats: gitChanges, subrepoCount }] = await Promise.all([
                        countFiles(scan.files, fileCache),
                        analyzer.getAggregatedGitChangeStats(),
                    ]);
                    const data = parseClocData(raw, folder, folderName, gitChanges, subrepoCount);

                    const chartScriptUri = panel.webview.asWebviewUri(
                        vscode.Uri.joinPath(extensionUri, 'media', 'chart.umd.min.js'),
                    );

                    const html = getDashboardHtml(data, isDarkTheme(), {
                        chartScriptUri: chartScriptUri.toString(),
                        cspSource: panel.webview.cspSource,
                    });

                    // Re-assigning identical HTML reloads the webview and Chart.js for nothing.
                    if (panel.webview.html !== html) {
                        panel.webview.html = html;
                    }
                },
            );
        };

        const render = (): Promise<void> => {
            inFlight ??= computeAndRender().finally(() => {
                inFlight = undefined;
            });
            return inFlight;
        };

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'open' && typeof message.path === 'string') {
                const line =
                    typeof message.line === 'number' && message.line > 0 ? message.line : 0;
                await openFileInEditor(message.path, line);
                return;
            }

            if (message.type === 'reload') {
                try {
                    await render();
                } catch (error) {
                    const errMessage =
                        error instanceof Error ? error.message : 'Failed to reload dashboard';
                    vscode.window.showErrorMessage(errMessage);
                } finally {
                    // Re-enables the Reload button when the HTML was not replaced.
                    void panel.webview.postMessage({ type: 'reloadDone' });
                }
            }
        });

        await render();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to analyze folder';
        vscode.window.showErrorMessage(message);
    }
};
