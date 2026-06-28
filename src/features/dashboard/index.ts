import { execFileSync } from "child_process";
import * as vscode from "vscode";
import { isGitRepository } from "../../shared/gitignore";
import { isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import { getDashboardHtml, parseClocData } from "./cloc";
import { getGitChangeStats } from "./gitChanges";

let activePanel: vscode.WebviewPanel | undefined;

export async function openDashboard(
  folder: string,
  extensionUri: vscode.Uri,
): Promise<void> {
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
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
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
          const clocArgs = ["--json", "--by-file"];
          if (isGitRepository(folder)) {
            clocArgs.push("--vcs=git");
          } else {
            clocArgs.push("--exclude-dir=node_modules,dist,build,.git");
          }
          clocArgs.push(folder);

          const output = execFileSync("cloc", clocArgs, { encoding: "utf-8" });

          const raw = JSON.parse(output) as Record<string, unknown>;
          const gitChanges = getGitChangeStats(folder);
          const data = parseClocData(raw, folder, folderName, gitChanges);

          const chartScriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, "media", "chart.umd.min.js"),
          );

          panel.webview.html = getDashboardHtml(data, isDarkTheme(), {
            chartScriptUri: chartScriptUri.toString(),
            cspSource: panel.webview.cspSource,
          });
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
