import * as vscode from "vscode";
import { escapeHtml, isDarkTheme } from "../../shared/html";
import { getPanelTheme } from "../../shared/theme";
import { DeadCodeReport } from "./types";

function getLoadingHtml(folderName: string, isDark: boolean): string {
  const t = getPanelTheme(isDark);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Code</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${t.bg};
      color: ${t.text};
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .loading {
      text-align: center;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid ${t.accentSoft};
      border-top-color: ${t.accent};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.2rem; margin-bottom: 8px; }
    p { color: ${t.muted}; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <h1>Scanning ${escapeHtml(folderName)}</h1>
    <p>Building import graph and analyzing exports…</p>
  </div>
</body>
</html>`;
}

function getReportHtml(report: DeadCodeReport, isDark: boolean): string {
  const t = getPanelTheme(isDark);
  const totalIssues =
    report.unusedFiles.length +
    report.orphanModules.length +
    report.unusedExports.length;
  const durationSec = (report.durationMs / 1000).toFixed(1);

  const renderFileRows = (
    items: { relativePath: string; absolutePath: string; detail?: string }[],
    emptyMsg: string,
  ) => {
    if (items.length === 0) {
      return `<div class="empty">${emptyMsg}</div>`;
    }
    return items
      .map(
        (item) => `
      <button type="button" class="row" data-path="${escapeHtml(item.absolutePath)}">
        <span class="path">${escapeHtml(item.relativePath)}</span>
        ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ""}
      </button>`,
      )
      .join("");
  };

  const renderExportRows = () => {
    if (report.unusedExports.length === 0) {
      return `<div class="empty">No unused exports found.</div>`;
    }
    return report.unusedExports
      .map(
        (item) => `
      <button type="button" class="row" data-path="${escapeHtml(item.absolutePath)}">
        <span class="path">${escapeHtml(item.relativePath)}</span>
        <span class="badge">${escapeHtml(item.exportName)}</span>
        <span class="detail">${escapeHtml(item.kind)}</span>
      </button>`,
      )
      .join("");
  };

  const entryList =
    report.entryPoints.length > 0
      ? report.entryPoints.map((ep) => `<li>${escapeHtml(ep)}</li>`).join("")
      : `<li class="muted">No entry points detected in this folder</li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Code</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${t.bg};
      color: ${t.text};
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }

    .header { margin-bottom: 20px; }
    .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .header p { color: ${t.muted}; font-size: 0.9rem; margin-top: 4px; }

    .banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 20px;
      font-size: 0.9rem;
      font-weight: 500;
      background: ${totalIssues > 0 ? t.warnSoft : t.successSoft};
      color: ${totalIssues > 0 ? t.warn : t.success};
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .stat {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: ${t.shadow};
    }

    .stat .label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${t.muted};
      margin-bottom: 4px;
    }

    .stat .value {
      font-size: 1.4rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .stat.warn .value { color: ${t.warn}; }
    .stat.error .value { color: ${t.error}; }

    .actions { margin-bottom: 16px; }

    .btn {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.text};
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .btn:hover { background: ${t.barTrack}; }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .tab {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.muted};
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .tab.active {
      background: ${t.accentSoft};
      color: ${t.accent};
      border-color: transparent;
      font-weight: 600;
    }

    .panel { display: none; }
    .panel.active { display: block; }

    .list {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 12px;
      overflow: hidden;
      box-shadow: ${t.shadow};
    }

    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 10px 14px;
      border: none;
      border-bottom: 1px solid ${t.border};
      background: transparent;
      color: ${t.text};
      cursor: pointer;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.8rem;
    }

    .row:last-child { border-bottom: none; }
    .row:hover { background: ${t.barTrack}; }

    .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .detail {
      color: ${t.muted};
      font-size: 0.72rem;
      flex-shrink: 0;
    }

    .badge {
      font-size: 0.72rem;
      padding: 2px 8px;
      border-radius: 999px;
      background: ${t.errorSoft};
      color: ${t.error};
      flex-shrink: 0;
    }

    .empty {
      padding: 24px;
      text-align: center;
      color: ${t.muted};
      font-size: 0.9rem;
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 12px;
    }

    .entry-section {
      margin-top: 20px;
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 12px;
      padding: 16px;
    }

    .entry-section h3 {
      font-size: 0.85rem;
      margin-bottom: 8px;
      color: ${t.muted};
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .entry-section ul {
      list-style: none;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.78rem;
    }

    .entry-section li { padding: 2px 0; }
    .entry-section li.muted { color: ${t.muted}; }

    .note {
      margin-top: 16px;
      font-size: 0.78rem;
      color: ${t.muted};
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Dead Code — ${escapeHtml(report.folderName)}</h1>
    <p>${report.scannedFiles} files scanned in ${durationSec}s</p>
  </div>

  <div class="banner">
    ${totalIssues > 0 ? `${totalIssues} potential dead code item(s) found` : "No dead code detected in this folder"}
  </div>

  <div class="stats">
    <div class="stat warn">
      <div class="label">Unused files</div>
      <div class="value">${report.unusedFiles.length}</div>
    </div>
    <div class="stat warn">
      <div class="label">Orphan modules</div>
      <div class="value">${report.orphanModules.length}</div>
    </div>
    <div class="stat error">
      <div class="label">Unused exports</div>
      <div class="value">${report.unusedExports.length}</div>
    </div>
  </div>

  <div class="actions">
    <button type="button" class="btn" id="reload">Reload scan</button>
  </div>

  <div class="tabs">
    <button type="button" class="tab active" data-tab="unused-files">Unused files (${report.unusedFiles.length})</button>
    <button type="button" class="tab" data-tab="orphans">Orphan modules (${report.orphanModules.length})</button>
    <button type="button" class="tab" data-tab="exports">Unused exports (${report.unusedExports.length})</button>
  </div>

  <div class="panel active" id="panel-unused-files">
    <div class="list">${renderFileRows(report.unusedFiles, "No unused files found.")}</div>
  </div>
  <div class="panel" id="panel-orphans">
    <div class="list">${renderFileRows(report.orphanModules, "No orphan modules found.")}</div>
  </div>
  <div class="panel" id="panel-exports">
    <div class="list">${renderExportRows()}</div>
  </div>

  <div class="entry-section">
    <h3>Entry points in folder</h3>
    <ul>${entryList}</ul>
  </div>

  <p class="note">
    Unused variables are not scanned — use ESLint <code>no-unused-vars</code> for that.
    Orphan modules are files not reachable from configured entry points via the import graph.
  </p>

  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
      });
    });

    document.querySelectorAll(".row").forEach((row) => {
      row.addEventListener("click", () => {
        const path = row.dataset.path;
        if (path) {
          vscode.postMessage({ type: "open", path });
        }
      });
    });

    document.getElementById("reload").addEventListener("click", () => {
      vscode.postMessage({ type: "reload" });
    });
  </script>
</body>
</html>`;
}

export class DeadCodePanel {
  private readonly panel: vscode.WebviewPanel;
  private reloadHandler: (() => void | Promise<void>) | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    folderName: string,
    isDark: boolean,
  ) {
    this.panel = panel;
    this.panel.webview.html = getLoadingHtml(folderName, isDark);
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "open" && typeof message.path === "string") {
        await vscode.window.showTextDocument(vscode.Uri.file(message.path), {
          preview: true,
        });
        return;
      }

      if (message.type === "reload" && this.reloadHandler) {
        await this.reloadHandler();
      }
    });
  }

  static open(folderName: string, isDark: boolean): DeadCodePanel {
    const panel = vscode.window.createWebviewPanel(
      "kyoToolsDeadCode",
      `Dead Code — ${folderName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    return new DeadCodePanel(panel, folderName, isDark);
  }

  bindFolder(_uri: vscode.Uri, onReload: () => void | Promise<void>): void {
    this.reloadHandler = onReload;
  }

  showLoading(folderName: string): void {
    this.panel.webview.html = getLoadingHtml(folderName, isDarkTheme());
    this.panel.title = `Dead Code — ${folderName}`;
  }

  showReport(report: DeadCodeReport): void {
    this.panel.webview.html = getReportHtml(report, isDarkTheme());
    this.panel.title = `Dead Code — ${report.folderName}`;
  }

  dispose(): void {
    this.panel.dispose();
  }
}
