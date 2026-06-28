interface ClocFileEntry {
  blank: number;
  comment: number;
  code: number;
  language: string;
}

export interface FileStat {
  relativePath: string;
  absolutePath: string;
  code: number;
  blank: number;
  comment: number;
}

export interface LangStat {
  name: string;
  nFiles: number;
  code: number;
  blank: number;
  comment: number;
  topFiles: FileStat[];
  smallestFiles: FileStat[];
}

import { GitChangeStats, formatGitChartLabels } from "./gitChanges";
import { escapeHtml } from "../../shared/html";
import {
  panelBaseStyles,
  panelDocument,
  panelHeaderStyles,
  panelSectionStyles,
  panelStatCardStyles,
  panelStatGridStyles,
  panelToolbarBtnStyles,
  PANEL_CSP_CDN,
  renderPanelHeader,
} from "../../shared/panel";
import { getPanelTheme } from "../../shared/theme";

export interface DashboardData {
  folderName: string;
  totalFiles: number;
  totalCode: number;
  totalBlank: number;
  totalComment: number;
  languages: LangStat[];
  gitChanges: GitChangeStats;
}

const TOP_FILES_PER_LANG = 5;

const LANG_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

export function parseClocData(
  raw: Record<string, unknown>,
  folder: string,
  folderName: string,
  gitChanges: GitChangeStats,
): DashboardData {
  const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/$/, "");
  const filesByLang = new Map<string, FileStat[]>();

  for (const [key, value] of Object.entries(raw)) {
    if (key === "header" || key === "SUM") {
      continue;
    }

    const entry = value as ClocFileEntry;
    const relativePath = key
      .replace(/\\/g, "/")
      .replace(`${normalizedFolder}/`, "")
      .replace(`${normalizedFolder}`, "");

    const file: FileStat = {
      relativePath: relativePath || (key.split(/[/\\]/).pop() ?? key),
      absolutePath: key.replace(/\\/g, "/"),
      code: entry.code,
      blank: entry.blank,
      comment: entry.comment,
    };

    const list = filesByLang.get(entry.language) ?? [];
    list.push(file);
    filesByLang.set(entry.language, list);
  }

  const languages: LangStat[] = [...filesByLang.entries()]
    .map(([name, files]) => {
      const sortedDesc = [...files].sort((a, b) => b.code - a.code);
      const sortedAsc = [...files].sort((a, b) => a.code - b.code);
      return {
        name,
        nFiles: files.length,
        code: files.reduce((sum, f) => sum + f.code, 0),
        blank: files.reduce((sum, f) => sum + f.blank, 0),
        comment: files.reduce((sum, f) => sum + f.comment, 0),
        topFiles: sortedDesc.slice(0, TOP_FILES_PER_LANG),
        smallestFiles: sortedAsc.slice(0, TOP_FILES_PER_LANG),
      };
    })
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
  };
}

export function getDashboardHtml(data: DashboardData, isDark: boolean): string {
  const theme = getPanelTheme(isDark);

  const chartColors = data.languages.map(
    (_, i) => LANG_COLORS[i % LANG_COLORS.length],
  );

  const langCards = data.languages
    .map((lang, i) => {
      const pct =
        data.totalCode > 0
          ? ((lang.code / data.totalCode) * 100).toFixed(1)
          : "0";
      const color = chartColors[i];

      const fileRows = (files: FileStat[]) =>
        files
          .map(
            (file, rank) => `
          <tr>
            <td class="rank">${rank + 1}</td>
            <td class="file-path">
              <button type="button" class="file-link" data-path="${escapeHtml(file.absolutePath)}" title="${escapeHtml(file.relativePath)}">${escapeHtml(file.relativePath)}</button>
            </td>
            <td class="num col-code">${file.code.toLocaleString()}</td>
            <td class="num col-other muted">${(file.blank + file.comment).toLocaleString()}</td>
          </tr>`,
          )
          .join("");

      const renderTable = (files: FileStat[], title: string) =>
        files.length > 0
          ? `
          <div class="file-table-block">
            <h4 class="file-table-title">${title}</h4>
            <table class="top-files">
              <thead>
                <tr>
                  <th>#</th>
                  <th>File</th>
                  <th class="col-code">Code</th>
                  <th class="col-other">Other</th>
                </tr>
              </thead>
              <tbody>${fileRows(files)}</tbody>
            </table>
          </div>`
          : "";

      const fileTables =
        lang.topFiles.length > 0 || lang.smallestFiles.length > 0
          ? `
          <div class="file-tables">
            ${renderTable(lang.topFiles, "Top 5 largest")}
            ${renderTable(lang.smallestFiles, "Top 5 smallest")}
          </div>`
          : "";

      return `
        <section class="lang-card" style="--lang-color: ${color}">
          <header class="lang-header">
            <div class="lang-title">
              <span class="lang-dot"></span>
              <h3>${escapeHtml(lang.name)}</h3>
            </div>
            <div class="lang-meta">
              <span>${lang.nFiles} files</span>
              <span class="lang-pct">${pct}%</span>
            </div>
          </header>
          <div class="lang-bar-wrap">
            <div class="lang-bar" style="width: ${pct}%"></div>
          </div>
          <div class="lang-stats">
            <span><strong>${lang.code.toLocaleString()}</strong> code</span>
            <span>${lang.blank.toLocaleString()} blank</span>
            <span>${lang.comment.toLocaleString()} comment</span>
          </div>
          ${fileTables}
        </section>`;
    })
    .join("");

  const git = data.gitChanges;
  const netClass = (net: number) =>
    net > 0 ? "net-positive" : net < 0 ? "net-negative" : "net-zero";
  const formatDelta = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toLocaleString()}`;

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

    <div class="git-chart-card">
      <div class="git-chart-wrap">
        <canvas id="git-chart"></canvas>
      </div>
      <p class="git-chart-note">Committed lines from <code>git log --numstat</code> scoped to this folder. Net uncommitted = index + working tree (staged + unstaged diff).</p>
    </div>
  </section>`
    : `
  <section class="section-block">
    <h2>Git activity</h2>
    <div class="git-unavailable">${escapeHtml(git.message ?? "Git history unavailable")}</div>
  </section>`;

  const dashboardStyles = `
    ${panelBaseStyles(theme)}
    ${panelHeaderStyles(theme)}
    ${panelToolbarBtnStyles(theme)}
    ${panelStatGridStyles("140px")}
    ${panelStatCardStyles(theme)}
    ${panelSectionStyles(theme)}

    .header { margin-bottom: 12px; }
    .header h1 { font-size: 1.75rem; margin-bottom: 2px; }
    .stats { margin-bottom: 12px; }

    .git-unavailable {
      background: ${theme.surface};
      border: 1px dashed ${theme.border};
      border-radius: 12px;
      padding: 14px 16px;
      color: ${theme.muted};
      font-size: 0.9rem;
    }

    .git-chart-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 14px;
      padding: 14px 16px 10px;
      box-shadow: ${theme.shadow};
    }

    .git-chart-wrap {
      position: relative;
      height: 280px;
    }

    .git-chart-note {
      margin-top: 10px;
      font-size: 0.78rem;
      color: ${theme.muted};
    }

    .overview {
      display: grid;
      grid-template-columns: minmax(260px, 340px) 1fr;
      gap: 14px;
      margin-bottom: 20px;
      align-items: start;
    }

    @media (max-width: 820px) {
      .overview { grid-template-columns: 1fr; }
    }

    .chart-card, .legend-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: ${theme.shadow};
    }

    .chart-card h2, .section-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${theme.muted};
      margin-bottom: 10px;
      font-weight: 600;
    }

    .chart-wrap {
      position: relative;
      max-width: 280px;
      margin: 0 auto;
    }

    .legend-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .legend-item {
      display: grid;
      grid-template-columns: 12px 1fr auto auto;
      gap: 10px;
      align-items: center;
      padding: 8px 10px;
      border-radius: 8px;
      transition: background 0.15s;
    }

    .legend-item:hover {
      background: ${theme.surfaceHover};
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-name {
      font-weight: 500;
      font-size: 0.9rem;
    }

    .legend-files {
      font-size: 0.8rem;
      color: ${theme.muted};
    }

    .legend-code {
      font-weight: 600;
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
    }

    .languages {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .lang-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: ${theme.shadow};
    }

    .lang-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .lang-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .lang-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--lang-color);
      flex-shrink: 0;
    }

    .lang-title h3 {
      font-size: 1.05rem;
      font-weight: 600;
    }

    .lang-meta {
      display: flex;
      gap: 12px;
      font-size: 0.85rem;
      color: ${theme.muted};
    }

    .lang-pct {
      font-weight: 700;
      color: var(--lang-color);
    }

    .lang-bar-wrap {
      height: 6px;
      background: ${theme.barTrack};
      border-radius: 99px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .lang-bar {
      height: 100%;
      background: var(--lang-color);
      border-radius: 99px;
      min-width: 2px;
      transition: width 0.4s ease;
    }

    .lang-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.85rem;
      color: ${theme.muted};
      margin-bottom: 10px;
    }

    .lang-stats strong {
      color: ${theme.text};
    }

    .file-tables {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }

    .file-table-title {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${theme.muted};
      margin-bottom: 8px;
      font-weight: 600;
    }

    .top-files {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }

    .top-files th {
      text-align: left;
      padding: 8px 10px;
      color: ${theme.muted};
      font-weight: 600;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid ${theme.border};
    }

    .top-files td {
      padding: 8px 10px;
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
      width: 24px;
      padding-right: 4px;
      color: ${theme.muted};
      font-variant-numeric: tabular-nums;
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
      font-size: 0.8rem;
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
      width: 48px;
      max-width: 48px;
      padding-left: 6px !important;
      padding-right: 6px !important;
      font-size: 0.78rem;
    }

    .top-files th.col-code,
    .top-files th.col-other {
      text-align: right;
    }
  `;

  const reloadBtn = `<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>`;

  return panelDocument({
    title: "Code Dashboard",
    csp: PANEL_CSP_CDN,
    styles: dashboardStyles,
    body: `
  ${renderPanelHeader("Code Dashboard", escapeHtml(data.folderName), reloadBtn)}

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
      <h2>Languages</h2>
      <div class="legend-list">
        ${data.languages
          .map((lang, i) => {
            const pct =
              data.totalCode > 0
                ? ((lang.code / data.totalCode) * 100).toFixed(1)
                : "0";
            return `
          <div class="legend-item">
            <span class="legend-dot" style="background: ${chartColors[i]}"></span>
            <span class="legend-name">${escapeHtml(lang.name)}</span>
            <span class="legend-files">${lang.nFiles} files</span>
            <span class="legend-code">${lang.code.toLocaleString()} (${pct}%)</span>
          </div>`;
          })
          .join("")}
      </div>
    </div>
  </div>

  <h2 class="section-title">Top files by language</h2>
  <div class="languages">${langCards}</div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const vscode = acquireVsCodeApi();

    document.querySelectorAll(".file-link").forEach((el) => {
      el.addEventListener("click", () => {
        const path = el.getAttribute("data-path");
        if (path) {
          vscode.postMessage({ type: "open", path });
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
      const gitLabels = ${JSON.stringify(formatGitChartLabels(git.days))};
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
              labels: { color: gitText, boxWidth: 12, usePointStyle: true },
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
              ticks: { color: gitMuted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
              grid: { color: gitGrid },
            },
            y: {
              ticks: { color: gitMuted },
              grid: { color: gitGrid },
            },
          },
        },
      });
    }
  </script>
    `,
  });
}
