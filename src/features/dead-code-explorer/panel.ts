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
import {
  DeadBucket,
  DeadCodeReport,
  DeadItem,
  PRIMARY_BUCKETS,
} from "./types";

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

    .summary-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 8px;
      font-size: 0.68rem;
      color: ${t.muted};
    }

    .summary-pill {
      border: 1px solid ${t.border};
      background: ${t.surface};
      border-radius: 999px;
      padding: 2px 8px;
    }

    .summary-pill.noise {
      border-color: transparent;
      background: ${t.accentSoft};
      color: ${t.text};
    }

    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
      font-size: 0.68rem;
    }

    .filter-row label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: ${t.muted};
      cursor: pointer;
    }

    .row-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      width: 100%;
      margin-top: 2px;
    }

    .hint {
      font-size: 0.62rem;
      color: ${t.muted};
      font-style: italic;
    }

    .badge.bucket-dead { background: #dc262622; color: #dc2626; }
    .badge.bucket-likely-dead { background: #d9770622; color: #d97706; }
    .badge.bucket-runtime,
    .badge.bucket-entry { background: #2563eb22; color: #2563eb; }
    .badge.bucket-tooling,
    .badge.bucket-ambient,
    .badge.bucket-vendor,
    .badge.bucket-unknown { background: ${t.surfaceHover}; color: ${t.muted}; }

    .badge.conf-high { border: 1px solid #16a34a55; }
    .badge.conf-medium { border: 1px solid #d9770655; }
    .badge.conf-low { border: 1px solid #dc262655; }

    .noise-panel { display: none; }
    .noise-panel.visible { display: block; }

    .note {
      margin-top: 12px;
      font-size: 0.72rem;
      color: ${t.muted};
    }
  `;
}

function renderFileRows(items: DeadItem[], emptyMsg: string): string {
  if (items.length === 0) {
    return `<div class="empty">${emptyMsg}</div>`;
  }
  return items
    .map((item) => {
      const bucket = item.bucket ?? "unknown";
      const confidence = item.confidence ?? "medium";
      return `
    <button type="button" class="row" ${rowDataAttrs(item.absolutePath, item.line ?? 0)} data-bucket="${bucket}">
      <span class="path">${escapeHtml(item.relativePath)}</span>
      ${item.name ? `<span class="badge error">${escapeHtml(item.name)}</span>` : ""}
      <div class="row-meta">
        <span class="badge bucket-${bucket}">${escapeHtml(bucket)}</span>
        <span class="badge conf-${confidence}">${escapeHtml(confidence)}</span>
        ${item.reason ? `<span class="detail">${escapeHtml(item.reason)}</span>` : ""}
        ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ""}
        ${
          item.falsePositiveHint
            ? `<span class="hint">${escapeHtml(item.falsePositiveHint)}</span>`
            : ""
        }
      </div>
    </button>`;
    })
    .join("");
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
        <p>Entries, runtime assets, files, exports, routes, APIs, CSS…</p>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        ${reloadPanelScript()}
      </script>
    `,
  });
}

function bucketPills(report: DeadCodeReport): string {
  const order: DeadBucket[] = [
    "dead",
    "likely-dead",
    "runtime",
    "entry",
    "tooling",
    "ambient",
    "vendor",
    "unknown",
  ];
  return order
    .map((bucket) => {
      const count = report.filesSummary.byBucket[bucket];
      if (!count) {
        return "";
      }
      return `<span class="summary-pill">${bucket}: ${count}</span>`;
    })
    .filter(Boolean)
    .join("");
}

function getReportHtml(report: DeadCodeReport, isDark: boolean): string {
  const t = getPanelTheme(isDark);
  const primaryFileCount = report.deadFiles.length;
  const totalIssues =
    primaryFileCount +
    report.deadClasses.length +
    report.deadFunctions.length +
    report.deadConstants.length +
    report.deadRoutes.length +
    report.deadApis.length +
    report.deadCss.length;
  const durationSec = (report.durationMs / 1000).toFixed(1);
  const bannerClass = totalIssues > 0 ? "warn" : "success";
  const noiseItems = report.allDeadFiles.filter(
    (item) => !PRIMARY_BUCKETS.includes(item.bucket ?? "unknown"),
  );
  const entriesNote =
    report.discoveredEntries.length > 0
      ? `Entries: ${report.discoveredEntries.slice(0, 8).map(escapeHtml).join(", ")}${
          report.discoveredEntries.length > 8 ? "…" : ""
        }`
      : "Entries: (none discovered beyond analyze globs)";

  const tabs: Array<{ id: string; label: string; count: number }> = [
    { id: "files", label: "Files", count: primaryFileCount },
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
          `${report.scannedFiles} files scanned in ${durationSec}s · ${escapeHtml(entriesNote)}`,
          reloadBtn,
        )}

        <div class="banner ${bannerClass}">
          ${
            totalIssues > 0
              ? `${totalIssues} primary issue(s) — Files shows dead + likely-dead only`
              : "No primary dead items in this folder"
          }
        </div>

        <div class="summary-bar">
          <span class="summary-pill noise">Files noise (vendor/tooling/…): ${report.filesSummary.noisePercent}% (${report.filesSummary.noiseCount}/${report.filesSummary.totalClassified})</span>
          <span class="summary-pill">Primary files: ${report.filesSummary.primaryCount}</span>
          ${bucketPills(report)}
        </div>

        <div class="stats seven-up">
          <div class="stat-card warn"><div class="label">Files</div><div class="value">${primaryFileCount}</div></div>
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
        <div class="filter-row">
          <label><input type="checkbox" id="show-noise" /> Show noise buckets (${noiseItems.length})</label>
        </div>
        <div class="list" id="primary-files-list">${renderFileRows(report.deadFiles, "No primary dead files.")}</div>
        <div class="noise-panel" id="noise-files-list">
          <h3 class="section-title" style="margin:10px 0 6px;font-size:0.8rem">Noise / classified-out</h3>
          <div class="list">${renderFileRows(noiseItems, "No noise items.")}</div>
        </div>
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
        Precision-first Files scoring: multi-entry + public/runtime + ignore buckets.
        Residual blind spots: dynamic URL strings, server-only routes, hashed CSS modules.
        Configure <code>kyo-tools.deadCodeExplorer</code>.
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

        const noiseToggle = document.getElementById("show-noise");
        const noisePanel = document.getElementById("noise-files-list");
        if (noiseToggle && noisePanel) {
          noiseToggle.addEventListener("change", () => {
            noisePanel.classList.toggle("visible", noiseToggle.checked);
          });
        }

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
