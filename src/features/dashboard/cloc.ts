import { escapeHtml } from '../../shared/html';
import {
    panelContentStyles,
    panelDocument,
    panelWebviewCsp,
    renderPanelHeader,
} from '../../shared/panel';
import { getPanelTheme } from '../../shared/theme';
import { GitChangeAnalyzer, GitChangeStats } from './gitChanges';

interface ClocFileEntry {
    blank: number;
    comment: number;
    code: number;
    language: string;
}

export interface LangStat {
    name: string;
    nFiles: number;
    code: number;
    blank: number;
    comment: number;
}

export interface DashboardData {
    folderName: string;
    totalFiles: number;
    totalCode: number;
    totalBlank: number;
    totalComment: number;
    languages: LangStat[];
    gitChanges: GitChangeStats;
    subrepoCount: number;
}

const LANG_COLORS = [
    '#6366f1',
    '#22c55e',
    '#f59e0b',
    '#ef4444',
    '#06b6d4',
    '#a855f7',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#84cc16',
];

export const parseClocData = (
    raw: Record<string, unknown>,
    _folder: string,
    folderName: string,
    gitChanges: GitChangeStats,
    subrepoCount = 0,
): DashboardData => {
    const filesByLang = new Map<
        string,
        { nFiles: number; code: number; blank: number; comment: number }
    >();

    for (const [key, value] of Object.entries(raw)) {
        if (key === 'header' || key === 'SUM') {
            continue;
        }

        const entry = value as ClocFileEntry;
        const agg = filesByLang.get(entry.language) ?? {
            nFiles: 0,
            code: 0,
            blank: 0,
            comment: 0,
        };
        agg.nFiles += 1;
        agg.code += entry.code;
        agg.blank += entry.blank;
        agg.comment += entry.comment;
        filesByLang.set(entry.language, agg);
    }

    const languages: LangStat[] = [...filesByLang.entries()]
        .map(([name, agg]) => ({ name, ...agg }))
        .sort((a, b) => b.code - a.code);

    const sum = raw.SUM as {
        nFiles: number;
        code: number;
        blank: number;
        comment: number;
    };

    return {
        folderName,
        totalFiles: sum.nFiles,
        totalCode: sum.code,
        totalBlank: sum.blank,
        totalComment: sum.comment,
        languages,
        gitChanges,
        subrepoCount,
    };
};

export interface DashboardWebviewAssets {
    chartScriptUri: string;
    cspSource: string;
}

export const getDashboardHtml = (
    data: DashboardData,
    isDark: boolean,
    assets: DashboardWebviewAssets,
): string => {
    const theme = getPanelTheme(isDark);

    const chartColors = data.languages.map((_, i) => LANG_COLORS[i % LANG_COLORS.length]);

    const git = data.gitChanges;
    const netClass = (net: number) =>
        net > 0 ? 'net-positive' : net < 0 ? 'net-negative' : 'net-zero';
    const formatDelta = (value: number) => `${value >= 0 ? '+' : ''}${value.toLocaleString()}`;

    const subrepoCard =
        data.subrepoCount > 0
            ? `<div class="stat-card subrepo">
        <div class="label">Subrepos</div>
        <div class="value">${data.subrepoCount}</div>
      </div>`
            : '';

    const uncommittedFiles = git.uncommittedFiles ?? [];
    const uncommittedTable =
        uncommittedFiles.length > 0
            ? `
    <div class="uncommitted-card">
      <h3 class="uncommitted-title">Uncommitted files</h3>
      <table class="top-files uncommitted-files">
        <thead>
          <tr>
            <th>File</th>
            <th class="col-code">+</th>
            <th class="col-other">−</th>
            <th class="col-other">Net</th>
          </tr>
        </thead>
        <tbody>
          ${uncommittedFiles
              .map(
                  (file) => `
          <tr>
            <td class="file-path">
              <button type="button" class="file-link" data-path="${escapeHtml(file.absolutePath)}" title="${escapeHtml(file.relativePath)}">${escapeHtml(file.relativePath)}</button>
            </td>
            <td class="num col-code add-num">+${file.added.toLocaleString()}</td>
            <td class="num col-other delete-num">−${file.deleted.toLocaleString()}</td>
            <td class="num col-other ${netClass(file.net)}">${formatDelta(file.net)}</td>
          </tr>`,
              )
              .join('')}
        </tbody>
      </table>
    </div>`
            : git.uncommittedNet === 0
              ? `<div class="uncommitted-empty">Working tree clean — no staged or unstaged line changes.</div>`
              : '';

    const gitSection = git.available
        ? `
  <section class="section-block">
    <div class="stats">
      <div class="stat-card add">
        <div class="label">Added today</div>
        <div class="value">+${git.today.added.toLocaleString()}</div>
      </div>
      <div class="stat-card delete">
        <div class="label">Deleted today</div>
        <div class="value">−${git.today.deleted.toLocaleString()}</div>
      </div>
      <div class="stat-card ${netClass(git.today.net)}">
        <div class="label">Net today</div>
        <div class="value">${formatDelta(git.today.net)}</div>
      </div>
      <div class="stat-card ${netClass(git.uncommittedNet)}">
        <div class="label">Net uncommitted</div>
        <div class="value">${formatDelta(git.uncommittedNet)}</div>
      </div>
    </div>

    ${uncommittedTable}

    <div class="git-chart-card">
      <div class="git-chart-wrap">
        <canvas id="git-chart"></canvas>
      </div>
      <p class="git-chart-note">Committed lines from <code>git log --numstat</code> scoped to this folder. Net uncommitted = index + working tree (staged + unstaged diff).${data.subrepoCount > 0 ? ` Includes ${data.subrepoCount} subrepo(s).` : ''}</p>
    </div>
  </section>`
        : `
  <section class="section-block">
    <h2>Git activity</h2>
    <div class="git-unavailable">${escapeHtml(git.message ?? 'Git history unavailable')}</div>
  </section>`;

    const dashboardStyles = `
    ${panelContentStyles(theme)}

    .git-unavailable {
      background: ${theme.surface};
      border: 1px dashed ${theme.border};
      border-radius: 10px;
      padding: 8px 10px;
      color: ${theme.muted};
      font-size: 0.75rem;
    }

    .git-chart-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 10px;
      padding: 10px 12px 8px;
      box-shadow: ${theme.shadow};
    }

    .git-chart-wrap {
      position: relative;
      height: 200px;
    }

    .git-chart-note {
      margin-top: 6px;
      font-size: 0.65rem;
      color: ${theme.muted};
      line-height: 1.4;
    }

    .uncommitted-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: ${theme.shadow};
      margin-bottom: 10px;
    }

    .uncommitted-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${theme.muted};
      margin-bottom: 6px;
      font-weight: 600;
    }

    .uncommitted-files .add-num {
      color: #22c55e;
    }

    .uncommitted-files .delete-num {
      color: #ef4444;
    }

    .uncommitted-files .net-positive {
      color: #22c55e;
    }

    .uncommitted-files .net-negative {
      color: #ef4444;
    }

    .uncommitted-empty {
      background: ${theme.surface};
      border: 1px dashed ${theme.border};
      border-radius: 10px;
      padding: 8px 10px;
      color: ${theme.muted};
      font-size: 0.72rem;
      margin-bottom: 10px;
    }

    .overview {
      display: grid;
      grid-template-columns: minmax(220px, 280px) 1fr;
      gap: 10px;
      margin-bottom: 12px;
      align-items: start;
    }

    @media (max-width: 820px) {
      .overview { grid-template-columns: 1fr; }
    }

    .chart-card, .legend-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: ${theme.shadow};
    }

    .chart-card h2, .section-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${theme.muted};
      margin-bottom: 6px;
      font-weight: 600;
    }

    .chart-wrap {
      position: relative;
      max-width: 220px;
      margin: 0 auto;
    }

    .legend-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .legend-item {
      display: grid;
      grid-template-columns: 10px 1fr auto auto;
      gap: 8px;
      align-items: center;
      padding: 4px 6px;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .legend-item:hover {
      background: ${theme.surfaceHover};
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-name {
      font-weight: 500;
      font-size: 0.75rem;
    }

    .legend-files {
      font-size: 0.68rem;
      color: ${theme.muted};
    }

    .legend-code {
      font-weight: 600;
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }

    .top-files {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
    }

    .top-files th {
      text-align: left;
      padding: 4px 6px;
      color: ${theme.muted};
      font-weight: 600;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid ${theme.border};
    }

    .top-files td {
      padding: 4px 6px;
      border-bottom: 1px solid ${theme.border};
      vertical-align: middle;
    }

    .top-files tr:last-child td {
      border-bottom: none;
    }

    .top-files tbody tr:hover {
      background: ${theme.surfaceHover};
    }

    .rank {
      width: 20px;
      padding-right: 2px;
      color: ${theme.muted};
      font-variant-numeric: tabular-nums;
      font-size: 0.68rem;
    }

    .file-path {
      width: auto;
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-link {
      appearance: none;
      border: none;
      background: none;
      padding: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: inherit;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.68rem;
      color: ${theme.accent};
      cursor: pointer;
      text-align: left;
    }

    .file-link:hover {
      text-decoration: underline;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .col-code,
    .col-other {
      width: 42px;
      max-width: 42px;
      padding-left: 4px !important;
      padding-right: 4px !important;
      font-size: 0.68rem;
    }

    .top-files th.col-code,
    .top-files th.col-other {
      text-align: right;
    }
  `;

    const reloadBtn = `<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>`;

    return panelDocument({
        title: 'Code Dashboard',
        csp: panelWebviewCsp(assets.cspSource),
        styles: dashboardStyles,
        body: `
  ${renderPanelHeader('Code Dashboard', escapeHtml(data.folderName), reloadBtn)}

  <div class="stats">
    <div class="stat-card highlight">
      <div class="label">Lines of code</div>
      <div class="value">${data.totalCode.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="label">Files</div>
      <div class="value">${data.totalFiles.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="label">Languages</div>
      <div class="value">${data.languages.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Blank + comment</div>
      <div class="value">${(data.totalBlank + data.totalComment).toLocaleString()}</div>
    </div>
    ${subrepoCard}
  </div>

  ${gitSection}

  <div class="overview">
    <div class="chart-card">
      <h2>Distribution</h2>
      <div class="chart-wrap">
        <canvas id="chart"></canvas>
      </div>
    </div>
    <div class="legend-card">
      <div class="legend-list">
        ${data.languages
            .map((lang, i) => {
                const pct =
                    data.totalCode > 0 ? ((lang.code / data.totalCode) * 100).toFixed(1) : '0';
                return `
          <div class="legend-item">
            <span class="legend-dot" style="background: ${chartColors[i]}"></span>
            <span class="legend-name">${escapeHtml(lang.name)}</span>
            <span class="legend-files">${lang.nFiles} files</span>
            <span class="legend-code">${lang.code.toLocaleString()} (${pct}%)</span>
          </div>`;
            })
            .join('')}
      </div>
    </div>
  </div>

  <script src="${escapeHtml(assets.chartScriptUri)}"></script>
  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll(".file-link").forEach((el) => {
      el.addEventListener("click", () => {
        const path = el.getAttribute("data-path");
        if (path) {
          const lineAttr = el.getAttribute("data-line");
          const line = lineAttr ? Number.parseInt(lineAttr, 10) : 0;
          vscode.postMessage({
            type: "open",
            path,
            line: Number.isFinite(line) ? line : 0,
          });
        }
      });
    });

    document.getElementById("reload-btn")?.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = true;
        btn.textContent = "Reloading…";
      }
      vscode.postMessage({ type: "reload" });
    });

    const labels = ${JSON.stringify(data.languages.map((l) => l.name))};
    const values = ${JSON.stringify(data.languages.map((l) => l.code))};
    const colors = ${JSON.stringify(chartColors)};

    new Chart(document.getElementById("chart"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = values.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return \` \${ctx.label}: \${ctx.raw.toLocaleString()} (\${pct}%)\`;
              }
            }
          }
        }
      }
    });

    const gitAvailable = ${JSON.stringify(git.available)};
    if (gitAvailable) {
      const gitLabels = ${JSON.stringify(GitChangeAnalyzer.formatGitChartLabels(git.days))};
      const gitAdded = ${JSON.stringify(git.days.map((d) => d.added))};
      const gitDeleted = ${JSON.stringify(git.days.map((d) => d.deleted))};
      const gitNet = ${JSON.stringify(git.days.map((d) => d.net))};
      const gitText = ${JSON.stringify(theme.text)};
      const gitMuted = ${JSON.stringify(theme.muted)};
      const gitGrid = ${JSON.stringify(theme.border)};

      new Chart(document.getElementById("git-chart"), {
        data: {
          labels: gitLabels,
          datasets: [
            {
              type: "bar",
              label: "Added",
              data: gitAdded,
              backgroundColor: "rgba(34, 197, 94, 0.75)",
              borderRadius: 4,
              order: 2,
            },
            {
              type: "bar",
              label: "Deleted",
              data: gitDeleted,
              backgroundColor: "rgba(239, 68, 68, 0.75)",
              borderRadius: 4,
              order: 3,
            },
            {
              type: "line",
              label: "Net",
              data: gitNet,
              borderColor: "#6366f1",
              backgroundColor: "rgba(99, 102, 241, 0.12)",
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 4,
              tension: 0.25,
              yAxisID: "y",
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              labels: {
                color: gitText,
                boxWidth: 10,
                usePointStyle: true,
                font: { size: 10 },
                padding: 8,
              },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const prefix = ctx.dataset.label ? ctx.dataset.label + ": " : "";
                  const value = ctx.raw;
                  if (ctx.dataset.label === "Net") {
                    return " Net: " + (value >= 0 ? "+" : "") + value.toLocaleString();
                  }
                  return " " + prefix + value.toLocaleString();
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: gitMuted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 10 } },
              grid: { color: gitGrid },
            },
            y: {
              ticks: { color: gitMuted, font: { size: 10 } },
              grid: { color: gitGrid },
            },
          },
        },
      });
    }
  </script>
    `,
    });
};
