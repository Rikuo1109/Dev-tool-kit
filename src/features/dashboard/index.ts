import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";
import * as vscode from "vscode";
import {
  isGitRepository,
  findGitRoot,
  filterGitIgnoredPaths,
} from "../../shared/gitignore";
import { isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import { getDashboardHtml, parseClocData } from "./cloc";
import { getGitChangeStats } from "./gitChanges";

let activePanel: vscode.WebviewPanel | undefined;

function countCodeLines(content: string): {
  code: number;
  blank: number;
  comment: number;
} {
  const lines = content.split("\n");
  let code = 0,
    blank = 0,
    comment = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Block comments
    if (trimmed.includes("/*")) {
      inBlockComment = true;
    }
    if (inBlockComment) {
      comment++;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    // Blank lines
    if (!trimmed) {
      blank++;
    } else if (trimmed.startsWith("//")) {
      comment++;
    } else {
      code++;
    }
  }

  return { code, blank, comment };
}

function countFilesInDir(
  dirPath: string,
  excludeDirs = new Set(["node_modules", "dist", "build", ".git"]),
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let totalFiles = 0;
  let totalCode = 0;
  let totalBlank = 0;
  let totalComment = 0;

  const isGit = isGitRepository(dirPath);
  const gitRoot = isGit ? findGitRoot(dirPath) : null;
  const filesToCheck: string[] = [];
  const compressedExts = new Set([
    ".zip",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".7z",
    ".rar",
    ".xz",
  ]);

  function walkDir(path: string) {
    try {
      const entries = readdirSync(path);
      for (const entry of entries) {
        if (entry.startsWith(".") && !isGit) {
          continue;
        }
        if (excludeDirs.has(entry)) {
          continue;
        }

        const fullPath = join(path, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else {
          filesToCheck.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  walkDir(dirPath);

  // Filter gitignore files if in a git repo
  const filesToProcess = gitRoot
    ? filterGitIgnoredPaths(gitRoot, filesToCheck)
    : filesToCheck;

  const langMap: Record<string, string> = {
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".jsx": "JavaScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".php": "PHP",
    ".css": "CSS",
    ".html": "HTML",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".md": "Markdown",
    ".sh": "Shell",
  };

  for (const fullPath of filesToProcess) {
    try {
      const ext = extname(fullPath).toLowerCase();
      if (compressedExts.has(ext)) {
        continue;
      }

      const lang = langMap[ext] || ext.slice(1).toUpperCase() || "Unknown";
      const content = readFileSync(fullPath, "utf-8");
      const counts = countCodeLines(content);

      result[fullPath] = {
        blank: counts.blank,
        comment: counts.comment,
        code: counts.code,
        language: lang,
      };

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

  return result;
}

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
          const raw = countFilesInDir(folder);
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
            error instanceof Error
              ? error.message
              : "Failed to reload dashboard";
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
