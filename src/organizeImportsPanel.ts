import * as vscode from "vscode";

export interface FileOrganizeResult {
  relativePath: string;
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

interface Theme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  error: string;
  errorSoft: string;
  barTrack: string;
  shadow: string;
}

function getTheme(isDark: boolean): Theme {
  return isDark
    ? {
        bg: "#0f1117",
        surface: "#181b24",
        border: "#2a3142",
        text: "#e8eaef",
        muted: "#8b93a7",
        accent: "#6366f1",
        accentSoft: "rgba(99, 102, 241, 0.15)",
        success: "#22c55e",
        successSoft: "rgba(34, 197, 94, 0.15)",
        warn: "#f59e0b",
        warnSoft: "rgba(245, 158, 11, 0.15)",
        error: "#ef4444",
        errorSoft: "rgba(239, 68, 68, 0.15)",
        barTrack: "#252a38",
        shadow: "0 8px 32px rgba(0,0,0,0.35)",
      }
    : {
        bg: "#f4f6fb",
        surface: "#ffffff",
        border: "#e2e6ef",
        text: "#1a1d26",
        muted: "#5c6478",
        accent: "#4f46e5",
        accentSoft: "rgba(79, 70, 229, 0.1)",
        success: "#16a34a",
        successSoft: "rgba(22, 163, 74, 0.1)",
        warn: "#d97706",
        warnSoft: "rgba(217, 119, 6, 0.1)",
        error: "#dc2626",
        errorSoft: "rgba(220, 38, 38, 0.1)",
        barTrack: "#eef1f7",
        shadow: "0 8px 32px rgba(15, 23, 42, 0.08)",
      };
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
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "cancel") {
        this.cancelSource.cancel();
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
      vscode.ViewColumn.Beside,
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
  const t = getTheme(isDark);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Organize Imports</title>
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

    .header { margin-bottom: 24px; }
    .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .header p { color: ${t.muted}; font-size: 0.9rem; margin-top: 4px; }

    .banner {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 20px;
      font-size: 0.9rem;
      font-weight: 500;
    }

    .banner.running { display: flex; background: ${t.accentSoft}; color: ${t.accent}; }
    .banner.success { display: flex; background: ${t.successSoft}; color: ${t.success}; }
    .banner.warn { display: flex; background: ${t.warnSoft}; color: ${t.warn}; }
    .banner.error { display: flex; background: ${t.errorSoft}; color: ${t.error}; }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

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

    .stat.updated .value { color: ${t.success}; }
    .stat.failed .value { color: ${t.error}; }
    .stat.progress-stat .value { color: ${t.accent}; }

    .progress-section {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 20px;
      box-shadow: ${t.shadow};
    }

    .progress-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      font-size: 0.85rem;
    }

    .progress-top .pct { color: ${t.muted}; font-variant-numeric: tabular-nums; }

    .bar-track {
      height: 8px;
      background: ${t.barTrack};
      border-radius: 99px;
      overflow: hidden;
      margin-bottom: 10px;
    }

    .bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, ${t.accent}, #818cf8);
      border-radius: 99px;
      transition: width 0.2s ease;
    }

    .current-file {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.8rem;
      color: ${t.muted};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions { margin-bottom: 20px; }

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
    .btn.cancel { color: ${t.error}; border-color: ${t.errorSoft}; }
    .btn.cancel:hover { background: ${t.errorSoft}; }

    .btn.hidden { display: none; }

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

    .file-list {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 12px;
      overflow: hidden;
      box-shadow: ${t.shadow};
      max-height: 420px;
      overflow-y: auto;
    }

    .file-item {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid ${t.border};
      font-size: 0.82rem;
      align-items: start;
    }

    .file-item:last-child { border-bottom: none; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .badge.updated { background: ${t.successSoft}; color: ${t.success}; }
    .badge.unchanged { background: ${t.barTrack}; color: ${t.muted}; }
    .badge.failed { background: ${t.errorSoft}; color: ${t.error}; }

    .file-path {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      word-break: break-all;
    }

    .file-error {
      grid-column: 2;
      color: ${t.error};
      font-size: 0.76rem;
      margin-top: 2px;
    }

    .empty {
      padding: 28px;
      text-align: center;
      color: ${t.muted};
      font-size: 0.9rem;
    }

    .meta {
      margin-top: 16px;
      font-size: 0.8rem;
      color: ${t.muted};
    }

    .error-summary {
      display: none;
      background: ${t.errorSoft};
      border: 1px solid ${t.error};
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 16px;
    }

    .error-summary.visible { display: block; }

    .error-summary h3 {
      font-size: 0.85rem;
      color: ${t.error};
      margin-bottom: 10px;
    }

    .error-summary-item {
      font-size: 0.8rem;
      color: ${t.text};
      padding: 6px 0;
      border-top: 1px solid ${t.border};
    }

    .error-summary-item:first-of-type { border-top: none; }

    .error-summary-item strong {
      color: ${t.error};
      font-variant-numeric: tabular-nums;
    }

    .results { display: none; }
    .results.visible { display: block; }
  </style>
</head>
<body>
  <header class="header">
    <h1>Organize Imports</h1>
    <p id="folder-name"></p>
  </header>

  <div id="banner" class="banner running">
    <span class="spinner" id="spinner"></span>
    <span id="banner-text">Preparing…</span>
  </div>

  <div class="stats">
    <div class="stat progress-stat">
      <div class="label">Progress</div>
      <div class="value" id="stat-progress">0 / ${total}</div>
    </div>
    <div class="stat updated">
      <div class="label">Updated</div>
      <div class="value" id="stat-updated">0</div>
    </div>
    <div class="stat">
      <div class="label">Unchanged</div>
      <div class="value" id="stat-unchanged">0</div>
    </div>
    <div class="stat failed">
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
        return '<div class="file-item">' +
          '<span class="badge ' + file.status + '">' + file.status + '</span>' +
          '<div><div class="file-path">' + escapeHtml(file.relativePath) + '</div>' +
          errorHtml + '</div></div>';
      }).join("");
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
  </script>
</body>
</html>`;
}
