import { escapeHtml } from '../../shared/html';
import {
    panelContentStyles,
    panelDocument,
    panelWebviewCsp,
    renderPanelHeader,
} from '../../shared/panel';
import { getPanelTheme, PanelTheme } from '../../shared/theme';
import { HotspotReport } from './metrics';

export const RANGE_MONTHS = [3, 6, 12] as const;
/** Rows/points beyond this are left out of the DOM and chart; the filter still searches all. */
const MAX_RENDERED = 300;
export const HOT_SCORE = 50;

export interface HotspotAssets {
    chartScriptUri: string;
    cspSource: string;
}

/** JSON safe to embed inside a <script> element. */
const embedJson = (value: unknown): string => {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
};

const hotspotStyles = (t: PanelTheme): string => `
    ${panelContentStyles(t)}

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }

    .controls label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${t.muted};
    }

    .controls select, .controls input {
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.text};
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.74rem;
      text-transform: none;
      letter-spacing: normal;
    }

    .controls input { min-width: 220px; }

    .controls select:focus-visible, .controls input:focus-visible {
      outline: 2px solid ${t.accent};
      outline-offset: 1px;
    }

    .stat-card .sub {
      font-size: 0.64rem;
      color: ${t.muted};
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: ${t.shadow};
      margin-bottom: 10px;
    }

    .card h2 {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${t.muted};
      margin-bottom: 8px;
      font-weight: 600;
    }

    .chart-wrap { position: relative; height: 260px; }

    .note { font-size: 0.66rem; color: ${t.muted}; margin-top: 6px; }

    .table-scroll { overflow-x: auto; }

    table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }

    th {
      text-align: right;
      font-weight: 600;
      color: ${t.muted};
      font-size: 0.64rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 6px;
      border-bottom: 1px solid ${t.border};
      white-space: nowrap;
    }

    th.left, td.left { text-align: left; }

    td {
      text-align: right;
      padding: 5px 6px;
      border-bottom: 1px solid ${t.border};
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    tr:hover td { background: ${t.surfaceHover}; }

    .file-link {
      color: ${t.text};
      cursor: pointer;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.7rem;
      max-width: 420px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: inline-block;
      vertical-align: bottom;
    }

    .file-link:hover { color: ${t.accent}; text-decoration: underline; }

    .score { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

    .score-track {
      width: 70px;
      height: 6px;
      border-radius: 3px;
      background: ${t.barTrack};
      overflow: hidden;
    }

    .score-fill { height: 100%; border-radius: 3px; }
    .score-fill.hot { background: ${t.error}; }
    .score-fill.warm { background: ${t.warn}; }
    .score-fill.cool { background: ${t.accent}; }

    .copy-btn { padding: 2px 8px; font-size: 0.66rem; }

    .empty { color: ${t.muted}; font-size: 0.75rem; padding: 12px 0; text-align: center; }
`;

const renderStats = (report: HotspotReport): string => {
    const hot = report.items.filter((item) => item.score >= HOT_SCORE).length;
    const top = report.items[0];
    const totalCommits = report.items.reduce((sum, item) => sum + item.commits, 0);
    return `
  <div class="stats">
    <div class="stat-card highlight">
      <div class="label">Files changed</div>
      <div class="value">${report.items.length.toLocaleString()}</div>
      <div class="sub">last ${report.months} months</div>
    </div>
    <div class="stat-card ${hot > 0 ? 'error' : 'success'}">
      <div class="label">Hotspots</div>
      <div class="value">${hot}</div>
      <div class="sub">score ≥ ${HOT_SCORE}</div>
    </div>
    <div class="stat-card">
      <div class="label">File commits</div>
      <div class="value">${totalCommits.toLocaleString()}</div>
      <div class="sub">${report.repoCount} repo(s)</div>
    </div>
    <div class="stat-card warn">
      <div class="label">Top hotspot</div>
      <div class="value" style="font-size:0.8rem">${top ? escapeHtml(top.relativePath.split('/').pop() ?? '') : '—'}</div>
      <div class="sub">${top ? escapeHtml(top.relativePath) : 'no changes in range'}</div>
    </div>
  </div>`;
};

export const getHotspotsHtml = (
    report: HotspotReport,
    isDark: boolean,
    assets: HotspotAssets,
): string => {
    const t = getPanelTheme(isDark);
    const reloadBtn = `<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>`;
    const rangeOptions = RANGE_MONTHS.map(
        (months) =>
            `<option value="${months}"${months === report.months ? ' selected' : ''}>Last ${months} months</option>`,
    ).join('');
    const notes: string[] = [];
    if (report.skippedCount > 0) {
        notes.push(`${report.skippedCount} changed file(s) skipped (deleted, too large or unreadable).`);
    }
    if (report.failedRepos.length > 0) {
        notes.push(`Could not read: ${report.failedRepos.join(', ')}.`);
    }

    const payload = {
        items: report.items.map((item) => ({
            p: item.relativePath,
            a: item.absolutePath,
            s: item.score,
            c: item.commits,
            l: item.linesChanged,
            au: item.authors,
            loc: item.loc,
            cx: item.complexity,
            fn: item.maxFunctionLoc,
        })),
        colors: { hot: t.error, warm: t.warn, cool: t.accent, grid: t.border, text: t.muted },
        maxRendered: MAX_RENDERED,
        hotScore: HOT_SCORE,
    };

    return panelDocument({
        title: 'Hotspots',
        csp: panelWebviewCsp(assets.cspSource),
        styles: hotspotStyles(t),
        body: `
  ${renderPanelHeader('Hotspots', escapeHtml(report.folderName), reloadBtn)}

  <div class="controls">
    <label>Range <select id="range">${rangeOptions}</select></label>
    <label>Filter <input id="filter" type="search" placeholder="path contains…"></label>
  </div>

  ${renderStats(report)}

  <div class="card">
    <h2>Churn vs complexity</h2>
    <div class="chart-wrap"><canvas id="chart"></canvas></div>
    <p class="note">Each point is a file: right = changed more often, up = more decision points (if/loops/&&/…). Point size follows lines of code. Top-right is where refactoring pays off most. Click a point to open the file.</p>
  </div>

  <div class="card">
    <h2>Ranking</h2>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="left">File</th>
            <th>Score</th>
            <th>Commits</th>
            <th>Lines changed</th>
            <th>Authors</th>
            <th>LOC</th>
            <th>Complexity</th>
            <th>Max fn</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="note" id="table-note">Score = commits × complexity, scaled so the hottest file is 100. ${escapeHtml(notes.join(' '))}</p>
  </div>

  <script src="${escapeHtml(assets.chartScriptUri)}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const data = ${embedJson(payload)};
    const rows = document.getElementById("rows");
    const filterInput = document.getElementById("filter");

    const level = (score) => score >= data.hotScore ? "hot" : score >= 25 ? "warm" : "cool";
    const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    const renderRows = () => {
      const query = filterInput.value.trim().toLowerCase();
      const matches = data.items
        .map((item, index) => ({ item, rank: index + 1 }))
        .filter(({ item }) => !query || item.p.toLowerCase().includes(query));
      const shown = matches.slice(0, data.maxRendered);

      if (shown.length === 0) {
        rows.innerHTML = '<tr><td colspan="10" class="empty">' +
          (data.items.length === 0 ? "No source files changed in this range." : "No files match the filter.") +
          "</td></tr>";
        return;
      }

      rows.innerHTML = shown.map(({ item, rank }) =>
        "<tr>" +
          "<td>" + rank + "</td>" +
          '<td class="left"><span class="file-link" data-index="' + (rank - 1) + '" title="' + esc(item.p) + '">' + esc(item.p) + "</span></td>" +
          '<td><div class="score"><div class="score-track"><div class="score-fill ' + level(item.s) + '" style="width:' + item.s + '%"></div></div>' + item.s + "</div></td>" +
          "<td>" + item.c + "</td>" +
          "<td>" + item.l.toLocaleString() + "</td>" +
          "<td>" + item.au + "</td>" +
          "<td>" + item.loc.toLocaleString() + "</td>" +
          "<td>" + item.cx + "</td>" +
          "<td>" + item.fn + "</td>" +
          '<td><button type="button" class="btn copy-btn" data-index="' + (rank - 1) + '">Copy for AI</button></td>' +
        "</tr>"
      ).join("") + (matches.length > shown.length
        ? '<tr><td colspan="10" class="empty">' + (matches.length - shown.length) + " more — refine the filter to see them.</td></tr>"
        : "");
    };

    rows.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.dataset.index) {
        return;
      }
      const item = data.items[Number(target.dataset.index)];
      if (!item) {
        return;
      }
      if (target.classList.contains("copy-btn")) {
        vscode.postMessage({ type: "copyAi", path: item.a });
      } else if (target.classList.contains("file-link")) {
        vscode.postMessage({ type: "open", path: item.a });
      }
    });

    filterInput.addEventListener("input", renderRows);

    document.getElementById("range").addEventListener("change", (event) => {
      vscode.postMessage({ type: "range", months: Number(event.target.value) });
    });

    document.getElementById("reload-btn").addEventListener("click", (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = "Reloading…";
      vscode.postMessage({ type: "reload" });
    });

    window.addEventListener("message", (event) => {
      if (event.data?.type !== "reloadDone") {
        return;
      }
      const btn = document.getElementById("reload-btn");
      btn.disabled = false;
      btn.textContent = "Reload";
    });

    renderRows();

    const plotted = data.items.slice(0, data.maxRendered);
    const maxLoc = Math.max(1, ...plotted.map((item) => item.loc));
    new Chart(document.getElementById("chart"), {
      type: "scatter",
      data: {
        datasets: [{
          data: plotted.map((item) => ({ x: item.c, y: item.cx })),
          pointRadius: plotted.map((item) => 3 + 9 * Math.sqrt(item.loc / maxLoc)),
          pointHoverRadius: plotted.map((item) => 5 + 9 * Math.sqrt(item.loc / maxLoc)),
          backgroundColor: plotted.map((item) => data.colors[level(item.s)] + "b3"),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = plotted[ctx.dataIndex];
                return item.p + " — score " + item.s + ", " + item.c + " commits, complexity " + item.cx;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Commits", color: data.colors.text },
            ticks: { color: data.colors.text, precision: 0 },
            grid: { color: data.colors.grid },
          },
          y: {
            title: { display: true, text: "Complexity", color: data.colors.text },
            ticks: { color: data.colors.text, precision: 0 },
            grid: { color: data.colors.grid },
          },
        },
        onClick: (_event, elements) => {
          const item = elements.length ? plotted[elements[0].index] : undefined;
          if (item) {
            vscode.postMessage({ type: "open", path: item.a });
          }
        },
      },
    });
  </script>`,
    });
};

export const getHotspotsLoadingHtml = (folderName: string, isDark: boolean): string => {
    const t = getPanelTheme(isDark);
    return panelDocument({
        title: 'Hotspots',
        styles: panelContentStyles(t),
        body: `
  ${renderPanelHeader('Hotspots', escapeHtml(folderName))}
  <div class="loading">
    <div class="spinner"></div>
    <h2>Measuring churn and complexity…</h2>
    <p>Reading git history and scanning changed files.</p>
  </div>`,
    });
};
