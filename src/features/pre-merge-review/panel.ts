import * as vscode from 'vscode';
import { escapeHtml, isDarkTheme } from '../../shared/html';
import { openFileInEditor } from '../../shared/openInEditor';
import { panelContentStyles, panelDocument, renderPanelHeader } from '../../shared/panel';
import { getPanelTheme, PanelTheme } from '../../shared/theme';
import { PreMergeReviewReport, ReviewIssue } from './types';

function rowDataAttrs(absolutePath: string, line = 0): string {
    return `data-path="${encodeURIComponent(absolutePath)}" data-line="${line}"`;
}

const toolbarBtns = `
  <button type="button" class="toolbar-btn" id="change-branch-btn">Compare with…</button>
  <button type="button" class="toolbar-btn" id="reload-btn">Reload</button>
`;

function panelToolbarScript(): string {
    return `
    function bindToolbar() {
      const reloadBtn = document.getElementById("reload-btn");
      if (reloadBtn) {
        reloadBtn.addEventListener("click", () => {
          reloadBtn.disabled = true;
          reloadBtn.textContent = "Reloading…";
          vscode.postMessage({ type: "reload" });
        });
      }

      const changeBtn = document.getElementById("change-branch-btn");
      if (changeBtn) {
        changeBtn.addEventListener("click", () => {
          changeBtn.disabled = true;
          vscode.postMessage({ type: "changeBranch" });
        });
      }
    }
    bindToolbar();
  `;
}

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

    .stats.four-up {
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    }

    .file-card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 8px 10px;
      margin-bottom: 8px;
      box-shadow: ${t.shadow};
    }

    .file-head {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.72rem;
      font-weight: 600;
      margin-bottom: 6px;
      word-break: break-word;
    }

    .issue-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      width: 100%;
      text-align: left;
      padding: 6px 0;
      border: none;
      border-top: 1px solid ${t.border};
      background: transparent;
      color: ${t.text};
      cursor: pointer;
    }

    .issue-row:first-of-type { border-top: none; }

    .issue-row:hover {
      color: ${t.accent};
    }

    .issue-meta {
      font-size: 0.68rem;
      color: ${t.muted};
      min-width: 52px;
    }

    .issue-text {
      font-size: 0.72rem;
      flex: 1;
    }
  `;
}

function severityBadge(severity: ReviewIssue['severity']): string {
    if (severity === 'critical') {
        return 'error';
    }
    if (severity === 'warning') {
        return 'warn';
    }
    return 'unchanged';
}

function branchSubtitle(currentBranch: string, compareBranch: string): string {
    return `Current: ${currentBranch} · Compare with: ${compareBranch}`;
}

function renderFileCards(report: PreMergeReviewReport): string {
    if (report.issues.length === 0) {
        return `<div class="empty">No issues found between ${escapeHtml(report.currentBranch)} and ${escapeHtml(report.compareBranch)}.</div>`;
    }

    const byFile = new Map<string, ReviewIssue[]>();
    for (const issue of report.issues) {
        const list = byFile.get(issue.relativePath) ?? [];
        list.push(issue);
        byFile.set(issue.relativePath, list);
    }

    return [...byFile.entries()]
        .map(
            ([relativePath, issues]) => `
      <article class="file-card">
        <div class="file-head">${escapeHtml(relativePath)}</div>
        ${issues
            .map(
                (issue) => `
          <button type="button" class="issue-row" ${rowDataAttrs(issue.absolutePath, issue.line)}>
            <span class="badge ${severityBadge(issue.severity)}">${issue.severity}</span>
            <span class="issue-meta">${escapeHtml(issue.category)} · L${issue.line}</span>
            <span class="issue-text">${escapeHtml(issue.message)}</span>
          </button>`,
            )
            .join('')}
      </article>`,
        )
        .join('');
}

function getLoadingHtml(currentBranch: string, compareBranch: string, isDark: boolean): string {
    const t = getPanelTheme(isDark);
    return panelDocument({
        title: 'Pre-Merge Review',
        styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
        body: `
      ${renderPanelHeader(
          `Pre-Merge Review — ${escapeHtml(currentBranch)}`,
          `Comparing with ${escapeHtml(compareBranch)}…`,
          toolbarBtns,
      )}
      <div class="loading">
        <div class="spinner"></div>
        <h2>Reviewing branch diff</h2>
        <p>Scanning added/changed lines only…</p>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        ${panelToolbarScript()}
      </script>
    `,
    });
}

function getReportHtml(report: PreMergeReviewReport, isDark: boolean): string {
    const t = getPanelTheme(isDark);
    const critical = report.issues.filter((issue) => issue.severity === 'critical').length;
    const warning = report.issues.filter((issue) => issue.severity === 'warning').length;
    const info = report.issues.filter((issue) => issue.severity === 'info').length;
    const durationSec = (report.durationMs / 1000).toFixed(1);
    const bannerClass =
        critical > 0
            ? 'error'
            : warning > 0
              ? 'warn'
              : report.issues.length > 0
                ? 'warn'
                : 'success';

    return panelDocument({
        title: 'Pre-Merge Review',
        styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
        body: `
      <div class="sticky-chrome">
        ${renderPanelHeader(
            `Pre-Merge Review — ${escapeHtml(report.currentBranch)}`,
            `${report.scannedFiles} file(s) · ${branchSubtitle(report.currentBranch, report.compareBranch)} · ${durationSec}s`,
            toolbarBtns,
        )}

        <div class="banner ${bannerClass}">
          ${
              report.issues.length > 0
                  ? `${report.issues.length} issue(s) in diff — review before merge`
                  : 'Diff looks clean — no issues detected'
          }
        </div>

        <div class="stats four-up">
          <div class="stat-card error">
            <div class="label">Critical</div>
            <div class="value">${critical}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Warning</div>
            <div class="value">${warning}</div>
          </div>
          <div class="stat-card highlight">
            <div class="label">Info</div>
            <div class="value">${info}</div>
          </div>
          <div class="stat-card">
            <div class="label">Files</div>
            <div class="value">${report.scannedFiles}</div>
          </div>
        </div>
      </div>

      ${renderFileCards(report)}

      <p class="note">Diff-only scan between <code>${escapeHtml(report.currentBranch)}</code> and <code>${escapeHtml(report.compareBranch)}</code> (since merge-base). Click an issue to jump to file and line.</p>

      <script>
        const vscode = acquireVsCodeApi();

        function openFromElement(el) {
          const path = decodeURIComponent(el.dataset.path || "");
          const line = parseInt(el.dataset.line || "0", 10);
          if (path) {
            vscode.postMessage({ type: "open", path, line });
          }
        }

        document.querySelectorAll(".issue-row").forEach((el) => {
          el.addEventListener("click", () => openFromElement(el));
        });

        ${panelToolbarScript()}
      </script>
    `,
    });
}

export class PreMergeReviewPanel {
    private readonly panel: vscode.WebviewPanel;
    private reloadHandler: (() => void | Promise<void>) | undefined;
    private changeBranchHandler: (() => void | Promise<void>) | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        currentBranch: string,
        compareBranch: string,
        isDark: boolean,
    ) {
        this.panel = panel;
        this.panel.webview.html = getLoadingHtml(currentBranch, compareBranch, isDark);
        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'open' && typeof message.path === 'string') {
                const line =
                    typeof message.line === 'number' && message.line > 0 ? message.line : 0;
                await openFileInEditor(message.path, line);
                return;
            }

            if (message.type === 'reload' && this.reloadHandler) {
                await this.reloadHandler();
                return;
            }

            if (message.type === 'changeBranch' && this.changeBranchHandler) {
                await this.changeBranchHandler();
            }
        });
    }

    static open(
        currentBranch: string,
        compareBranch: string,
        isDark: boolean,
    ): PreMergeReviewPanel {
        const panel = vscode.window.createWebviewPanel(
            'kyoToolsPreMergeReview',
            `Pre-Merge Review — ${currentBranch}`,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        return new PreMergeReviewPanel(panel, currentBranch, compareBranch, isDark);
    }

    bindReload(onReload: () => void | Promise<void>): void {
        this.reloadHandler = onReload;
    }

    bindChangeBranch(onChangeBranch: () => void | Promise<void>): void {
        this.changeBranchHandler = onChangeBranch;
    }

    showLoading(currentBranch: string, compareBranch: string): void {
        this.panel.webview.html = getLoadingHtml(currentBranch, compareBranch, isDarkTheme());
        this.panel.title = `Pre-Merge Review — ${currentBranch}`;
    }

    showReport(report: PreMergeReviewReport): void {
        this.panel.webview.html = getReportHtml(report, isDarkTheme());
        this.panel.title = `Pre-Merge Review — ${report.currentBranch}`;
    }

    dispose(): void {
        this.panel.dispose();
    }
}
