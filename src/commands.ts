import * as vscode from 'vscode';
import { analyzeCodeInFolder } from './features/code-analyze';
import { openCodeGraph } from './features/code-graph';
import { openCommitHeatmap } from './features/commit-heatmap';
import { copyFolderCode } from './features/copy-folder-code';
import { copyFileWithDependencies } from './features/copy-folder-code/withDeps';
import { openDashboard } from './features/dashboard';
import { openHotspots } from './features/hotspots';
import { initAiTemplate } from './features/init-ai-template';
import { organizeImportsInFolder } from './features/organize-imports';
import { resolveFolderUri } from './shared/resolveUri';

interface CommandDefinition {
    id: string;
    errorTitle: string;
    uriHint?: string;
    resolveFolderFromWorkspace?: boolean;
    resolveFileFromEditor?: boolean;
    /** Active editor file when there is one, otherwise a workspace folder. */
    resolveFileOrWorkspace?: boolean;
    handler: (uri?: vscode.Uri) => Promise<void>;
}

const activeWorkspaceFile = (): vscode.Uri | undefined => {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    return activeUri?.scheme === 'file' && vscode.workspace.getWorkspaceFolder(activeUri)
        ? activeUri
        : undefined;
};

const resolveFileUri = async (uri?: vscode.Uri): Promise<vscode.Uri | undefined> => {
    if (uri) {
        return uri;
    }

    const activeUri = activeWorkspaceFile();
    if (activeUri) {
        return activeUri;
    }

    vscode.window.showWarningMessage(
        'Open a workspace file in the editor, or right-click a file in Explorer.',
    );
    return undefined;
};

const createCommands = (extensionUri: vscode.Uri): CommandDefinition[] => [
    {
        id: 'kyo-tools.initAiTemplate',
        errorTitle: 'Init AI Template failed',
        handler: async () => {
            await initAiTemplate();
        },
    },
    {
        id: 'code-dashboard.open',
        errorTitle: 'Failed to analyze folder',
        resolveFolderFromWorkspace: true,
        handler: async (uri) => {
            await openDashboard(uri!.fsPath, extensionUri);
        },
    },
    {
        id: 'kyo-tools.organizeImports',
        errorTitle: 'Organize imports failed',
        uriHint: 'Right-click a folder in Explorer and choose Organize Imports.',
        handler: async (uri) => {
            await organizeImportsInFolder(uri!);
        },
    },
    {
        id: 'kyo-tools.codeGraph',
        errorTitle: 'Failed to build code graph',
        resolveFileOrWorkspace: true,
        handler: async (uri) => {
            await openCodeGraph(uri!, extensionUri);
        },
    },
    {
        id: 'kyo-tools.codeAnalyze',
        errorTitle: 'Code analyze failed',
        resolveFolderFromWorkspace: true,
        handler: async (uri) => {
            await analyzeCodeInFolder(uri!);
        },
    },
    {
        id: 'kyo-tools.commitHeatmap',
        errorTitle: 'Commit heatmap failed',
        resolveFolderFromWorkspace: true,
        handler: async (uri) => {
            await openCommitHeatmap(uri!);
        },
    },
    {
        id: 'kyo-tools.copyFolderCode',
        errorTitle: 'Copy folder code failed',
        resolveFolderFromWorkspace: true,
        handler: async (uri) => {
            await copyFolderCode(uri!);
        },
    },
    {
        id: 'kyo-tools.copyFileWithDeps',
        errorTitle: 'Copy file with dependencies failed',
        resolveFileFromEditor: true,
        handler: async (uri) => {
            await copyFileWithDependencies(uri!);
        },
    },
    {
        id: 'kyo-tools.hotspots',
        errorTitle: 'Hotspots failed',
        resolveFolderFromWorkspace: true,
        handler: async (uri) => {
            await openHotspots(uri!, extensionUri);
        },
    },
];

const formatError = (error: unknown, fallback: string): string => {
    return error instanceof Error ? error.message : fallback;
};

const wrapHandler = (
    definition: CommandDefinition,
    extensionUri: vscode.Uri,
): ((...args: unknown[]) => Promise<void>) => {
    return async (...args: unknown[]) => {
        let uri = args[0] as vscode.Uri | undefined;

        if (definition.resolveFolderFromWorkspace && !uri) {
            uri = await resolveFolderUri();
            if (!uri) {
                return;
            }
        }

        if (definition.resolveFileOrWorkspace && !uri) {
            uri = activeWorkspaceFile() ?? (await resolveFolderUri());
            if (!uri) {
                return;
            }
        }

        if (definition.resolveFileFromEditor && !uri) {
            uri = await resolveFileUri();
            if (!uri) {
                return;
            }
        }

        if (definition.uriHint && !uri) {
            vscode.window.showWarningMessage(definition.uriHint);
            return;
        }

        try {
            await definition.handler(uri);
        } catch (error) {
            vscode.window.showErrorMessage(formatError(error, definition.errorTitle));
        }
    };
};

export const registerCommands = (context: vscode.ExtensionContext): void => {
    const extensionUri = context.extensionUri;

    for (const definition of createCommands(extensionUri)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(definition.id, wrapHandler(definition, extensionUri)),
        );
    }
};
