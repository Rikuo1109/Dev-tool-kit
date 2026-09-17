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
import { CodeAnalyzeReport, DeadBucket, DeadItem, PRIMARY_BUCKETS } from './types';

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
        report.largeFiles.length +
        report.largeFunctions.length +
        report.deadFiles.length +
        report.deadClasses.length +
        report.deadFunctions.length +
        report.deadConstants.length;
    const durationSec = (report.durationMs / 1000).toFixed(1);
    const bannerClass = totalIssues > 0 ? 'warn' : 'success';

    const noiseItems = report.allDeadFiles.filter(
        (item) => !PRIMARY_BUCKETS.includes(item.bucket ?? 'unknown'),
    );

    const entriesNote =
        report.discoveredEntries.length > 0
            ? `Entries: ${report.discoveredEntries.slice(0, 8).map(escapeHtml).join(', ')}${
                  report.discoveredEntries.length > 8 ? '…' : ''
              }`
            : 'Entries: (none discovered beyond analyze globs)';

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

    const renderDeadFileRows = (items: DeadItem[], emptyMsg: string): string => {
        if (items.length === 0) {
            return `<div class="empty">${emptyMsg}</div>`;
        }
        return items
            .map((item) => {
                const bucket = item.bucket ?? 'unknown';
                const confidence = item.confidence ?? 'medium';
                return `
    <button type="button" class="row" ${rowDataAttrs(item.absolutePath, item.line ?? 0)} data-bucket="${bucket}">
      <span class="path">${escapeHtml(item.relativePath)}</span>
      ${item.name ? `<span class="badge error">${escapeHtml(item.name)}</span>` : ''}
      <div class="row-meta">
        <span class="badge bucket-${bucket}">${escapeHtml(bucket)}</span>
        <span class="badge conf-${confidence}">${escapeHtml(confidence)}</span>
        ${item.reason ? `<span class="detail">${escapeHtml(item.reason)}</span>` : ''}
        ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ''}
        ${
            item.falsePositiveHint
                ? `<span class="hint">${escapeHtml(item.falsePositiveHint)}</span>`
                : ''
        }
      </div>
    </button>`;
            })
            .join('');
    };

    const renderDeadRows = (items: DeadItem[], emptyMsg: string): string => {
        if (items.length === 0) {
            return `<div class="empty">${emptyMsg}</div>`;
        }
        return items
            .map(
                (item) => `
    <button type="button" class="row" ${rowDataAttrs(item.absolutePath, item.line ?? 0)}>
      <span class="path">${escapeHtml(item.relativePath)}</span>
      ${item.name ? `<span class="badge error">${escapeHtml(item.name)}</span>` : ''}
      ${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ''}
    </button>`,
            )
            .join('');
    };

    const bucketPills = (): string => {
        const order: DeadBucket[] = [
            'dead',
            'likely-dead',
            'runtime',
            'entry',
            'tooling',
            'ambient',
            'vendor',
            'unknown',
        ];
        return order
            .map((bucket) => {
                const count = report.filesSummary.byBucket[bucket];
                if (!count) {
                    return '';
                }
                return `<span class="summary-pill">${bucket}: ${count}</span>`;
            })
            .filter(Boolean)
            .join('');
    };

    const tabs: Array<{ id: string; label: string; count: number }> = [
        { id: 'unused-files', label: 'Unused files', count: report.unusedFiles.length },
        { id: 'orphans', label: 'Orphans', count: report.orphanModules.length },
        { id: 'exports', label: 'Exports', count: report.unusedExports.length },
        { id: 'large-files', label: 'Large files', count: report.largeFiles.length },
        { id: 'large-functions', label: 'Large fn', count: report.largeFunctions.length },
        { id: 'files', label: 'Files', count: report.deadFiles.length },
        { id: 'classes', label: 'Classes', count: report.deadClasses.length },
        { id: 'functions', label: 'Functions', count: report.deadFunctions.length },
        { id: 'constants', label: 'Constants', count: report.deadConstants.length },
    ];

    return panelDocument({
        title: 'Code Analyze',
        styles: `${panelContentStyles(t)}${panelExtraStyles(t)}`,
        body: `
      <div class="sticky-chrome">
        ${renderPanelHeader(
            `Code Analyze — ${escapeHtml(report.folderName)}`,
            `${report.scannedFiles} files scanned in ${durationSec}s · ${escapeHtml(entriesNote)}`,
            reloadBtn,
        )}

        <div class="banner ${bannerClass}">
          ${totalIssues > 0 ? `${totalIssues} issue(s) found — review tabs below` : 'No issues detected in this folder'}
        </div>

        <div class="summary-bar">
          <span class="summary-pill noise">Files noise (vendor/tooling/…): ${report.filesSummary.noisePercent}% (${report.filesSummary.noiseCount}/${report.filesSummary.totalClassified})</span>
          <span class="summary-pill">Primary files: ${report.filesSummary.primaryCount}</span>
          ${bucketPills()}
        </div>

        <div class="stats seven-up">
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
          <div class="stat-card warn">
            <div class="label">Large files</div>
            <div class="value">${report.largeFiles.length}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Large functions</div>
            <div class="value">${report.largeFunctions.length}</div>
          </div>
          <div class="stat-card warn">
            <div class="label">Dead files</div>
            <div class="value">${report.deadFiles.length}</div>
          </div>
          <div class="stat-card error">
            <div class="label">Dead exports</div>
            <div class="value">${report.deadClasses.length + report.deadFunctions.length + report.deadConstants.length}</div>
          </div>
        </div>

        <div class="tabs">
          ${tabs
              .map(
                  (tab, i) =>
                      `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-tab="${tab.id}">${tab.label} (${tab.count})</button>`,
              )
              .join('')}
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
      <div class="panel" id="panel-large-files">
        ${renderLargeFileRows()}
      </div>
      <div class="panel" id="panel-large-functions">
        ${renderLargeFunctionRows()}
      </div>
      <div class="panel" id="panel-files">
        <div class="filter-row">
          <label><input type="checkbox" id="show-noise" /> Show noise buckets (${noiseItems.length})</label>
        </div>
        <div class="list" id="primary-files-list">${renderDeadFileRows(report.deadFiles, 'No primary dead files.')}</div>
        <div class="noise-panel" id="noise-files-list">
          <h3 class="section-title" style="margin:10px 0 6px;font-size:0.8rem">Noise / classified-out</h3>
          <div class="list">${renderDeadFileRows(noiseItems, 'No noise items.')}</div>
        </div>
      </div>
      <div class="panel" id="panel-classes">
        <div class="list">${renderDeadRows(report.deadClasses, 'No dead classes found.')}</div>
      </div>
      <div class="panel" id="panel-functions">
        <div class="list">${renderDeadRows(report.deadFunctions, 'No dead functions found.')}</div>
      </div>
      <div class="panel" id="panel-constants">
        <div class="list">${renderDeadRows(report.deadConstants, 'No dead constants found.')}</div>
      </div>


      <p class="note">
        Click rows to open files. Configure thresholds in
        <code>kyo-tools.codeAnalyze</code> and <code>kyo-tools.deadCodeExplorer</code> settings.
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
