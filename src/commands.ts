import * as vscode from "vscode";
import { openDashboard } from "./features/dashboard";
import { openCodeGraph } from "./features/code-graph";
import { scanDeadCodeInFolder } from "./features/dead-code";
import { organizeImportsInFolder } from "./features/organize-imports";
import { initAiTemplate } from "./features/init-ai-template";

interface CommandDefinition {
  id: string;
  errorTitle: string;
  uriHint?: string;
  handler: (uri?: vscode.Uri) => Promise<void>;
}

const COMMANDS: CommandDefinition[] = [
  {
    id: "kyo-tools.initAiTemplate",
    errorTitle: "Init AI Template failed",
    handler: async () => {
      await initAiTemplate();
    },
  },
  {
    id: "code-dashboard.open",
    errorTitle: "Failed to analyze folder",
    uriHint: "Right-click a folder in Explorer and choose Code Dashboard.",
    handler: async (uri) => {
      await openDashboard(uri!.fsPath);
    },
  },
  {
    id: "kyo-tools.organizeImports",
    errorTitle: "Organize imports failed",
    uriHint: "Right-click a folder in Explorer and choose Organize Imports.",
    handler: async (uri) => {
      await organizeImportsInFolder(uri!);
    },
  },
  {
    id: "kyo-tools.codeGraph",
    errorTitle: "Failed to build code graph",
    uriHint: "Right-click a file in Explorer and choose Code Graph.",
    handler: async (uri) => {
      await openCodeGraph(uri!);
    },
  },
  {
    id: "kyo-tools.deadCode",
    errorTitle: "Dead code scan failed",
    uriHint: "Right-click a folder in Explorer and choose Dead Code Scan.",
    handler: async (uri) => {
      await scanDeadCodeInFolder(uri!);
    },
  },
];

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function wrapHandler(definition: CommandDefinition): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const uri = args[0] as vscode.Uri | undefined;

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
  for (const definition of COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(definition.id, wrapHandler(definition)),
    );
  }
}
