interface ClocFileEntry {
  blank: number;
  comment: number;
  code: number;
  language: string;
}

export interface FileStat {
  relativePath: string;
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
}

export interface DashboardData {
  folderName: string;
  totalFiles: number;
  totalCode: number;
  totalBlank: number;
  totalComment: number;
  languages: LangStat[];
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
      relativePath:
        relativePath || (key.split(/[/\\]/).pop() ?? key),
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
      const sorted = [...files].sort((a, b) => b.code - a.code);
      return {
        name,
        nFiles: files.length,
        code: files.reduce((sum, f) => sum + f.code, 0),
        blank: files.reduce((sum, f) => sum + f.blank, 0),
        comment: files.reduce((sum, f) => sum + f.comment, 0),
        topFiles: sorted.slice(0, TOP_FILES_PER_LANG),
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
  };
}

export function getDashboardHtml(data: DashboardData, isDark: boolean): string {
  const theme = isDark
    ? {
        bg: "#0f1117",
        surface: "#181b24",
        surfaceHover: "#1f2430",
        border: "#2a3142",
        text: "#e8eaef",
        muted: "#8b93a7",
        accent: "#6366f1",
        accentSoft: "rgba(99, 102, 241, 0.15)",
        barTrack: "#252a38",
        shadow: "0 8px 32px rgba(0,0,0,0.35)",
      }
    : {
        bg: "#f4f6fb",
        surface: "#ffffff",
        surfaceHover: "#f8f9fc",
        border: "#e2e6ef",
        text: "#1a1d26",
        muted: "#5c6478",
        accent: "#4f46e5",
        accentSoft: "rgba(79, 70, 229, 0.1)",
        barTrack: "#eef1f7",
        shadow: "0 8px 32px rgba(15, 23, 42, 0.08)",
      };

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

      const fileRows = lang.topFiles
        .map(
          (file, rank) => `
          <tr>
            <td class="rank">${rank + 1}</td>
            <td class="file-path" title="${escapeHtml(file.relativePath)}">${escapeHtml(file.relativePath)}</td>
            <td class="num">${file.code.toLocaleString()}</td>
            <td class="num muted">${(file.blank + file.comment).toLocaleString()}</td>
          </tr>`,
        )
        .join("");

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
          ${
            lang.topFiles.length > 0
              ? `
          <table class="top-files">
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Code</th>
                <th>Other</th>
              </tr>
            </thead>
            <tbody>${fileRows}</tbody>
          </table>`
              : ""
          }
        </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src https://cdn.jsdelivr.net 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${theme.bg};
      color: ${theme.text};
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }

    .header {
      margin-bottom: 28px;
    }

    .header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }

    .header p {
      color: ${theme.muted};
      font-size: 0.9rem;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }

    .stat-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: ${theme.shadow};
    }

    .stat-card .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${theme.muted};
      margin-bottom: 6px;
    }

    .stat-card .value {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .stat-card.highlight .value {
      color: ${theme.accent};
    }

    .overview {
      display: grid;
      grid-template-columns: minmax(260px, 340px) 1fr;
      gap: 20px;
      margin-bottom: 32px;
      align-items: start;
    }

    @media (max-width: 820px) {
      .overview { grid-template-columns: 1fr; }
    }

    .chart-card, .legend-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 14px;
      padding: 20px;
      box-shadow: ${theme.shadow};
    }

    .chart-card h2, .section-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${theme.muted};
      margin-bottom: 16px;
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
      gap: 16px;
    }

    .lang-card {
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 14px;
      padding: 18px 20px;
      box-shadow: ${theme.shadow};
    }

    .lang-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
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
      margin-bottom: 12px;
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
      gap: 16px;
      font-size: 0.85rem;
      color: ${theme.muted};
      margin-bottom: 16px;
    }

    .lang-stats strong {
      color: ${theme.text};
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
      width: 32px;
      color: ${theme.muted};
      font-variant-numeric: tabular-nums;
    }

    .file-path {
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.8rem;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .muted { color: ${theme.muted}; }
  </style>
</head>
<body>
  <header class="header">
    <h1>Code Dashboard</h1>
    <p>${escapeHtml(data.folderName)}</p>
  </header>

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
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
