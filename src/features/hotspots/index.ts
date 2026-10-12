import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { formatFileBlockForAi } from '../../shared/aiFormat';
import { isDarkTheme } from '../../shared/html';
import { openFileInEditor } from '../../shared/openInEditor';
import { ChurnCache, loadChurn } from './churn';
import { buildHotspotReport, HotspotItem, HotspotReport } from './metrics';
import { getHotspotsHtml, getHotspotsLoadingHtml, RANGE_MONTHS } from './panel';

const DEFAULT_MONTHS = 6;
const panels = new Map<string, vscode.WebviewPanel>();

const formatError = (error: unknown): string => {
    return error instanceof Error ? error.message : 'Failed to build hotspots';
};

const buildRefactorPrompt = (item: HotspotItem, months: number, content: string): string => {
    return [
        `This file is a hotspot in our codebase: it changes often and is complex, so it is the most valuable place to refactor.`,
        '',
        `- Changed in ${item.commits} commits over the last ${months} months (${item.linesChanged} lines added/removed, ${item.authors} author(s))`,
        `- ${item.loc} lines of code, complexity ${item.complexity} (decision points), longest function ${item.maxFunctionLoc} lines`,
        '',
        'Suggest a refactoring plan that reduces complexity and makes future changes safer: split responsibilities, extract long functions, simplify branching, and point out where tests would help most. Keep behaviour unchanged.',
        '',
        formatFileBlockForAi(item.relativePath, content),
    ].join('\n');
};

export const openHotspots = async (folderUri: vscode.Uri, extensionUri: vscode.Uri): Promise<void> => {
    const folder = path.resolve(folderUri.fsPath);
    const folderName = path.basename(folder) || folder;

    const existing = panels.get(folder);
    if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'kyoToolsHotspots',
        `Hotspots — ${folderName}`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        },
    );
    panels.set(folder, panel);

    // Per-panel cache: a repo's `git log` is re-run only when its HEAD (or the day) changes.
    const churnCache: ChurnCache = new Map();
    let months = DEFAULT_MONTHS;
    let report: HotspotReport | undefined;
    let inFlight: Promise<void> | undefined;

    panel.onDidDispose(() => {
        panels.delete(folder);
        churnCache.clear();
    });

    panel.webview.html = getHotspotsLoadingHtml(folderName, isDarkTheme());

    const computeAndRender = async () => {
        const churn = await loadChurn(folder, months, churnCache);
        report = await buildHotspotReport(folder, months, churn);
        const chartScriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'chart.umd.min.js'),
        );
        const html = getHotspotsHtml(report, isDarkTheme(), {
            chartScriptUri: chartScriptUri.toString(),
            cspSource: panel.webview.cspSource,
        });
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
        if (message?.type === 'open' && typeof message.path === 'string') {
            await openFileInEditor(message.path);
            return;
        }

        if (message?.type === 'copyAi' && typeof message.path === 'string') {
            const item = report?.items.find((entry) => entry.absolutePath === message.path);
            if (!item || !report) {
                return;
            }
            try {
                const content = await fs.readFile(item.absolutePath, 'utf-8');
                await vscode.env.clipboard.writeText(buildRefactorPrompt(item, report.months, content));
                void vscode.window.showInformationMessage(
                    `Copied refactor prompt for ${item.relativePath}`,
                );
            } catch (error) {
                vscode.window.showErrorMessage(formatError(error));
            }
            return;
        }

        if (
            message?.type === 'range' &&
            RANGE_MONTHS.includes(message.months) &&
            message.months !== months
        ) {
            months = message.months;
            try {
                // A run already in flight still uses the old range; wait for it, then recompute.
                await inFlight?.catch(() => undefined);
                await render();
            } catch (error) {
                vscode.window.showErrorMessage(formatError(error));
            }
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
