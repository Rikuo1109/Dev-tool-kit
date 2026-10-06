import { escapeHtml } from '../../shared/html';
import {
    panelContentStyles,
    panelDocument,
    renderPanelHeader,
} from '../../shared/panel';
import { getPanelTheme, PanelTheme } from '../../shared/theme';
import { HeatmapPayload } from './commits';

const hexToRgba = (hex: string, alpha: number): string => {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** JSON safe to embed inside a <script> element. */
const embedJson = (value: unknown): string => {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
};

const heatmapStyles = (t: PanelTheme): string => `
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

    .controls select {
      appearance: auto;
      border: 1px solid ${t.border};
      background: ${t.surface};
      color: ${t.text};
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.74rem;
      max-width: 340px;
      text-transform: none;
      letter-spacing: normal;
    }

    .controls select:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 1px; }

    .stat-card .sub {
      font-size: 0.64rem;
      color: ${t.muted};
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .calendar-card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: ${t.shadow};
      margin-bottom: 10px;
    }

    .calendar-card h2, .day-card h2 {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${t.muted};
      margin-bottom: 8px;
      font-weight: 600;
    }

    .calendar-scroll { overflow-x: auto; padding-bottom: 4px; }

    .year-block + .year-block { margin-top: 14px; }

    .year-title {
      font-size: 0.72rem;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .year-title .muted { font-weight: 400; }

    .cal {
      display: grid;
      grid-template-columns: 28px auto;
      grid-template-rows: 14px auto;
      column-gap: 4px;
      width: max-content;
    }

    :root { --cell: 11px; --gap: 3px; }

    .months, .cells {
      display: grid;
      grid-auto-columns: var(--cell);
      column-gap: var(--gap);
    }

    .months {
      grid-column: 2;
      grid-auto-flow: column;
      font-size: 0.6rem;
      color: ${t.muted};
    }

    .months span { white-space: nowrap; overflow: visible; }

    .weekdays {
      grid-column: 1;
      grid-row: 2;
      display: grid;
      grid-template-rows: repeat(7, var(--cell));
      row-gap: var(--gap);
      font-size: 0.58rem;
      color: ${t.muted};
      line-height: var(--cell);
    }

    .cells {
      grid-column: 2;
      grid-row: 2;
      grid-template-rows: repeat(7, var(--cell));
      grid-auto-flow: column;
      row-gap: var(--gap);
    }

    .cell {
      width: var(--cell);
      height: var(--cell);
      border-radius: 2px;
      background: ${t.barTrack};
      outline: 1px solid ${hexToRgba(t.text === '#e8eaef' ? '#ffffff' : '#000000', 0.04)};
      outline-offset: -1px;
      cursor: pointer;
    }

    .cell.out { background: transparent; outline: none; cursor: default; }
    .cell.l1 { background: ${hexToRgba(t.accent, 0.28)}; }
    .cell.l2 { background: ${hexToRgba(t.accent, 0.5)}; }
    .cell.l3 { background: ${hexToRgba(t.accent, 0.75)}; }
    .cell.l4 { background: ${t.accent}; }
    .cell:not(.out):hover { outline: 1px solid ${t.text}; }
    .cell.selected { outline: 2px solid ${t.text}; outline-offset: 0; }

    .legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 3px;
      margin-top: 8px;
      font-size: 0.62rem;
      color: ${t.muted};
    }

    .legend .cell { cursor: default; }
    .legend .label { margin: 0 4px; }

    .tooltip {
      position: fixed;
      pointer-events: none;
      z-index: 10;
      background: ${t.text};
      color: ${t.bg};
      font-size: 0.68rem;
      padding: 4px 8px;
      border-radius: 6px;
      white-space: nowrap;
      display: none;
      box-shadow: ${t.shadow};
    }

    .tooltip strong { font-variant-numeric: tabular-nums; }

    .day-card {
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: ${t.shadow};
    }

    .day-card .empty { border: none; background: transparent; padding: 8px 0; text-align: left; }

    table.commits {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
      table-layout: fixed;
    }

    table.commits th {
      text-align: left;
      font-weight: 600;
      color: ${t.muted};
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 6px;
      border-bottom: 1px solid ${t.border};
    }

    table.commits td {
      padding: 5px 6px;
      border-bottom: 1px solid ${t.border};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: top;
    }

    table.commits tr:last-child td { border-bottom: none; }
    table.commits tbody tr:hover { background: ${t.barTrack}; }
    table.commits .col-repo { width: 22%; }
    table.commits .col-hash { width: 76px; }
    table.commits .col-author { width: 20%; }

    .hash {
      appearance: none;
      border: none;
      background: transparent;
      color: ${t.accent};
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.7rem;
      cursor: pointer;
      padding: 0;
    }

    .hash:hover { text-decoration: underline; }
`;

const clientScript = (): string => `
(function () {
  const vscode = acquireVsCodeApi();
  const data = JSON.parse(document.getElementById("heatmap-data").textContent);
  const saved = vscode.getState() || {};
  const DAY = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const esc = (value) => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const toTime = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
  const toKey = (time) => new Date(time).toISOString().slice(0, 10);
  const weekdayIndex = (time) => (new Date(time).getUTCDay() + 6) % 7;
  const fmtDate = (time) => {
    const d = new Date(time);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  };
  const fmtLong = (key) => WEEKDAYS[weekdayIndex(toTime(key))] + ", " + fmtDate(toTime(key));
  const plural = (n, word) => n.toLocaleString() + " " + word + (n === 1 ? "" : "s");
  const todayTime = toTime(data.today);

  const rangeSelect = document.getElementById("range");
  const authorSelect = document.getElementById("author");
  const calendarEl = document.getElementById("calendar");
  const rangeTitleEl = document.getElementById("range-title");
  const tooltip = document.getElementById("tooltip");
  const dayTitle = document.getElementById("day-title");
  const dayBody = document.getElementById("day-body");
  const dayCommits = {};

  // ── Controls ──────────────────────────────────────────────
  const rangeOptions = [["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"], ["all", "All time"]];
  const firstYear = data.minDate ? +data.minDate.slice(0, 4) : +data.today.slice(0, 4);
  for (let year = +data.today.slice(0, 4); year >= firstYear; year--) {
    rangeOptions.push(["y" + year, String(year)]);
  }
  rangeSelect.innerHTML = rangeOptions.map((o) => '<option value="' + o[0] + '">' + o[1] + "</option>").join("");

  const authorOptions = [["all", "All authors (" + data.totalCommits.toLocaleString() + ")"]];
  if (data.meKey) {
    const me = data.authors.find((a) => a.key === data.meKey);
    authorOptions.push(["me", "Only me — " + data.meKey + " (" + (me ? me.count : 0).toLocaleString() + ")"]);
  }
  data.authors.forEach((a, index) => {
    const who = a.name && a.email ? a.name + " <" + a.email + ">" : a.name || a.email || "(unknown)";
    authorOptions.push(["a" + index, who + " (" + a.count.toLocaleString() + ")"]);
  });
  authorSelect.innerHTML = authorOptions.map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + "</option>").join("");

  const state = {
    range: rangeOptions.some((o) => o[0] === saved.range) ? saved.range : "12m",
    author: authorOptions.some((o) => o[0] === saved.author) ? saved.author : "all",
    day: typeof saved.day === "string" ? saved.day : null,
  };
  rangeSelect.value = state.range;
  authorSelect.value = state.author;
  const persist = () => vscode.setState(state);

  // ── Data shaping ──────────────────────────────────────────
  const selectedAuthorKeys = () => {
    if (state.author === "all") return null;
    if (state.author === "me") return new Set([data.meKey]);
    const author = data.authors[+state.author.slice(1)];
    return new Set(author ? [author.key] : []);
  };

  const countsByDay = () => {
    const keys = selectedAuthorKeys();
    const allowed = keys ? new Set(data.authors.map((a, i) => (keys.has(a.key) ? i : -1)).filter((i) => i >= 0)) : null;
    const counts = new Map();
    for (const date of Object.keys(data.days)) {
      const flat = data.days[date];
      let total = 0;
      for (let i = 0; i < flat.length; i += 2) {
        if (!allowed || allowed.has(flat[i])) total += flat[i + 1];
      }
      if (total) counts.set(date, total);
    }
    return counts;
  };

  const rangeBounds = () => {
    if (state.range === "all") {
      return { start: data.minDate ? Math.min(toTime(data.minDate), todayTime) : todayTime, end: todayTime };
    }
    if (state.range.charAt(0) === "y") {
      const year = +state.range.slice(1);
      return { start: Date.UTC(year, 0, 1), end: Date.UTC(year, 11, 31) };
    }
    const months = parseInt(state.range, 10);
    const today = new Date(todayTime);
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()) + DAY;
    return { start, end: todayTime };
  };

  const levelScale = (counts, start, end) => {
    const values = [];
    for (let t = start; t <= end; t += DAY) {
      const c = counts.get(toKey(t));
      if (c) values.push(c);
    }
    values.sort((a, b) => a - b);
    const q = (p) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;
    const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
    return (c) => (!c ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4);
  };

  const computeStats = (counts, start, end) => {
    let total = 0, active = 0, longest = 0, longestEnd = null, run = 0, busiest = null;
    for (let t = start; t <= end; t += DAY) {
      const key = toKey(t);
      const c = counts.get(key) || 0;
      total += c;
      if (c) {
        active++;
        run++;
        if (run > longest) { longest = run; longestEnd = t; }
        if (!busiest || c > busiest.count) busiest = { key, count: c };
      } else {
        run = 0;
      }
    }
    // Current streak is global (not range-limited): ends today, or yesterday if today is empty.
    let current = 0;
    let cursor = counts.has(data.today) ? todayTime : todayTime - DAY;
    while (counts.has(toKey(cursor))) { current++; cursor -= DAY; }
    return { total, active, longest, longestEnd, current, busiest };
  };

  // ── Rendering ─────────────────────────────────────────────
  const renderBlock = (title, start, end, counts, levelOf) => {
    const gridStart = start - weekdayIndex(start) * DAY;
    const weeks = Math.ceil((end - gridStart + DAY) / (7 * DAY));
    const labels = [];
    let cells = "";
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const t = gridStart + (w * 7 + d) * DAY;
        if (t < start || t > end) {
          cells += '<div class="cell out"></div>';
          continue;
        }
        const date = new Date(t);
        if (date.getUTCDate() === 1 || t === start) labels.push({ week: w, text: MONTHS[date.getUTCMonth()] });
        const key = toKey(t);
        const c = counts.get(key) || 0;
        cells += '<div class="cell l' + levelOf(c) + (key === state.day ? " selected" : "") +
          '" data-date="' + key + '" data-count="' + c + '"></div>';
      }
    }
    // Drop the partial first month label when the next one is too close (GitHub does the same).
    if (labels.length > 1 && labels[1].week - labels[0].week < 3) labels.shift();
    const months = labels.map((l) => '<span style="grid-column:' + (l.week + 1) + '">' + l.text + "</span>").join("");
    const weekdays = WEEKDAYS.map((name, i) => "<span>" + (i % 2 === 0 ? name : "") + "</span>").join("");
    return '<div class="year-block">' + (title ? '<div class="year-title">' + title + "</div>" : "") +
      '<div class="cal"><div class="months" style="grid-template-columns:repeat(' + weeks + ',var(--cell))">' + months +
      '</div><div class="weekdays">' + weekdays + '</div><div class="cells">' + cells + "</div></div></div>";
  };

  // Scale cells to the available width (10–18px), like a responsive GitHub calendar.
  let lastWeeks = 53;
  const fitCells = () => {
    const available = calendarEl.clientWidth - 32;
    const size = Math.max(10, Math.min(18, Math.floor(available / lastWeeks) - 3));
    document.documentElement.style.setProperty("--cell", size + "px");
  };
  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitCells);
  });

  const setStat = (id, value, sub) => {
    document.getElementById(id).textContent = value;
    document.getElementById(id + "-sub").textContent = sub || "";
  };

  const render = () => {
    const counts = countsByDay();
    const bounds = rangeBounds();
    const levelOf = levelScale(counts, bounds.start, bounds.end);
    const stats = computeStats(counts, bounds.start, bounds.end);

    rangeTitleEl.textContent = fmtDate(bounds.start) + " – " + fmtDate(bounds.end);
    const blockStart = state.range === "all" ? Math.max(bounds.start, Date.UTC(new Date(bounds.end).getUTCFullYear(), 0, 1)) : bounds.start;
    lastWeeks = state.range === "all" ? 53 : Math.ceil((bounds.end - (blockStart - weekdayIndex(blockStart) * DAY) + DAY) / (7 * DAY));
    fitCells();
    if (state.range === "all") {
      let html = "";
      for (let year = new Date(bounds.end).getUTCFullYear(); year >= new Date(bounds.start).getUTCFullYear(); year--) {
        const start = Math.max(bounds.start, Date.UTC(year, 0, 1));
        const end = Math.min(bounds.end, Date.UTC(year, 11, 31));
        const yearStats = computeStats(counts, start, end);
        html += renderBlock(year + ' <span class="muted">· ' + plural(yearStats.total, "commit") + "</span>", start, end, counts, levelOf);
      }
      calendarEl.innerHTML = html;
    } else {
      calendarEl.innerHTML = renderBlock("", bounds.start, bounds.end, counts, levelOf);
    }

    setStat("stat-total", stats.total.toLocaleString(), plural(stats.active, "active day"));
    setStat("stat-longest", plural(stats.longest, "day"),
      stats.longest ? fmtDate(stats.longestEnd - (stats.longest - 1) * DAY) + " – " + fmtDate(stats.longestEnd) : "");
    setStat("stat-current", plural(stats.current, "day"), stats.current ? "through " + fmtDate(counts.has(data.today) ? todayTime : todayTime - DAY) : "no commit today or yesterday");
    setStat("stat-busiest", stats.busiest ? plural(stats.busiest.count, "commit") : "—", stats.busiest ? fmtLong(stats.busiest.key) : "");
    renderDay();
  };

  const renderDay = () => {
    if (!state.day) {
      dayTitle.textContent = "Commits";
      dayBody.innerHTML = '<div class="empty">Click a day in the heatmap to list its commits.</div>';
      return;
    }
    const list = dayCommits[state.day];
    if (!list) {
      dayTitle.textContent = "Commits on " + fmtLong(state.day);
      dayBody.innerHTML = '<div class="empty">Loading…</div>';
      return;
    }
    const keys = selectedAuthorKeys();
    const rows = list.filter((c) => !keys || keys.has(c.authorKey));
    dayTitle.textContent = "Commits on " + fmtLong(state.day) + " (" + rows.length + ")";
    if (!rows.length) {
      dayBody.innerHTML = '<div class="empty">No commits on this day' + (keys ? " for the selected author." : ".") + "</div>";
      return;
    }
    dayBody.innerHTML = '<table class="commits"><thead><tr><th class="col-repo">Repo</th><th class="col-hash">Hash</th>' +
      '<th>Subject</th><th class="col-author">Author</th></tr></thead><tbody>' +
      rows.map((c) => "<tr><td title=\\"" + esc(c.repo) + "\\">" + esc(c.repo) + "</td>" +
        '<td><button type="button" class="hash" data-hash="' + esc(c.hash) + '" title="Copy full hash">' + esc(c.hash.slice(0, 8)) + "</button></td>" +
        "<td title=\\"" + esc(c.subject) + "\\">" + esc(c.subject) + "</td>" +
        "<td title=\\"" + esc(c.authorEmail) + "\\">" + esc(c.authorName || c.authorEmail) + "</td></tr>").join("") +
      "</tbody></table>";
  };

  // ── Events ────────────────────────────────────────────────
  rangeSelect.addEventListener("change", () => { state.range = rangeSelect.value; persist(); render(); });
  authorSelect.addEventListener("change", () => { state.author = authorSelect.value; persist(); render(); });

  calendarEl.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(".cell[data-date]");
    if (!cell) { tooltip.style.display = "none"; return; }
    const c = +cell.dataset.count;
    tooltip.innerHTML = (c ? "<strong>" + plural(c, "commit") + "</strong>" : "No commits") + " on " + fmtLong(cell.dataset.date);
    tooltip.style.display = "block";
  });
  calendarEl.addEventListener("mousemove", (event) => {
    const width = tooltip.offsetWidth;
    tooltip.style.left = Math.max(4, Math.min(window.innerWidth - width - 4, event.clientX - width / 2)) + "px";
    tooltip.style.top = (event.clientY - 32) + "px";
  });
  calendarEl.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

  calendarEl.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell[data-date]");
    if (!cell) return;
    state.day = cell.dataset.date;
    persist();
    calendarEl.querySelectorAll(".cell.selected").forEach((el) => el.classList.remove("selected"));
    cell.classList.add("selected");
    renderDay();
    if (!dayCommits[state.day]) vscode.postMessage({ type: "day", date: state.day });
  });

  dayBody.addEventListener("click", (event) => {
    const btn = event.target.closest(".hash");
    if (btn) vscode.postMessage({ type: "copy", text: btn.dataset.hash });
  });

  document.getElementById("reload-btn").addEventListener("click", (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = "Reloading…";
    vscode.postMessage({ type: "reload" });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data || {};
    if (msg.type === "dayCommits") {
      dayCommits[msg.date] = msg.commits;
      if (msg.date === state.day) renderDay();
    } else if (msg.type === "reloadDone") {
      const btn = document.getElementById("reload-btn");
      btn.disabled = false;
      btn.textContent = "Reload";
    }
  });

  render();
  if (state.day) vscode.postMessage({ type: "day", date: state.day });
})();
`;

export const getCommitHeatmapHtml = (payload: HeatmapPayload, isDark: boolean): string => {
    const t = getPanelTheme(isDark);
    const subtitle = `${escapeHtml(payload.folderName)} · ${payload.repoCount} repo${
        payload.repoCount === 1 ? '' : 's'
    } · ${payload.totalCommits.toLocaleString()} commits (HEAD)`;
    const reloadBtn = '<button type="button" class="toolbar-btn" id="reload-btn">Reload</button>';
    const failed = payload.failedRepos.length
        ? `<div class="banner warn">Could not read git history for: ${payload.failedRepos
              .map(escapeHtml)
              .join(', ')}</div>`
        : '';
    const empty =
        payload.repoCount === 0
            ? '<div class="banner warn">No git repository found in this folder.</div>'
            : '';
    const statCard = (id: string, label: string, extraClass = '') => `
      <div class="stat-card ${extraClass}">
        <div class="label">${label}</div>
        <div class="value" id="${id}">–</div>
        <div class="sub" id="${id}-sub"></div>
      </div>`;

    return panelDocument({
        title: 'Commit Heatmap',
        styles: heatmapStyles(t),
        body: `
  ${renderPanelHeader('Commit Heatmap', subtitle, reloadBtn)}
  ${failed}${empty}
  <div class="controls">
    <label>Range <select id="range"></select></label>
    <label>Author <select id="author"></select></label>
  </div>
  <div class="stats">
    ${statCard('stat-total', 'Commits', 'highlight')}
    ${statCard('stat-longest', 'Longest streak')}
    ${statCard('stat-current', 'Current streak', 'success')}
    ${statCard('stat-busiest', 'Busiest day')}
  </div>
  <div class="calendar-card">
    <h2 id="range-title"></h2>
    <div class="calendar-scroll" id="calendar"></div>
    <div class="legend">
      <span class="label">Less</span>
      <div class="cell l0"></div><div class="cell l1"></div><div class="cell l2"></div><div class="cell l3"></div><div class="cell l4"></div>
      <span class="label">More</span>
    </div>
  </div>
  <div class="day-card">
    <h2 id="day-title">Commits</h2>
    <div id="day-body"></div>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <script id="heatmap-data" type="application/json">${embedJson(payload)}</script>
  <script>${clientScript()}</script>`,
    });
};

export const getCommitHeatmapLoadingHtml = (folderName: string, isDark: boolean): string => {
    const t = getPanelTheme(isDark);
    return panelDocument({
        title: 'Commit Heatmap',
        styles: panelContentStyles(t),
        body: `
  ${renderPanelHeader('Commit Heatmap', escapeHtml(folderName))}
  <div class="loading">
    <div class="spinner"></div>
    <h2>Reading git history…</h2>
    <p>Discovering repositories and loading commits.</p>
  </div>`,
    });
};
