import { readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import * as vscode from 'vscode';
import { readFileSafe } from '../../shared/fs';
import { filterGitIgnoredPaths, findGitRoot, isGitRepository } from '../../shared/gitignore';
import { isDarkTheme } from '../../shared/html';
import { openFileInEditor } from '../../shared/openInEditor';
import { getDashboardHtml, parseClocData } from './cloc';
import { GitChangeAnalyzer } from './gitChanges';
import { rankTodos, scanTodosInContent, TodoItem } from './todos';

interface FolderScanResult {
    raw: Record<string, unknown>;
    todos: TodoItem[];
    todoTotal: number;
}

let activePanel: vscode.WebviewPanel | undefined;

const countCodeLines = (
    content: string,
): {
    code: number;
    blank: number;
    comment: number;
} => {
    const lines = content.split('\n');
    let code = 0,
        blank = 0,
        comment = 0;
    let inBlockComment = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Block comments
        if (trimmed.includes('/*')) {
            inBlockComment = true;
        }
        if (inBlockComment) {
            comment++;
            if (trimmed.includes('*/')) {
                inBlockComment = false;
            }
            continue;
        }

        // Blank lines
        if (!trimmed) {
            blank++;
        } else if (trimmed.startsWith('//')) {
            comment++;
        } else {
            code++;
        }
    }

    return { code, blank, comment };
};

const countFilesInDir = (
    dirPath: string,
    excludeDirs = new Set(['node_modules', 'dist', 'build', '.git', '.gitnexus']),
): FolderScanResult => {
    const result: Record<string, unknown> = {};
    const foundTodos: TodoItem[] = [];
    let totalFiles = 0;
    let totalCode = 0;
    let totalBlank = 0;
    let totalComment = 0;

    const resolvedRoot = dirPath.replace(/\\/g, '/').replace(/\/$/, '');
    const isGit = isGitRepository(dirPath);
    const gitRoot = isGit ? findGitRoot(dirPath) : null;
    const filesToCheck: string[] = [];
    const compressedExts = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz']);

    const walkDir = (dir: string) => {
        try {
            const pending: { fullPath: string; isDir: boolean }[] = [];
            for (const entry of readdirSync(dir)) {
                if (entry.startsWith('.') && !isGit) {
                    continue;
                }
                if (excludeDirs.has(entry)) {
                    continue;
                }

                const fullPath = join(dir, entry);
                try {
                    pending.push({ fullPath, isDir: statSync(fullPath).isDirectory() });
                } catch {
                    // Skip unreadable entries
                }
            }

            const checkPaths = pending.map((item) =>
                item.isDir ? `${item.fullPath.replace(/\\/g, '/')}/` : item.fullPath,
            );
            const allowed = new Set(
                gitRoot ? filterGitIgnoredPaths(gitRoot, checkPaths) : checkPaths,
            );

            for (let i = 0; i < pending.length; i++) {
                if (!allowed.has(checkPaths[i])) {
                    continue;
                }
                if (pending[i].isDir) {
                    walkDir(pending[i].fullPath);
                } else {
                    filesToCheck.push(pending[i].fullPath);
                }
            }
        } catch {
            // Skip unreadable dirs
        }
    };

    walkDir(dirPath);

    const filesToProcess = filesToCheck;

    const langMap: Record<string, string> = {
        '.js': 'JavaScript',
        '.ts': 'TypeScript',
        '.jsx': 'JavaScript',
        '.tsx': 'TypeScript',
        '.py': 'Python',
        '.java': 'Java',
        '.go': 'Go',
        '.rs': 'Rust',
        '.rb': 'Ruby',
        '.php': 'PHP',
        '.css': 'CSS',
        '.html': 'HTML',
        '.json': 'JSON',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.md': 'Markdown',
        '.sh': 'Shell',
    };

    for (const fullPath of filesToProcess) {
        try {
            const ext = extname(fullPath).toLowerCase();
            if (compressedExts.has(ext)) {
                continue;
            }

            const lang = langMap[ext] || ext.slice(1).toUpperCase() || 'Unknown';
            const content = readFileSafe(fullPath);
            if (!content) {
                continue;
            }
            const counts = countCodeLines(content);
            const relativePath =
                relative(resolvedRoot, fullPath).replace(/\\/g, '/') ||
                fullPath.split(/[/\\]/).pop() ||
                fullPath;

            result[fullPath] = {
                blank: counts.blank,
                comment: counts.comment,
                code: counts.code,
                language: lang,
            };

            foundTodos.push(...scanTodosInContent(content, fullPath, relativePath));

            totalFiles++;
            totalCode += counts.code;
            totalBlank += counts.blank;
            totalComment += counts.comment;
        } catch {
            // Skip unreadable files
        }
    }

    result.SUM = {
        nFiles: totalFiles,
        code: totalCode,
        blank: totalBlank,
        comment: totalComment,
    };

    const ranked = rankTodos(foundTodos);
    return {
        raw: result,
        todos: ranked.todos,
        todoTotal: ranked.todoTotal,
    };
};

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

        const render = async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Analyzing ${folderName}…`,
                    cancellable: false,
                },
                async () => {
                    const scan = countFilesInDir(folder);
                    const { stats: gitChanges, subrepoCount } = new GitChangeAnalyzer(
                        folder,
                    ).getAggregatedGitChangeStats();
                    const data = parseClocData(
                        scan.raw,
                        folder,
                        folderName,
                        gitChanges,
                        subrepoCount,
                        scan.todos,
                        scan.todoTotal,
                    );

                    const chartScriptUri = panel.webview.asWebviewUri(
                        vscode.Uri.joinPath(extensionUri, 'media', 'chart.umd.min.js'),
                    );

                    panel.webview.html = getDashboardHtml(data, isDarkTheme(), {
                        chartScriptUri: chartScriptUri.toString(),
                        cspSource: panel.webview.cspSource,
                    });
                },
            );
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
                }
            }
        });

        await render();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to analyze folder';
        vscode.window.showErrorMessage(message);
    }
};
