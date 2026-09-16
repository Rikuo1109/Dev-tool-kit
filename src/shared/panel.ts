import { escapeHtml } from './html';
import { PanelTheme } from './theme';

const PANEL_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';";

export const PANEL_CSP_CDN =
    "default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src https://cdn.jsdelivr.net 'unsafe-inline'; img-src data:;";

export function panelWebviewCsp(cspSource: string) {
    return `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; img-src data:;`;
}

export interface PanelDocumentOptions {
    title: string;
    csp?: string;
    styles: string;
    body: string;
    bodyClass?: string;
    bodyExtra?: string;
}

export function panelDocument(options: PanelDocumentOptions) {
    const bodyAttrs = [
        options.bodyClass ? `class="${options.bodyClass}"` : '',
        options.bodyExtra ? `style="${options.bodyExtra}"` : '',
    ]
        .filter(Boolean)
        .join(' ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${options.csp ?? PANEL_CSP}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
    ${options.styles}
  </style>
</head>
<body ${bodyAttrs}>
  ${options.body}
</body>
</html>`;
}

function panelBaseStyles(t: PanelTheme, options: { padding?: string; minHeight?: string } = {}) {
    const padding = options.padding ?? '10px 12px';
    const minHeight = options.minHeight ?? '100vh';

    return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${t.bg};
      color: ${t.text};
      line-height: 1.45;
      padding: ${padding};
      min-height: ${minHeight};
    }
  `;
}

function panelHeaderStyles(t: PanelTheme) {
    return `
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .header-main { min-width: 0; flex: 1; }

    .header h1 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .header p {
      color: ${t.muted};
      font-size: 0.72rem;
      margin-top: 1px;
    }
  `;
}

export function panelToolbarBtnStyles(t: PanelTheme) {
    return `
    .toolbar-btn,
    .btn {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.text};
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .toolbar-btn:hover:not(:disabled),
    .btn:hover:not(:disabled) {
      background: ${t.surfaceHover};
      border-color: ${t.accent};
      color: ${t.accent};
    }

    .toolbar-btn:disabled,
    .btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .btn.cancel {
      color: ${t.error};
      border-color: ${t.errorSoft};
    }

    .btn.cancel:hover:not(:disabled) {
      background: ${t.errorSoft};
      color: ${t.error};
    }

    .btn.hidden { display: none; }
  `;
}

export function panelLoadingStyles(t: PanelTheme) {
    return `
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 100px);
      text-align: center;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid ${t.accentSoft};
      border-top-color: ${t.accent};
      border-radius: 50%;
      animation: panel-spin 0.8s linear infinite;
      margin: 0 auto 12px;
      flex-shrink: 0;
    }

    .spinner.inline {
      width: 16px;
      height: 16px;
      border-width: 2px;
      margin: 0;
    }

    @keyframes panel-spin { to { transform: rotate(360deg); } }

    .loading h2 { font-size: 1rem; margin-bottom: 6px; }
    .loading p { color: ${t.muted}; font-size: 0.75rem; }
  `;
}

function panelStatGridStyles(minWidth = '110px') {
    return `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(${minWidth}, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }
  `;
}

function panelStatCardStyles(t: PanelTheme) {
    return `
    .stat-card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 8px 10px;
      box-shadow: ${t.shadow};
    }

    .stat-card .label {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${t.muted};
      margin-bottom: 2px;
    }

    .stat-card .value {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .stat-card.highlight .value { color: ${t.accent}; }
    .stat-card.warn .value { color: ${t.warn}; }
    .stat-card.error .value { color: ${t.error}; }
    .stat-card.success .value,
    .stat-card.updated .value { color: ${t.success}; }
    .stat-card.progress-stat .value { color: ${t.accent}; }
    .stat-card.add .value { color: ${t.success}; }
    .stat-card.delete .value { color: ${t.error}; }
    .stat-card.net-positive .value { color: ${t.success}; }
    .stat-card.net-negative .value { color: ${t.error}; }
    .stat-card.net-zero .value { color: ${t.muted}; }
  `;
}

function panelBannerStyles(t: PanelTheme) {
    return `
    .banner {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      margin-bottom: 6px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .banner.visible,
    .banner.running,
    .banner.success,
    .banner.warn,
    .banner.error {
      display: flex;
    }

    .banner.running { background: ${t.accentSoft}; color: ${t.accent}; }
    .banner.success { background: ${t.successSoft}; color: ${t.success}; }
    .banner.warn { background: ${t.warnSoft}; color: ${t.warn}; }
    .banner.error { background: ${t.errorSoft}; color: ${t.error}; }
  `;
}

function panelTabsStyles(t: PanelTheme) {
    return `
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .tab {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.muted};
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
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
  `;
}

function panelListStyles(t: PanelTheme) {
    return `
    .list,
    .file-list {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      overflow: hidden;
      box-shadow: ${t.shadow};
    }

    .file-list {
      max-height: 360px;
      overflow-y: auto;
    }

    .row,
    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      padding: 6px 10px;
      border: none;
      border-bottom: 1px solid ${t.border};
      background: transparent;
      color: ${t.text};
      cursor: pointer;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.72rem;
    }

    .file-item {
      display: grid;
      grid-template-columns: 64px 1fr;
      align-items: start;
      font-family: inherit;
    }

    .row:last-child,
    .file-item:last-child { border-bottom: none; }

    .row:hover,
    .file-item:hover { background: ${t.barTrack}; }

    .row:focus-visible,
    .file-item:focus-visible {
      outline: 2px solid ${t.accent};
      outline-offset: -2px;
    }

    .path,
    .file-path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      word-break: break-all;
    }

    .file-path { white-space: normal; }

    .detail {
      color: ${t.muted};
      font-size: 0.65rem;
      flex-shrink: 0;
    }

    .file-error {
      grid-column: 2;
      color: ${t.error};
      font-size: 0.68rem;
      margin-top: 2px;
    }

    .empty {
      padding: 12px;
      text-align: center;
      color: ${t.muted};
      font-size: 0.75rem;
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
    }
  `;
}

function panelBadgeStyles(t: PanelTheme) {
    return `
    .badge {
      display: inline-block;
      font-size: 0.62rem;
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 600;
      flex-shrink: 0;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .badge.updated,
    .badge.success { background: ${t.successSoft}; color: ${t.success}; }
    .badge.unchanged { background: ${t.barTrack}; color: ${t.muted}; }
    .badge.failed,
    .badge.error { background: ${t.errorSoft}; color: ${t.error}; }
    .badge.warn { background: ${t.warnSoft}; color: ${t.warn}; }
  `;
}

function panelSectionStyles(t: PanelTheme) {
    return `
    .section-block { margin-bottom: 12px; }

    .section-block h2 {
      font-size: 0.82rem;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }

    .card {
      margin-top: 8px;
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 8px 10px;
      box-shadow: ${t.shadow};
    }

    .card h3 {
      font-size: 0.72rem;
      margin-bottom: 6px;
      color: ${t.muted};
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .note,
    .meta {
      margin-top: 6px;
      font-size: 0.72rem;
      color: ${t.muted};
    }

    .note code {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.68rem;
    }

    .muted { color: ${t.muted}; }
  `;
}

function panelProgressStyles(t: PanelTheme) {
    return `
    .progress-section {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      box-shadow: ${t.shadow};
    }

    .progress-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 0.75rem;
    }

    .progress-top .pct {
      color: ${t.muted};
      font-variant-numeric: tabular-nums;
    }

    .bar-track {
      height: 6px;
      background: ${t.barTrack};
      border-radius: 99px;
      overflow: hidden;
      margin-bottom: 6px;
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
      font-size: 0.72rem;
      color: ${t.muted};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions { margin-bottom: 8px; }
  `;
}

export function panelCompactToolbarStyles(t: PanelTheme) {
    return `
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    body {
      display: flex;
      flex-direction: column;
      padding: 0;
      min-height: 0;
    }

    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 12px;
      border-bottom: 1px solid ${t.border};
      background: ${t.surface};
    }

    .toolbar-title {
      min-width: 0;
      flex: 1 1 160px;
    }

    .toolbar-title h1 {
      font-size: 0.88rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .toolbar-title p {
      color: ${t.muted};
      font-size: 0.68rem;
      margin-top: 1px;
      font-family: ui-monospace, Menlo, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .toolbar-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .chip {
      font-size: 0.65rem;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid ${t.border};
      background: ${t.bg};
      white-space: nowrap;
    }

    .chip strong { font-variant-numeric: tabular-nums; }
  `;
}

export function panelContentStyles(t: PanelTheme) {
    return [
        panelBaseStyles(t),
        panelHeaderStyles(t),
        panelToolbarBtnStyles(t),
        panelLoadingStyles(t),
        panelStatGridStyles(),
        panelStatCardStyles(t),
        panelBannerStyles(t),
        panelTabsStyles(t),
        panelListStyles(t),
        panelBadgeStyles(t),
        panelSectionStyles(t),
        panelProgressStyles(t),
    ].join('\n');
}

export function renderPanelHeader(title: string, subtitle: string, actionHtml = '') {
    return `
  <header class="header">
    <div class="header-main">
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </div>
    ${actionHtml}
  </header>`;
}

export function reloadPanelScript() {
    return `
    function bindReload() {
      const btn = document.getElementById("reload-btn");
      if (!btn) return;
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Reloading…";
        vscode.postMessage({ type: "reload" });
      });
    }
    bindReload();
  `;
}
