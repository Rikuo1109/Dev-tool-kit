import { execFileSync } from "child_process";
import * as vscode from "vscode";
import { isDarkTheme } from "../../shared/html";
import { getDashboardHtml, parseClocData } from "./cloc";

export async function openDashboard(folder: string): Promise<void> {
  const folderName = folder.split(/[/\\]/).pop() ?? folder;

  try {
    const panel = vscode.window.createWebviewPanel(
      "codeDashboard",
      `Code Dashboard — ${folderName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const render = async () => {
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

          panel.webview.html = getDashboardHtml(data, isDarkTheme());
        },
      );
    };

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "open" && typeof message.path === "string") {
        const target = vscode.Uri.file(message.path);
        await vscode.window.showTextDocument(target, { preview: true });
        return;
      }

      if (message.type === "reload") {
        try {
          await render();
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : "Failed to reload dashboard";
          vscode.window.showErrorMessage(errMessage);
        }
      }
    });

    await render();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to analyze folder";
    vscode.window.showErrorMessage(message);
  }
}
