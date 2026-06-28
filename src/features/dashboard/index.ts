import { execFileSync } from "child_process";
import * as vscode from "vscode";
import { isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import { getDashboardHtml, parseClocData } from "./cloc";
import { getGitChangeStats } from "./gitChanges";

let activePanel: vscode.WebviewPanel | undefined;

export async function openDashboard(folder: string): Promise<void> {
  const folderName = folder.split(/[/\\]/).pop() ?? folder;

  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  try {
    const panel = vscode.window.createWebviewPanel(
      "codeDashboard",
      `Code Dashboard — ${folderName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
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
          const gitChanges = getGitChangeStats(folder);
          const data = parseClocData(raw, folder, folderName, gitChanges);

          panel.webview.html = getDashboardHtml(data, isDarkTheme());
        },
      );
    };

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "open" && typeof message.path === "string") {
        await openFileInEditor(message.path);
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
