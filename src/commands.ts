import * as vscode from 'vscode';
import { analyzeCodeInFolder } from './features/code-analyze';
import { openCodeGraph } from './features/code-graph';
import { openDashboard } from './features/dashboard';
import { initAiTemplate } from './features/init-ai-template';
import { organizeImportsInFolder } from './features/organize-imports';
import { resolveFolderUri } from './shared/resolveUri';

interface CommandDefinition {
    id: string;
    errorTitle: string;
    uriHint?: string;
    resolveFolderFromWorkspace?: boolean;
    resolveFileFromEditor?: boolean;
    handler: (uri?: vscode.Uri) => Promise<void>;
}

async function resolveFileUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (uri) {
        return uri;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const activeUri = activeEditor?.document.uri;
    if (activeUri?.scheme === 'file' && vscode.workspace.getWorkspaceFolder(activeUri)) {
        return activeUri;
    }

    vscode.window.showWarningMessage(
        'Open a workspace file in the editor, or right-click a file in Explorer and choose Code Graph.',
    );
    return undefined;
}

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
        resolveFileFromEditor: true,
        handler: async (uri) => {
            await openCodeGraph(uri!);
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
];

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function wrapHandler(
    definition: CommandDefinition,
    extensionUri: vscode.Uri,
): (...args: unknown[]) => Promise<void> {
    return async (...args: unknown[]) => {
        let uri = args[0] as vscode.Uri | undefined;

        if (definition.resolveFolderFromWorkspace && !uri) {
            uri = await resolveFolderUri();
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
}

export function registerCommands(context: vscode.ExtensionContext): void {
    const extensionUri = context.extensionUri;

    for (const definition of createCommands(extensionUri)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(definition.id, wrapHandler(definition, extensionUri)),
        );
    }
}
