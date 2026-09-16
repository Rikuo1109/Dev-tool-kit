import * as vscode from 'vscode';
import { escapeHtml, isDarkTheme } from '../../shared/html';
import { openFileInEditor } from '../../shared/openInEditor';
import {
    panelContentStyles,
    panelDocument,
    reloadPanelScript,
    renderPanelHeader,
} from '../../shared/panel';
import { getPanelTheme, PanelTheme } from '../../shared/theme';
import { CodeAnalyzeReport, DuplicateGroup } from './types';

function rowDataAttrs(absolutePath: string, line = 0): string {
    return `data-path="${encodeURIComponent(absolutePath)}" data-line="${line}"`;
}

function buildDuplicateAiMessage(group: DuplicateGroup): string {
    const kindLabel =
        group.kind === 'exact'
            ? 'Exact duplicate'
            : 'Structural duplicate (same shape, different names/literals)';
    const locations = group.locations
        .map((loc) => `- ${loc.relativePath}:${loc.startLine}-${loc.endLine}`)
        .join('\n');

    return [
        'Please help refactor duplicated code in this codebase.',
        '',
        `Type: ${kindLabel}`,
        `Size: ${group.lineCount} lines across ${group.locations.length} locations`,
        '',
        'Locations:',
        locations,
        '',
        'Duplicated code preview:',
        '```',
        group.preview,
        '```',
        '',
        'Suggested approach:',
        group.suggestion,
        '',
        'Extract shared logic, update all locations to use it, and preserve existing behavior.',
    ].join('\n');
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

    .stats.six-up {
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    }

    .stat-card .value { font-size: 1rem; }

    .duplicate-card,
    .refactor-card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 8px 10px;
      margin-bottom: 8px;
      box-shadow: ${t.shadow};
    }

    .duplicate-head,
    .refactor-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .duplicate-preview,
    .refactor-tip {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.65rem;
      color: ${t.muted};
      background: ${t.bg};
      border: 1px solid ${t.border};
      border-radius: 6px;
      padding: 6px 8px;
      margin: 6px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .refactor-tip {
      font-family: inherit;
      color: ${t.text};
      background: ${t.accentSoft};
      border-color: transparent;
    }

    .loc-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .loc-btn {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.bg};
      color: ${t.text};
      border-radius: 6px;
      padding: 4px 8px;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.68rem;
      cursor: pointer;
      text-align: left;
    }

    .loc-btn:hover {
      background: ${t.surfaceHover};
      border-color: ${t.accent};
      color: ${t.accent};
    }

    .copy-ai-btn {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.bg};
      color: ${t.muted};
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 0.65rem;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      margin-left: auto;
    }

    .copy-ai-btn:hover {
      background: ${t.surfaceHover};
      border-color: ${t.accent};
      color: ${t.accent};
    }
  `;
}

function getLoadingHtml(folderName: string, isDark: boolean): string {
    const t = getPanelTheme(isDark);

    return panelDocument({
        title: 'Code Analyze',
        styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
        body: `
      ${renderPanelHeader(`Code Analyze — ${escapeHtml(folderName)}`, 'Scanning…', reloadBtn)}
      <div class="loading">
        <div class="spinner"></div>
        <h2>Analyzing codebase</h2>
        <p>Unused code, duplicates, and large files/functions…</p>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        ${reloadPanelScript()}
      </script>
    `,
    });
}

function getReportHtml(report: CodeAnalyzeReport, isDark: boolean): string {
    const t = getPanelTheme(isDark);
    const totalIssues =
        report.unusedFiles.length +
        report.orphanModules.length +
        report.unusedExports.length +
        report.duplicates.length +
        report.largeFiles.length +
        report.largeFunctions.length;
    const durationSec = (report.durationMs / 1000).toFixed(1);
    const bannerClass = totalIssues > 0 ? 'warn' : 'success';

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
        ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ''}
      </button>`,
            )
            .join('');
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
            .join('');
    };

    const renderDuplicateCards = () => {
        if (report.duplicates.length === 0) {
            return `<div class="empty">No duplicate blocks above threshold.</div>`;
        }
        return report.duplicates
            .map((group) => {
                const badgeClass = group.kind === 'exact' ? 'error' : 'warn';
                const locations = group.locations
                    .map(
                        (loc) => `
          <button type="button" class="loc-btn" ${rowDataAttrs(loc.absolutePath, loc.startLine)}>
            ${escapeHtml(loc.relativePath)}:${loc.startLine}-${loc.endLine}
          </button>`,
                    )
                    .join('');
                return `
        <article class="duplicate-card">
          <div class="duplicate-head">
            <span class="badge ${badgeClass}">${group.kind}</span>
            <span class="detail">${group.lineCount} lines · ${group.locations.length} locations</span>
            <button type="button" class="copy-ai-btn" data-copy="${encodeURIComponent(buildDuplicateAiMessage(group))}">Copy for AI</button>
          </div>
          <pre class="duplicate-preview">${escapeHtml(group.preview)}</pre>
          <div class="loc-list">${locations}</div>
          <p class="refactor-tip">${escapeHtml(group.suggestion)}</p>
        </article>`;
            })
            .join('');
    };

    const renderLargeFileRows = () => {
        if (report.largeFiles.length === 0) {
            return `<div class="empty">No oversized files.</div>`;
        }
        return report.largeFiles
            .map(
                (item) => `
      <article class="refactor-card">
        <div class="refactor-head">
          <button type="button" class="loc-btn" ${rowDataAttrs(item.absolutePath)}>
            ${escapeHtml(item.relativePath)}
          </button>
          <span class="badge warn">${item.loc} LOC</span>
        </div>
        <p class="refactor-tip">${escapeHtml(item.suggestion)}</p>
      </article>`,
            )
            .join('');
    };

    const renderLargeFunctionRows = () => {
        if (report.largeFunctions.length === 0) {
            return `<div class="empty">No oversized functions.</div>`;
        }
        return report.largeFunctions
            .map(
                (item) => `
      <article class="refactor-card">
        <div class="refactor-head">
          <button type="button" class="loc-btn" ${rowDataAttrs(item.absolutePath, item.startLine)}>
            ${escapeHtml(item.relativePath)} — ${escapeHtml(item.name)}()
          </button>
          <span class="badge warn">${item.loc} lines</span>
          <span class="detail">${item.paramCount} params</span>
        </div>
        <p class="refactor-tip">${escapeHtml(item.suggestion)}</p>
      </article>`,
            )
            .join('');
    };

    return panelDocument({
        title: 'Code Analyze',
        styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
        body: `
      <div class="sticky-chrome">
        ${renderPanelHeader(
            `Code Analyze — ${escapeHtml(report.folderName)}`,
            `${report.scannedFiles} files scanned in ${durationSec}s`,
            reloadBtn,
        )}

        <div class="banner ${bannerClass}">
          ${totalIssues > 0 ? `${totalIssues} issue(s) found — review tabs below` : 'No issues detected in this folder'}
        </div>

        <div class="stats six-up">
          <div class="stat-card warn">
            <div class="label">Unused files</div>
            <div class="value">${report.unusedFiles.length}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Orphans</div>
            <div class="value">${report.orphanModules.length}</div>
          </div>
          <div class="stat-card error">
            <div class="label">Unused exports</div>
            <div class="value">${report.unusedExports.length}</div>
          </div>
          <div class="stat-card error">
            <div class="label">Duplicates</div>
            <div class="value">${report.duplicates.length}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Large files</div>
            <div class="value">${report.largeFiles.length}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Large functions</div>
            <div class="value">${report.largeFunctions.length}</div>
          </div>
        </div>

        <div class="tabs">
          <button type="button" class="tab active" data-tab="unused-files">Unused (${report.unusedFiles.length})</button>
          <button type="button" class="tab" data-tab="orphans">Orphans (${report.orphanModules.length})</button>
          <button type="button" class="tab" data-tab="exports">Exports (${report.unusedExports.length})</button>
          <button type="button" class="tab" data-tab="duplicates">Duplicates (${report.duplicates.length})</button>
          <button type="button" class="tab" data-tab="large-files">Large files (${report.largeFiles.length})</button>
          <button type="button" class="tab" data-tab="large-functions">Large fn (${report.largeFunctions.length})</button>
        </div>
      </div>

      <div class="panel active" id="panel-unused-files">
        <div class="list">${renderFileRows(report.unusedFiles, 'No unused files found.')}</div>
      </div>
      <div class="panel" id="panel-orphans">
        <div class="list">${renderFileRows(report.orphanModules, 'No orphan modules found.')}</div>
      </div>
      <div class="panel" id="panel-exports">
        <div class="list">${renderExportRows()}</div>
      </div>
      <div class="panel" id="panel-duplicates">
        ${renderDuplicateCards()}
      </div>
      <div class="panel" id="panel-large-files">
        ${renderLargeFileRows()}
      </div>
      <div class="panel" id="panel-large-functions">
        ${renderLargeFunctionRows()}
      </div>

      <p class="note">
        Click rows to open files. Duplicates distinguish <strong>exact</strong> (same text) vs
        <strong>structural</strong> (same shape, different names/literals). Configure thresholds in
        <code>kyo-tools.codeAnalyze</code> settings.
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

        document.querySelectorAll(".row, .loc-btn").forEach((el) => {
          el.addEventListener("click", () => openFromElement(el));
        });

        document.querySelectorAll(".copy-ai-btn").forEach((btn) => {
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            const text = decodeURIComponent(btn.dataset.copy || "");
            if (text) {
              vscode.postMessage({ type: "copy", text });
            }
          });
        });

        ${reloadPanelScript()}
      </script>
    `,
    });
}

export class CodeAnalyzePanel {
    private readonly panel: vscode.WebviewPanel;
    private reloadHandler: (() => void | Promise<void>) | undefined;

    private constructor(panel: vscode.WebviewPanel, folderName: string, isDark: boolean) {
        this.panel = panel;
        this.panel.webview.html = getLoadingHtml(folderName, isDark);
        this.panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'open' && typeof message.path === 'string') {
                const line =
                    typeof message.line === 'number' && message.line > 0 ? message.line : 0;
                await openFileInEditor(message.path, line);
                return;
            }

            if (message.type === 'copy' && typeof message.text === 'string') {
                await vscode.env.clipboard.writeText(message.text);
                void vscode.window.showInformationMessage('Copied duplicate prompt for AI');
                return;
            }

            if (message.type === 'reload' && this.reloadHandler) {
                await this.reloadHandler();
            }
        });
    }

    static open(folderName: string, isDark: boolean): CodeAnalyzePanel {
        const panel = vscode.window.createWebviewPanel(
            'kyoToolsCodeAnalyze',
            `Code Analyze — ${folderName}`,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true },
        );

        return new CodeAnalyzePanel(panel, folderName, isDark);
    }

    bindFolder(_uri: vscode.Uri, onReload: () => void | Promise<void>): void {
        this.reloadHandler = onReload;
    }

    showLoading(folderName: string): void {
        this.panel.webview.html = getLoadingHtml(folderName, isDarkTheme());
        this.panel.title = `Code Analyze — ${folderName}`;
    }

    showReport(report: CodeAnalyzeReport): void {
        this.panel.webview.html = getReportHtml(report, isDarkTheme());
        this.panel.title = `Code Analyze — ${report.folderName}`;
    }

    dispose(): void {
        this.panel.dispose();
    }
}
