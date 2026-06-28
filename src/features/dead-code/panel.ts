import * as vscode from "vscode";
import { escapeHtml, isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import {
  panelContentStyles,
  panelDocument,
  reloadPanelScript,
  renderPanelHeader,
} from "../../shared/panel";
import { getPanelTheme } from "../../shared/theme";
import { DeadCodeReport } from "./types";

function rowDataAttrs(absolutePath: string, line = 0): string {
  return `data-path="${encodeURIComponent(absolutePath)}" data-line="${line}"`;
}

const reloadBtn = `<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>`;

function getLoadingHtml(folderName: string, isDark: boolean): string {
  const t = getPanelTheme(isDark);

  return panelDocument({
    title: "Dead Code",
    styles: panelContentStyles(t),
    body: `
      ${renderPanelHeader(
        `Dead Code — ${escapeHtml(folderName)}`,
        "Scanning…",
        reloadBtn,
      )}
      <div class="loading">
        <div class="spinner"></div>
        <h2>Building import graph</h2>
        <p>Analyzing unused files, orphan modules, and exports…</p>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        ${reloadPanelScript()}
      </script>
    `,
  });
}

function getReportHtml(report: DeadCodeReport, isDark: boolean): string {
  const t = getPanelTheme(isDark);
  const totalIssues =
    report.unusedFiles.length +
    report.orphanModules.length +
    report.unusedExports.length;
  const durationSec = (report.durationMs / 1000).toFixed(1);
  const bannerClass = totalIssues > 0 ? "warn" : "success";

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
      <button type="button" class="row" ${rowDataAttrs(item.absolutePath)}>
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
      <button type="button" class="row" ${rowDataAttrs(item.absolutePath, item.line ?? 0)}>
        <span class="path">${escapeHtml(item.relativePath)}</span>
        <span class="badge error">${escapeHtml(item.exportName)}</span>
        <span class="detail">${escapeHtml(item.kind)}</span>
      </button>`,
      )
      .join("");
  };

  const entryList =
    report.entryPoints.length > 0
      ? report.entryPoints
          .map(
            (entry) =>
              `<li><button type="button" class="entry-link" ${rowDataAttrs(entry.absolutePath)}>${escapeHtml(entry.relativePath)}</button></li>`,
          )
          .join("")
      : `<li class="muted">No entry points detected in this folder</li>`;

  return panelDocument({
    title: "Dead Code",
    styles: panelContentStyles(t),
    body: `
      ${renderPanelHeader(
        `Dead Code — ${escapeHtml(report.folderName)}`,
        `${report.scannedFiles} files scanned in ${durationSec}s`,
        reloadBtn,
      )}

      <div class="banner ${bannerClass}">
        ${totalIssues > 0 ? `${totalIssues} potential dead code item(s) found` : "No dead code detected in this folder"}
      </div>

      <div class="stats">
        <div class="stat-card warn">
          <div class="label">Unused files</div>
          <div class="value">${report.unusedFiles.length}</div>
        </div>
        <div class="stat-card warn">
          <div class="label">Orphan modules</div>
          <div class="value">${report.orphanModules.length}</div>
        </div>
        <div class="stat-card error">
          <div class="label">Unused exports</div>
          <div class="value">${report.unusedExports.length}</div>
        </div>
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
        Click any file row to open it in the editor. Unused export rows jump to the export line.
        Unused variables are not scanned — use ESLint <code>no-unused-vars</code> for that.
        Orphan modules are files not reachable from configured entry points via the import graph.
      </p>

      <script>
        const vscode = acquireVsCodeApi();

        function openFromElement(el) {
          const path = decodeURIComponent(el.dataset.path || "");
          const line = parseInt(el.dataset.line || "0", 10);
          if (path) {
            vscode.postMessage({ type: "open", path, line });
          }
        }

        document.querySelectorAll(".tab").forEach((tab) => {
          tab.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
            document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
          });
        });

        document.querySelectorAll(".row, .entry-link").forEach((el) => {
          el.addEventListener("click", () => openFromElement(el));
        });

        ${reloadPanelScript()}
      </script>
    `,
  });
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
        const line =
          typeof message.line === "number" && message.line > 0
            ? message.line
            : 0;
        await openFileInEditor(message.path, line);
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
      vscode.ViewColumn.One,
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
