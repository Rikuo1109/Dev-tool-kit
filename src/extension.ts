import * as vscode from "vscode";
import { execFileSync } from "child_process";
import { getDashboardHtml, parseClocData } from "./dashboard";

export function activate(context: vscode.ExtensionContext) {
  const cmd = vscode.commands.registerCommand(
    "code-dashboard.open",
    async (uri?: vscode.Uri) => {
      if (!uri) {
        vscode.window.showWarningMessage(
          "Right-click a folder in Explorer and choose Code Dashboard.",
        );
        return;
      }

      await openDashboard(uri.fsPath);
    },
  );

  context.subscriptions.push(cmd);
}

async function openDashboard(folder: string) {
  const folderName = folder.split(/[/\\]/).pop() ?? folder;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing ${folderName}…`,
        cancellable: false,
      },
      async () => {
        const output = execFileSync(
          "cloc",
          [
            folder,
            "--json",
            "--by-file",
            "--exclude-dir=node_modules,dist,build,.git",
          ],
          { encoding: "utf-8" },
        );

        const raw = JSON.parse(output) as Record<string, unknown>;
        const data = parseClocData(raw, folder, folderName);
        const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;

        const panel = vscode.window.createWebviewPanel(
          "codeDashboard",
          `Code Dashboard — ${folderName}`,
          vscode.ViewColumn.One,
          { enableScripts: true },
        );

        panel.webview.html = getDashboardHtml(data, isDark);
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze folder";
    vscode.window.showErrorMessage(message);
  }
}
