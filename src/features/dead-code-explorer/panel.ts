import * as vscode from "vscode";
import { escapeHtml, isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import {
  panelContentStyles,
  panelDocument,
  reloadPanelScript,
  renderPanelHeader,
} from "../../shared/panel";
import { getPanelTheme, PanelTheme } from "../../shared/theme";
import { DeadCodeReport, DeadItem } from "./types";

function rowDataAttrs(absolutePath: string, line = 0): string {
  return `data-path="${encodeURIComponent(absolutePath)}" data-line="${line}"`;
}

const reloadBtn = `<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>`;

function panelExtraStyles(t: PanelTheme): string {
  return `
    .sticky-chrome {
      position: sticky;
      top: 0;
      z-index: 10;
      background: ${t.bg};
      margin: -10px -12px 8px;
      padding: 10px 12px 4px;
      border-bottom: 1px solid ${t.border};
    }

    .stats.seven-up {
      grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    }

    .stat-card .value { font-size: 1rem; }

    .note {
      margin-top: 12px;
      font-size: 0.72rem;
      color: ${t.muted};
    }
  `;
}

function renderRows(items: DeadItem[], emptyMsg: string): string {
  if (items.length === 0) {
    return `<div class="empty">${emptyMsg}</div>`;
  }
  return items
    .map(
      (item) => `
    <button type="button" class="row" ${rowDataAttrs(item.absolutePath, item.line ?? 0)}>
      <span class="path">${escapeHtml(item.relativePath)}</span>
      ${item.name ? `<span class="badge error">${escapeHtml(item.name)}</span>` : ""}
      ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ""}
    </button>`,
    )
    .join("");
}

function getLoadingHtml(folderName: string, isDark: boolean): string {
  const t = getPanelTheme(isDark);

  return panelDocument({
    title: "Dead Code Explorer",
    styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
    body: `
      ${renderPanelHeader(
        `Dead Code Explorer — ${escapeHtml(folderName)}`,
        "Scanning…",
        reloadBtn,
      )}
      <div class="loading">
        <div class="spinner"></div>
        <h2>Exploring dead code</h2>
        <p>Files, exports, routes, APIs, and CSS…</p>
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
  const total =
    report.deadFiles.length +
    report.deadClasses.length +
    report.deadFunctions.length +
    report.deadConstants.length +
    report.deadRoutes.length +
    report.deadApis.length +
    report.deadCss.length;
  const durationSec = (report.durationMs / 1000).toFixed(1);
  const bannerClass = total > 0 ? "warn" : "success";

  const tabs: Array<{ id: string; label: string; count: number }> = [
    { id: "files", label: "Files", count: report.deadFiles.length },
    { id: "classes", label: "Classes", count: report.deadClasses.length },
    { id: "functions", label: "Functions", count: report.deadFunctions.length },
    { id: "constants", label: "Constants", count: report.deadConstants.length },
    { id: "routes", label: "Routes", count: report.deadRoutes.length },
    { id: "apis", label: "API", count: report.deadApis.length },
    { id: "css", label: "CSS", count: report.deadCss.length },
  ];

  return panelDocument({
    title: "Dead Code Explorer",
    styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
    body: `
      <div class="sticky-chrome">
        ${renderPanelHeader(
          `Dead Code Explorer — ${escapeHtml(report.folderName)}`,
          `${report.scannedFiles} files scanned in ${durationSec}s`,
          reloadBtn,
        )}

        <div class="banner ${bannerClass}">
          ${total > 0 ? `${total} dead item(s) — review tabs below` : "No dead items detected in this folder"}
        </div>

        <div class="stats seven-up">
          <div class="stat-card warn"><div class="label">Files</div><div class="value">${report.deadFiles.length}</div></div>
          <div class="stat-card error"><div class="label">Classes</div><div class="value">${report.deadClasses.length}</div></div>
          <div class="stat-card error"><div class="label">Functions</div><div class="value">${report.deadFunctions.length}</div></div>
          <div class="stat-card error"><div class="label">Constants</div><div class="value">${report.deadConstants.length}</div></div>
          <div class="stat-card warn"><div class="label">Routes</div><div class="value">${report.deadRoutes.length}</div></div>
          <div class="stat-card warn"><div class="label">API</div><div class="value">${report.deadApis.length}</div></div>
          <div class="stat-card warn"><div class="label">CSS</div><div class="value">${report.deadCss.length}</div></div>
        </div>

        <div class="tabs">
          ${tabs
            .map(
              (tab, i) =>
                `<button type="button" class="tab${i === 0 ? " active" : ""}" data-tab="${tab.id}">${tab.label} (${tab.count})</button>`,
            )
            .join("")}
        </div>
      </div>

      <div class="panel active" id="panel-files">
        <div class="list">${renderRows(report.deadFiles, "No dead files found.")}</div>
      </div>
      <div class="panel" id="panel-classes">
        <div class="list">${renderRows(report.deadClasses, "No dead classes found.")}</div>
      </div>
      <div class="panel" id="panel-functions">
        <div class="list">${renderRows(report.deadFunctions, "No dead functions found.")}</div>
      </div>
      <div class="panel" id="panel-constants">
        <div class="list">${renderRows(report.deadConstants, "No dead constants found.")}</div>
      </div>
      <div class="panel" id="panel-routes">
        <div class="list">${renderRows(report.deadRoutes, "No dead routes found.")}</div>
      </div>
      <div class="panel" id="panel-apis">
        <div class="list">${renderRows(report.deadApis, "No dead APIs found.")}</div>
      </div>
      <div class="panel" id="panel-css">
        <div class="list">${renderRows(report.deadCss, "No dead CSS classes found.")}</div>
      </div>

      <p class="note">
        Heuristic scan — may false-positive dynamic routes, CSS modules, and string-built URLs.
        Files/exports reuse Code Analyze import graph. Click rows to open.
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

        document.querySelectorAll(".row").forEach((el) => {
          el.addEventListener("click", () => openFromElement(el));
        });

        ${reloadPanelScript()}
      </script>
    `,
  });
}

export class DeadCodeExplorerPanel {
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

  static open(folderName: string, isDark: boolean): DeadCodeExplorerPanel {
    const panel = vscode.window.createWebviewPanel(
      "kyoToolsDeadCodeExplorer",
      `Dead Code Explorer — ${folderName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    return new DeadCodeExplorerPanel(panel, folderName, isDark);
  }

  bindFolder(_uri: vscode.Uri, onReload: () => void | Promise<void>): void {
    this.reloadHandler = onReload;
  }

  showLoading(folderName: string): void {
    this.panel.webview.html = getLoadingHtml(folderName, isDarkTheme());
    this.panel.title = `Dead Code Explorer — ${folderName}`;
  }

  showReport(report: DeadCodeReport): void {
    this.panel.webview.html = getReportHtml(report, isDarkTheme());
    this.panel.title = `Dead Code Explorer — ${report.folderName}`;
  }

  dispose(): void {
    this.panel.dispose();
  }
}
