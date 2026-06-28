import * as vscode from "vscode";
import { isDarkTheme } from "../../shared/html";
import { openFileInEditor } from "../../shared/openInEditor";
import {
  panelContentStyles,
  panelDocument,
  renderPanelHeader,
} from "../../shared/panel";
import { getPanelTheme } from "../../shared/theme";

export interface FileOrganizeResult {
  relativePath: string;
  absolutePath: string;
  status: "updated" | "unchanged" | "failed";
  error?: string;
}

export interface OrganizeReport {
  folderName: string;
  total: number;
  updated: number;
  unchanged: number;
  failed: number;
  cancelled: boolean;
  files: FileOrganizeResult[];
  durationMs: number;
  errorSummary: { message: string; count: number }[];
}

export class OrganizeImportsPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly cancelSource = new vscode.CancellationTokenSource();

  private constructor(
    panel: vscode.WebviewPanel,
    folderName: string,
    total: number,
    isDark: boolean,
  ) {
    this.panel = panel;
    this.panel.webview.html = getPanelHtml(folderName, total, isDark);
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "cancel") {
        this.cancelSource.cancel();
        return;
      }

      if (message.type === "open" && typeof message.path === "string") {
        await openFileInEditor(message.path);
      }
    });
  }

  static open(
    folderName: string,
    total: number,
    isDark: boolean,
  ): OrganizeImportsPanel {
    const panel = vscode.window.createWebviewPanel(
      "kyoToolsOrganizeImports",
      `Organize Imports — ${folderName}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    return new OrganizeImportsPanel(panel, folderName, total, isDark);
  }

  get token(): vscode.CancellationToken {
    return this.cancelSource.token;
  }

  onProgress(state: {
    current: number;
    total: number;
    file: string;
    updated: number;
    unchanged: number;
    failed: number;
  }): void {
    this.panel.webview.postMessage({ type: "progress", ...state });
  }

  onComplete(report: OrganizeReport): void {
    this.panel.webview.postMessage({ type: "complete", report });
    this.panel.title = report.cancelled
      ? `Organize Imports — Cancelled`
      : `Organize Imports — Done`;
  }

  dispose(): void {
    this.panel.dispose();
    this.cancelSource.dispose();
  }
}

function getPanelHtml(
  folderName: string,
  total: number,
  isDark: boolean,
): string {
  const t = getPanelTheme(isDark);

  return panelDocument({
    title: "Organize Imports",
    styles: `
      ${panelContentStyles(t)}

      .error-summary {
        display: none;
        background: ${t.errorSoft};
        border: 1px solid ${t.error};
        border-radius: 10px;
        padding: 8px 10px;
        margin-bottom: 8px;
      }

      .error-summary.visible { display: block; }

      .error-summary h3 {
        font-size: 0.72rem;
        color: ${t.error};
        margin-bottom: 6px;
      }

      .error-summary-item {
        font-size: 0.72rem;
        color: ${t.text};
        padding: 4px 0;
        border-top: 1px solid ${t.border};
      }

      .error-summary-item:first-of-type { border-top: none; }

      .error-summary-item strong {
        color: ${t.error};
        font-variant-numeric: tabular-nums;
      }

      .results { display: none; }
      .results.visible { display: block; }
    `,
    body: `
  ${renderPanelHeader("Organize Imports", '<span id="folder-name"></span>')}

  <div id="banner" class="banner running">
    <span class="spinner inline" id="spinner"></span>
    <span id="banner-text">Preparing…</span>
  </div>

  <div class="stats">
    <div class="stat-card progress-stat">
      <div class="label">Progress</div>
      <div class="value" id="stat-progress">0 / ${total}</div>
    </div>
    <div class="stat-card updated">
      <div class="label">Updated</div>
      <div class="value" id="stat-updated">0</div>
    </div>
    <div class="stat-card">
      <div class="label">Unchanged</div>
      <div class="value" id="stat-unchanged">0</div>
    </div>
    <div class="stat-card error">
      <div class="label">Failed</div>
      <div class="value" id="stat-failed">0</div>
    </div>
  </div>

  <div class="progress-section" id="progress-section">
    <div class="progress-top">
      <span id="progress-label">Starting…</span>
      <span class="pct" id="progress-pct">0%</span>
    </div>
    <div class="bar-track"><div class="bar-fill" id="bar-fill"></div></div>
    <div class="current-file" id="current-file">—</div>
  </div>

  <div class="actions">
    <button class="btn cancel" id="cancel-btn">Cancel</button>
  </div>

  <div class="results" id="results">
    <div class="error-summary" id="error-summary">
      <h3>Error summary</h3>
      <div id="error-summary-list"></div>
    </div>
    <div class="tabs">
      <button class="tab active" data-filter="updated">Updated</button>
      <button class="tab" data-filter="unchanged">Unchanged</button>
      <button class="tab" data-filter="failed">Failed</button>
      <button class="tab" data-filter="all">All</button>
    </div>
    <div class="file-list" id="file-list"></div>
    <div class="meta" id="meta"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const totalFiles = ${total};
    const folderName = ${JSON.stringify(folderName)};
    let allFiles = [];
    let activeFilter = "updated";

    document.getElementById("folder-name").textContent = folderName;
    document.getElementById("cancel-btn").addEventListener("click", () => {
      vscode.postMessage({ type: "cancel" });
      document.getElementById("cancel-btn").disabled = true;
      document.getElementById("banner-text").textContent = "Cancelling…";
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        activeFilter = tab.dataset.filter;
        renderFileList();
      });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "progress") {
        updateProgress(msg);
      } else if (msg.type === "complete") {
        showResults(msg.report);
      }
    });

    function updateProgress(msg) {
      const pct = msg.total ? Math.round((msg.current / msg.total) * 100) : 0;
      document.getElementById("stat-progress").textContent = msg.current + " / " + msg.total;
      document.getElementById("stat-updated").textContent = msg.updated;
      document.getElementById("stat-unchanged").textContent = msg.unchanged;
      document.getElementById("stat-failed").textContent = msg.failed;
      document.getElementById("progress-label").textContent = "Processing files";
      document.getElementById("progress-pct").textContent = pct + "%";
      document.getElementById("bar-fill").style.width = pct + "%";
      document.getElementById("current-file").textContent = msg.file || "—";
      document.getElementById("banner-text").textContent =
        "Running — " + msg.current + " of " + msg.total + " files";
    }

    function showResults(report) {
      allFiles = report.files || [];
      document.getElementById("spinner").style.display = "none";
      document.getElementById("cancel-btn").classList.add("hidden");
      document.getElementById("progress-section").style.display = "none";
      document.getElementById("results").classList.add("visible");

      const banner = document.getElementById("banner");
      banner.classList.remove("running", "success", "warn", "error");

      if (report.cancelled) {
        banner.classList.add("warn");
        document.getElementById("banner-text").textContent =
          "Cancelled — " + report.updated + " file(s) updated before stop";
      } else if (report.failed > 0) {
        banner.classList.add("error");
        document.getElementById("banner-text").textContent =
          "Completed with " + report.failed + " error(s)";
      } else if (report.updated > 0) {
        banner.classList.add("success");
        document.getElementById("banner-text").textContent =
          "Done — " + report.updated + " file(s) updated";
      } else {
        banner.classList.add("success");
        document.getElementById("banner-text").textContent =
          "Done — no files needed changes";
      }

      document.getElementById("stat-progress").textContent = report.total + " / " + report.total;
      document.getElementById("stat-updated").textContent = report.updated;
      document.getElementById("stat-unchanged").textContent = report.unchanged;
      document.getElementById("stat-failed").textContent = report.failed;
      document.getElementById("bar-fill").style.width = "100%";

      const seconds = (report.durationMs / 1000).toFixed(1);
      document.getElementById("meta").textContent =
        "Finished in " + seconds + "s · " + report.total + " files scanned";

      renderErrorSummary(report.errorSummary || []);
      setDefaultTab(report);
      renderFileList();
    }

    function renderErrorSummary(summary) {
      const box = document.getElementById("error-summary");
      const list = document.getElementById("error-summary-list");

      if (!summary.length) {
        box.classList.remove("visible");
        list.innerHTML = "";
        return;
      }

      box.classList.add("visible");
      list.innerHTML = summary.map((item) =>
        '<div class="error-summary-item"><strong>' + item.count + '×</strong> ' +
        escapeHtml(item.message) + '</div>'
      ).join("");
    }

    function setDefaultTab(report) {
      let filter = "updated";
      if (report.failed > 0) {
        filter = "failed";
      } else if (report.updated === 0 && report.unchanged > 0) {
        filter = "unchanged";
      } else if (report.updated === 0) {
        filter = "all";
      }

      activeFilter = filter;
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.filter === filter);
      });
    }

    function renderFileList() {
      const list = document.getElementById("file-list");
      const filtered = activeFilter === "all"
        ? allFiles
        : allFiles.filter((f) => f.status === activeFilter);

      if (!filtered.length) {
        list.innerHTML = '<div class="empty">No files in this category.</div>';
        return;
      }

      list.innerHTML = filtered.map((file) => {
        const errorHtml = file.error
          ? '<div class="file-error">' + escapeHtml(file.error) + '</div>'
          : "";
        return '<button type="button" class="file-item" data-path="' +
          encodeURIComponent(file.absolutePath) + '">' +
          '<span class="badge ' + file.status + '">' + file.status + '</span>' +
          '<div><div class="file-path">' + escapeHtml(file.relativePath) + '</div>' +
          errorHtml + '</div></button>';
      }).join("");

      list.querySelectorAll(".file-item").forEach((item) => {
        item.addEventListener("click", () => {
          const path = decodeURIComponent(item.dataset.path || "");
          if (path) {
            vscode.postMessage({ type: "open", path });
          }
        });
      });
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
  </script>
    `,
  });
}
