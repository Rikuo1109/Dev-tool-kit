import * as path from 'path';
import * as vscode from 'vscode';
import { isDarkTheme } from '../../shared/html';
import {
    authorKeyOf,
    buildHeatmapPayload,
    CommitHistory,
    CommitLogCache,
    CommitRecord,
    loadCommitHistory,
} from './commits';
import { getCommitHeatmapHtml, getCommitHeatmapLoadingHtml } from './panel';

const panels = new Map<string, vscode.WebviewPanel>();

const groupByDay = (commits: CommitRecord[]): Map<string, CommitRecord[]> => {
    const byDay = new Map<string, CommitRecord[]>();
    for (const commit of commits) {
        const list = byDay.get(commit.date) ?? [];
        list.push(commit);
        byDay.set(commit.date, list);
    }
    return byDay;
};

const formatError = (error: unknown): string => {
    return error instanceof Error ? error.message : 'Failed to build commit heatmap';
};

export const openCommitHeatmap = async (folderUri: vscode.Uri): Promise<void> => {
    const folder = path.resolve(folderUri.fsPath);
    const folderName = path.basename(folder) || folder;

    const existing = panels.get(folder);
    if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'kyoToolsCommitHeatmap',
        `Commit Heatmap — ${folderName}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    panels.set(folder, panel);

    // Per-panel cache: a repo's `git log` is re-run only when its HEAD moves.
    const logCache: CommitLogCache = new Map();
    let history: CommitHistory | undefined;
    let byDay = new Map<string, CommitRecord[]>();
    let inFlight: Promise<void> | undefined;

    panel.onDidDispose(() => {
        panels.delete(folder);
        logCache.clear();
    });

    panel.webview.html = getCommitHeatmapLoadingHtml(folderName, isDarkTheme());

    const computeAndRender = async () => {
        history = await loadCommitHistory(folder, logCache);
        byDay = groupByDay(history.commits);
        const html = getCommitHeatmapHtml(buildHeatmapPayload(history, folderName), isDarkTheme());
        // Re-assigning identical HTML would reload the webview and lose scroll position.
        if (panel.webview.html !== html) {
            panel.webview.html = html;
        }
    };

    const render = (): Promise<void> => {
        inFlight ??= computeAndRender().finally(() => {
            inFlight = undefined;
        });
        return inFlight;
    };

    panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'day' && typeof message.date === 'string') {
            const commits = (byDay.get(message.date) ?? []).map((commit) => ({
                repo: commit.repo,
                hash: commit.hash,
                subject: commit.subject,
                authorName: commit.authorName,
                authorEmail: commit.authorEmail,
                authorKey: authorKeyOf(commit),
            }));
            void panel.webview.postMessage({ type: 'dayCommits', date: message.date, commits });
            return;
        }

        if (message?.type === 'copy' && typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
            void vscode.window.showInformationMessage(`Copied ${message.text.slice(0, 8)}`);
            return;
        }

        if (message?.type === 'reload') {
            try {
                await render();
            } catch (error) {
                vscode.window.showErrorMessage(formatError(error));
            } finally {
                void panel.webview.postMessage({ type: 'reloadDone' });
            }
        }
    });

    try {
        await render();
    } catch (error) {
        vscode.window.showErrorMessage(formatError(error));
    }
};
