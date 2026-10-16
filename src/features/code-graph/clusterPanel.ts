import { escapeHtml } from '../../shared/html';
import { panelDocument, panelWebviewCsp } from '../../shared/panel';
import { getGraphTheme, graphStyles, GraphTheme } from './panel';

export interface ClusterPanelAssets {
    visScriptUri: string;
    cspSource: string;
}

const clusterStyles = (t: GraphTheme): string => `
    ${graphStyles(t)}

    .crumbs {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: wrap;
      padding: 5px 12px;
      font-size: 0.7rem;
      font-family: ui-monospace, Menlo, monospace;
      border-bottom: 1px solid ${t.border};
      background: ${t.bg};
    }

    .crumbs button {
      appearance: none;
      border: 0;
      background: none;
      color: ${t.accent};
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      font: inherit;
    }

    .crumbs button:hover { background: ${t.accentSoft}; }
    .crumbs button[aria-current="page"] { color: ${t.text}; font-weight: 600; cursor: default; }
    .crumbs .sep { color: ${t.muted}; }

    .search {
      position: relative;
      flex: 0 1 240px;
      min-width: 140px;
    }

    .search input {
      width: 100%;
      padding: 5px 8px;
      font-size: 0.7rem;
      border: 1px solid ${t.border};
      border-radius: 6px;
      background: ${t.bg};
      color: ${t.text};
    }

    .search input:focus { outline: 1px solid ${t.accent}; outline-offset: 1px; }

    .search-results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 320px;
      overflow-y: auto;
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 8px;
      box-shadow: ${t.shadow};
      z-index: 20;
      display: none;
    }

    .search-results.open { display: block; }

    .search-results button {
      display: block;
      width: 100%;
      text-align: left;
      appearance: none;
      border: 0;
      background: none;
      color: ${t.text};
      padding: 5px 8px;
      font-size: 0.68rem;
      font-family: ui-monospace, Menlo, monospace;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .search-results button:hover,
    .search-results button.active { background: ${t.accentSoft}; }
    .search-results .kind { color: ${t.muted}; margin-right: 6px; }

    .filter {
      position: relative;
      flex: 0 1 260px;
      min-width: 150px;
    }

    .filter input {
      width: 100%;
      padding: 5px 8px;
      font-size: 0.7rem;
      font-family: ui-monospace, Menlo, monospace;
      border: 1px solid ${t.border};
      border-radius: 6px;
      background: ${t.bg};
      color: ${t.text};
    }

    .filter input:focus { outline: 1px solid ${t.accent}; outline-offset: 1px; }
    .filter input.invalid { border-color: ${t.error}; }
    .filter input.invalid:focus { outline-color: ${t.error}; }

    .filter-msg {
      position: absolute;
      top: calc(100% + 3px);
      left: 0;
      z-index: 20;
      max-width: 380px;
      padding: 3px 8px;
      font-size: 0.64rem;
      border: 1px solid ${t.error};
      border-radius: 6px;
      background: ${t.bg};
      color: ${t.error};
    }

    .filter-msg[hidden] { display: none; }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-color: ${t.accent};
    }

    .filter-chip[hidden] { display: none; }

    .filter-chip button {
      appearance: none;
      border: 0;
      background: none;
      color: ${t.muted};
      cursor: pointer;
      padding: 0 2px;
      font-size: 0.7rem;
      line-height: 1;
    }

    .filter-chip button:hover { color: ${t.error}; }

    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.66rem;
      color: ${t.muted};
      cursor: pointer;
    }

    .chip.cycles { cursor: pointer; font: inherit; font-size: 0.65rem; color: ${t.text}; }
    .chip.cycles:hover { border-color: ${t.error}; }
    .chip.cycles strong { color: ${t.error}; }

    .mode-select {
      padding: 4px 6px;
      font-size: 0.66rem;
      border: 1px solid ${t.border};
      border-radius: 6px;
      background: ${t.bg};
      color: ${t.text};
      cursor: pointer;
    }

    .main {
      flex: 1;
      min-height: 0;
      display: flex;
    }

    .main .graph-wrap { flex: 1; min-width: 0; }

    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 0.75rem;
      color: ${t.muted};
      background: ${t.bg};
      z-index: 5;
    }

    .overlay.hidden { display: none; }

    .empty-note {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${t.muted};
      font-size: 0.75rem;
      pointer-events: none;
    }

    .empty-note[hidden] { display: none; }

    .detail {
      width: 300px;
      flex-shrink: 0;
      border-left: 1px solid ${t.border};
      background: ${t.surface};
      overflow-y: auto;
      padding: 10px 12px;
      font-size: 0.7rem;
    }

    .detail.hidden { display: none; }

    .detail h2 {
      font-size: 0.78rem;
      font-family: ui-monospace, Menlo, monospace;
      word-break: break-all;
      margin-bottom: 4px;
    }

    .detail .sub { color: ${t.muted}; margin-bottom: 8px; }

    .detail .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

    .detail h3 {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${t.muted};
      margin: 10px 0 4px;
    }

    .detail ul { list-style: none; padding: 0; margin: 0; }

    .detail li button {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      width: 100%;
      text-align: left;
      appearance: none;
      border: 0;
      background: none;
      color: ${t.text};
      padding: 3px 4px;
      border-radius: 4px;
      font-size: 0.66rem;
      font-family: ui-monospace, Menlo, monospace;
      cursor: pointer;
    }

    .detail li button:hover { background: ${t.accentSoft}; color: ${t.accent}; }
    .detail li .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail li .count { color: ${t.muted}; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .detail .pair .label { white-space: normal; word-break: break-all; }
    .detail .pair .arrow { color: ${t.muted}; }
    .detail .muted { color: ${t.muted}; }
    .detail .warn-note { color: ${t.error}; margin-bottom: 8px; }
    .detail .legend-list li { display: flex; align-items: center; gap: 6px; padding: 2px 4px; font-size: 0.66rem; font-family: ui-monospace, Menlo, monospace; }
    .detail .legend-list .swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .detail .legend-list .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .legend-item.cluster { background: ${t.accentSoft}; color: ${t.accent}; }
    .legend-item.file { background: ${t.depSoft}; color: ${t.dep}; }
    .legend-item.context { background: transparent; color: ${t.muted}; border: 1px dashed ${t.border}; }
    .legend-item.cycle { background: ${t.errorSoft}; color: ${t.error}; }

    .toolbar-btn.stale { border-color: ${t.warn}; color: ${t.warn}; }
`;

/** Opaque blend of two #rrggbb colours, so edges do not show through cluster fills. */
const mixHex = (from: string, to: string, amount: number): string => {
    const channels = (hex: string) =>
        [0, 2, 4].map((i) => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16));
    const a = channels(from);
    const b = channels(to);
    return `#${a
        .map((value, i) =>
            Math.round(value + (b[i] - value) * amount)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
};

export const getClusterGraphHtml = (
    title: string,
    isDark: boolean,
    assets: ClusterPanelAssets,
): string => {
    const t = getGraphTheme(isDark);
    const palette = {
        text: t.text,
        muted: t.muted,
        border: t.border,
        surface: t.surface,
        accent: t.accent,
        accentSoft: t.accentSoft,
        clusterFill: mixHex(t.surface, t.accent, isDark ? 0.25 : 0.14),
        dep: t.dep,
        depSoft: t.depSoft,
        warn: t.warn,
        warnSoft: t.warnSoft,
        errorSoft: t.errorSoft,
        error: t.error,
        bg: t.bg,
    };

    return panelDocument({
        title: 'Code Graph',
        csp: panelWebviewCsp(assets.cspSource),
        styles: clusterStyles(t),
        body: `
  <div class="toolbar">
    <div class="toolbar-title">
      <h1>Code Graph</h1>
      <p title="${escapeHtml(title)}">${escapeHtml(title)}</p>
    </div>
    <div class="search">
      <input id="search" type="search" placeholder="Find file or folder…" autocomplete="off" aria-label="Find file or folder">
      <div id="search-results" class="search-results" role="listbox"></div>
    </div>
    <div class="filter">
      <input id="filter-text" type="text" placeholder="Filter files: src/**  !**/*.test.*  auth" spellcheck="false" autocomplete="off" aria-label="Filter which files are in the graph" aria-invalid="false" title="Which files are in the graph. Comma or space separated patterns, relative to the workspace root; a leading ! excludes. Plain text (auth) keeps paths containing it; globs (src/features/**, *.ts) use * ** ? {a,b}. A pattern without / matches a file or folder name at any depth. Excludes always win; empty = all files.">
      <div id="filter-msg" class="filter-msg" role="alert" hidden></div>
    </div>
    <label class="toggle" title="Leave out test files (*.test.*, *.spec.*, __tests__/, test/, …)"><input type="checkbox" id="filter-tests"> Hide tests</label>
    <select id="filter-min" class="mode-select" aria-label="Minimum importers" title="Keep only files imported by at least this many other files (counted among the files left by the filter)">
      <option value="0">Importers: any</option>
      <option value="1">Importers: 1+</option>
      <option value="2">Importers: 2+</option>
      <option value="5">Importers: 5+</option>
    </select>
    <div class="toolbar-meta">
      <span class="chip filter-chip" id="chip-filter" hidden title="A filter is limiting the graph"><span id="chip-filter-text"></span><button type="button" id="filter-clear" aria-label="Clear filter" title="Clear filter">✕</button></span>
      <span class="chip" id="chip-files" title="Files in this level / whole index"></span>
      <span class="chip" id="chip-io" title="Imports crossing this folder: into it / out of it"></span>
      <button type="button" class="chip cycles" id="chip-cycles" title="Groups of nodes that import each other in a loop — click to list"></button>
      <select id="mode" class="mode-select" aria-label="Group by" title="Group files by folder structure, or by communities detected from imports">
        <option value="folders">Group: folders</option>
        <option value="communities">Group: communities</option>
      </select>
      <select id="layout" class="mode-select" aria-label="Layout" title="Layers: importers on top, what they import below; red edges point back up. Force: free physics layout.">
        <option value="layers">Layout: layers</option>
        <option value="force">Layout: force</option>
      </select>
      <select id="view" class="mode-select" aria-label="View" title="Clusters: one group at a time, click to drill down. Full map: every file and import at once (zoom in for labels).">
        <option value="clusters">View: clusters</option>
        <option value="full">View: full map</option>
      </select>
      <select id="highlight" class="mode-select" aria-label="Highlight" title="Unused: files nothing imports (red) or only tests import (orange). Hubs: the most imported files, labelled with their importer count.">
        <option value="none">Highlight: none</option>
        <option value="unused">Highlight: unused</option>
        <option value="hubs">Highlight: hubs</option>
      </select>
      <select id="min-weight" class="mode-select" aria-label="Minimum imports per edge" title="Hide edges with fewer imports (cycle edges use half the limit). The hovered node's edges always show.">
        <option value="auto">Edges: auto</option>
        <option value="1">Edges: all</option>
        <option value="2">Edges: ≥2</option>
        <option value="5">Edges: ≥5</option>
        <option value="10">Edges: ≥10</option>
        <option value="25">Edges: ≥25</option>
        <option value="50">Edges: ≥50</option>
      </select>
      <span class="chip" id="chip-edges" title="Edges shown / edges at this level"></span>
      <label class="toggle"><input type="checkbox" id="toggle-packages"> Packages</label>
      <button type="button" class="toolbar-btn" id="fit-btn">Fit</button>
      <button type="button" class="toolbar-btn" id="reload-btn">Reload</button>
    </div>
  </div>
  <nav class="crumbs" id="crumbs" aria-label="Folder path"></nav>

  <div class="main">
    <div class="graph-wrap">
      <div id="graph"></div>
      <div id="empty" class="empty-note" hidden>No source files in this folder.</div>
      <div id="overlay" class="overlay"><div class="spinner"></div><span id="overlay-text">Building index…</span></div>
      <div class="hint">
        <span class="legend-item cluster">group</span>
        <span class="legend-item file">file</span>
        <span class="legend-item context">outside</span>
        <span class="legend-item cycle">breaks layering</span>
        · hover to trace · click group to enter · Backspace up · double-click file opens
      </div>
    </div>
    <aside id="detail" class="detail" aria-live="polite"></aside>
  </div>

  <script src="${escapeHtml(assets.visScriptUri)}"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const C = ${JSON.stringify(palette)};
    const MONO = "ui-monospace, Menlo, monospace";

    let level = null;
    let showPackages = false;
    let selectedFile = null;
    let nodeKinds = new Map();

    const container = document.getElementById("graph");
    const overlay = document.getElementById("overlay");
    const overlayText = document.getElementById("overlay-text");
    const detailEl = document.getElementById("detail");
    const crumbsEl = document.getElementById("crumbs");
    const reloadBtn = document.getElementById("reload-btn");

    const nodes = new vis.DataSet();
    const edges = new vis.DataSet();
    /** Auto edge filter keeps at most this many edges. */
    const AUTO_MAX_EDGES = 60;
    const WEIGHT_STEPS = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
    const layoutEl = document.getElementById("layout");
    const highlightEl = document.getElementById("highlight");
    const viewEl = document.getElementById("view");
    /** Full map: above this many edges only the hovered/selected file's edges are drawn. */
    const FULL_EDGE_LIMIT = 2500;
    const FULL_ITERATIONS = 150;
    const GROUP_COLORS = ["#6366f1", "#06b6d4", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#84cc16", "#0ea5e9", "#e11d48", "#a855f7"];

    function isFull() {
      return Boolean(level && level.full);
    }
    const minWeightEl = document.getElementById("min-weight");
    let allEdges = [];
    let threshold = 1;
    let focusId = null;
    let pinnedId = null;
    let forcedEdges = new Set();

    const network = new vis.Network(container, { nodes, edges }, {
      autoResize: true,
      physics: { enabled: false },
      interaction: { hover: true, tooltipDelay: 120, dragNodes: true, multiselect: false, hoverConnectedEdges: false },
      edges: { smooth: { type: "continuous" } },
    });

    function layoutOptions() {
      if (layoutEl.value === "force") {
        return {
          layout: { hierarchical: { enabled: false } },
          physics: {
            enabled: true,
            solver: "forceAtlas2Based",
            forceAtlas2Based: { gravitationalConstant: -120, springLength: 160, avoidOverlap: 0.8 },
            stabilization: { enabled: true, iterations: 300, fit: true },
          },
          edges: { smooth: { type: "continuous" } },
        };
      }
      return {
        layout: { hierarchical: { enabled: false } },
        physics: { enabled: false },
        edges: { smooth: { type: "cubicBezier", forceDirection: "vertical", roundness: 0.45 } },
      };
    }

    const BAND_GAP = 170;
    const NODE_GAP = 200;
    const SWEEPS = 4;

    /**
     * Layered positions computed here rather than by vis' hierarchical layout, which pushes weakly
     * connected nodes far to the side. Each band is ordered by the barycenter of its neighbours in
     * the other bands (a few down/up sweeps), then centred.
     */
    function layerPositions(list) {
      const bands = new Map();
      for (const node of list) {
        const band = node.layer || 0;
        if (!bands.has(band)) bands.set(band, []);
        bands.get(band).push(node.id);
      }
      const bandIds = [...bands.keys()].sort((a, b) => a - b);
      const bandOf = new Map(list.map((node) => [node.id, node.layer || 0]));
      const neighbours = new Map(list.map((node) => [node.id, []]));
      for (const edge of allEdges) {
        if (!neighbours.has(edge.from) || !neighbours.has(edge.to)) continue;
        const w = Math.log2(edge.count + 1);
        neighbours.get(edge.from).push([edge.to, w]);
        neighbours.get(edge.to).push([edge.from, w]);
      }
      const sizeOf = new Map(list.map((node) => [node.id, node.fileCount || 0]));
      const slot = new Map();
      const place = (band) => bands.get(band).forEach((id, i) => slot.set(id, i - (bands.get(band).length - 1) / 2));

      // Start with the biggest nodes in the middle of each band.
      for (const band of bandIds) {
        const ids = bands.get(band).sort((a, b) => sizeOf.get(b) - sizeOf.get(a));
        const centred = [];
        ids.forEach((id, i) => (i % 2 ? centred.push(id) : centred.unshift(id)));
        bands.set(band, centred);
        place(band);
      }

      const barycenter = (id, useBand) => {
        let sum = 0;
        let weight = 0;
        for (const [other, w] of neighbours.get(id)) {
          if (useBand(bandOf.get(other)) && slot.has(other)) {
            sum += slot.get(other) * w;
            weight += w;
          }
        }
        return weight ? sum / weight : slot.get(id);
      };

      for (let sweep = 0; sweep < SWEEPS; sweep++) {
        const down = sweep % 2 === 0;
        const order = down ? bandIds : [...bandIds].reverse();
        for (const band of order) {
          const useBand = (other) => (down ? other < band : other > band) || other === undefined;
          const keyed = bands.get(band).map((id) => [id, barycenter(id, useBand)]);
          keyed.sort((a, b) => a[1] - b[1]);
          bands.set(band, keyed.map(([id]) => id));
          place(band);
        }
      }

      return list.map((node) => ({ id: node.id, x: slot.get(node.id) * NODE_GAP, y: (node.layer || 0) * BAND_GAP }));
    }

    // Freeze positions once laid out so filtering/highlighting never re-runs the layout.
    function afterLayout() {
      network.storePositions();
      network.setOptions({ layout: { hierarchical: { enabled: false } }, physics: { enabled: false } });
      network.fit({ animation: { duration: 250 } });
      if (level && level.focus && nodes.get(level.focus)) {
        network.selectNodes([level.focus]);
      }
    }

    network.on("stabilizationIterationsDone", () => {
      if (layoutEl.value === "force" || isFull()) afterLayout();
      if (isFull()) setLoading(null);
    });

    network.on("stabilizationProgress", (params) => {
      if (isFull()) setLoading("Laying out " + level.nodes.length + " files… " + Math.round((params.iterations / params.total) * 100) + "%");
    });

    function fullMapOptions() {
      return {
        layout: { hierarchical: { enabled: false }, improvedLayout: false },
        physics: {
          enabled: true,
          solver: "barnesHut",
          barnesHut: { gravitationalConstant: -2500, centralGravity: 0.25, springLength: 80, springConstant: 0.03, avoidOverlap: 0.1 },
          stabilization: { enabled: true, iterations: FULL_ITERATIONS, updateInterval: 50, fit: true },
        },
        edges: { smooth: false },
        nodes: { scaling: { min: 4, max: 26, label: { enabled: true, min: 9, max: 16, drawThreshold: 7, maxVisible: 22 } } },
      };
    }

    function setLoading(text) {
      if (text) {
        overlayText.textContent = text;
        overlay.classList.remove("hidden");
      } else {
        overlay.classList.add("hidden");
      }
    }

    function short(text, max) {
      return text.length <= max ? text : "…" + text.slice(-(max - 1));
    }

    /** Files with at least this share of the level's top importer count are drawn as hubs. */
    const HUB_SHARE = 0.25;

    function hubThreshold() {
      const max = Math.max(0, ...((level && level.nodes) || []).filter((n) => n.kind === "file").map((n) => n.fanIn || 0));
      return Math.max(3, Math.ceil(max * HUB_SHARE));
    }

    function fullMapNode(node, focus) {
      const hl = highlightEl.value;
      const fanIn = node.fanIn || 0;
      const groupColor = node.colorGroup >= 0 ? GROUP_COLORS[node.colorGroup % GROUP_COLORS.length] : C.muted;
      let color = groupColor;
      let opacity = 1;
      if (hl === "unused") {
        if (node.usage === "unused") color = C.error;
        else if (node.usage === "test-only") color = C.warn;
        else opacity = 0.2;
      } else if (hl === "hubs") {
        if (fanIn < hubThreshold()) opacity = 0.3;
      }
      const usageNote = node.usage === "unused" ? " — nothing imports this file" : node.usage === "test-only" ? " — only tests import this file" : "";
      return {
        id: node.id, kind: node.kind, fullLabel: node.label, shape: "dot", value: fanIn + 1, opacity,
        label: node.label,
        title: node.id + " — imported by " + fanIn + " file" + (fanIn === 1 ? "" : "s") + usageNote,
        color: { background: color, border: node.id === focus ? C.warn : color, highlight: { background: color, border: C.warn }, hover: { background: color, border: C.text } },
        borderWidth: node.id === focus ? 3 : 1,
        font: { color: C.text, face: MONO, size: 10, strokeWidth: 3, strokeColor: C.bg },
      };
    }

    function visNode(node, focus) {
      if (isFull()) return fullMapNode(node, focus);
      const hl = highlightEl.value;
      const base = { id: node.id, kind: node.kind, fullLabel: node.label, opacity: 1, font: { color: C.text, face: MONO, size: 11 } };
      const focused = node.id === focus;
      if (node.kind === "cluster") {
        const size = Math.min(36, 10 + 4 * Math.log2(node.fileCount + 1));
        const lines = [short(node.label, 36), node.fileCount + " file" + (node.fileCount === 1 ? "" : "s")];
        let border = C.accent;
        let opacity = 1;
        if (hl === "unused") {
          if (node.unusedCount) {
            lines.push("⚠ " + node.unusedCount + " unused");
            border = C.error;
          } else {
            opacity = 0.35;
          }
        } else if (hl === "hubs" && node.topHub) {
          lines.push("★ " + short(node.topHub.label, 24) + " ← " + node.topHub.fanIn);
        }
        return { ...base, shape: "dot", size, opacity,
          label: lines.join("\\n"),
          title: (node.title || node.label) + " — " + node.fileCount + " files" +
            (node.unusedCount ? ", " + node.unusedCount + " unused" : "") +
            (node.topHub ? ", most imported: " + node.topHub.label + " (" + node.topHub.fanIn + ")" : "") + " (click to open)",
          color: { background: C.clusterFill, border, highlight: { background: C.clusterFill, border: C.warn }, hover: { background: C.clusterFill, border } },
          borderWidth: 2, font: { ...base.font, size: 12 } };
      }
      if (node.kind === "file") {
        const fanIn = node.fanIn || 0;
        let label = short(node.label, 32);
        let background = C.depSoft;
        let border = focused ? C.warn : C.dep;
        let dashes = false;
        let opacity = 1;
        let fontSize = 11;
        // Unused files always get a red dashed outline: they are the ones "floating" alone.
        if (node.usage === "unused") {
          border = C.error;
          dashes = [4, 3];
          if (hl === "unused") {
            background = C.errorSoft;
            label = "✕ " + label;
          }
        } else if (node.usage === "test-only" && hl === "unused") {
          border = C.warn;
          dashes = [4, 3];
          label = "◐ " + label;
        } else if (hl === "unused") {
          opacity = 0.35;
        }
        if (hl === "hubs") {
          const hub = fanIn >= hubThreshold();
          label += "\\n← " + fanIn;
          if (hub) {
            background = C.warnSoft;
            border = C.warn;
            fontSize = 12 + Math.min(4, Math.round(Math.log2(fanIn)));
          } else {
            opacity = 0.55;
          }
        }
        const usageNote = node.usage === "unused" ? " — nothing imports this file" : node.usage === "test-only" ? " — only tests import this file" : "";
        return { ...base, shape: "box", margin: 6, label, opacity,
          title: node.id + " — imported by " + fanIn + " file" + (fanIn === 1 ? "" : "s") + usageNote + " (double-click to open)",
          shapeProperties: { borderDashes: dashes },
          color: { background, border: focused ? C.warn : border, highlight: { background, border: C.accent } },
          borderWidth: focused ? 3 : dashes ? 2 : 1,
          font: { ...base.font, size: fontSize } };
      }
      if (node.kind === "package") {
        return { ...base, shape: "ellipse", label: short(node.label, 28),
          title: node.label + " — imported by " + node.fileCount + " file(s) here",
          color: { background: C.warnSoft, border: C.warn, highlight: { background: C.warnSoft, border: C.accent } } };
      }
      // context / more
      return { ...base, shape: "box", margin: 6,
        label: (node.kind === "context" ? "↗ " : "") + short(node.label, 34),
        title: node.kind === "context" ? (node.title || node.label) + " (outside this group — click to go there)" : node.label,
        shapeProperties: { borderDashes: [4, 3] },
        opacity: hl === "none" ? 1 : 0.5,
        color: { background: C.surface, border: C.muted, highlight: { background: C.surface, border: C.accent } },
        font: { ...base.font, color: C.muted } };
    }

    /** Cycle edges get half the threshold: they matter more, but hundreds of them are noise too. */
    function passes(edge, t) {
      return edge.count >= (edge.cyclic ? Math.ceil(t / 2) : t);
    }

    function chooseThreshold() {
      if (minWeightEl.value !== "auto") return Number(minWeightEl.value);
      for (const t of WEIGHT_STEPS) {
        if (allEdges.filter((e) => passes(e, t)).length <= AUTO_MAX_EDGES) return t;
      }
      return WEIGHT_STEPS[WEIGHT_STEPS.length - 1];
    }

    function edgeId(edge) {
      return edge.from + "\\n" + edge.to;
    }

    function fullMapEdge(edge) {
      const touches = focusId !== null && (edge.from === focusId || edge.to === focusId);
      const dim = focusId !== null && !touches;
      return {
        id: edgeId(edge), from: edge.from, to: edge.to,
        hidden: !(touches || allEdges.length <= FULL_EDGE_LIMIT),
        width: touches ? 1.5 : 0.5,
        arrows: { to: { enabled: touches, scaleFactor: 0.4 } },
        color: { color: touches ? C.accent : C.muted, opacity: dim ? 0.04 : touches ? 0.9 : 0.18, highlight: C.accent, hover: C.accent },
        title: edge.from + " → " + edge.to,
      };
    }

    function visEdge(edge) {
      if (isFull()) return fullMapEdge(edge);
      const touches = focusId !== null && (edge.from === focusId || edge.to === focusId);
      const dim = focusId !== null && !touches;
      const visible = touches || passes(edge, threshold) || forcedEdges.has(edgeId(edge));
      const base = edge.cyclic ? C.error : C.muted;
      const opacity = dim ? 0.07 : touches ? 0.95 : edge.cyclic ? 0.85 : 0.4;
      const layered = layoutEl.value === "layers";
      return {
        id: edgeId(edge),
        from: edge.from,
        to: edge.to,
        hidden: !visible,
        width: Math.min(7, 0.6 + 0.9 * Math.log2(edge.count + 1)),
        label: touches || forcedEdges.has(edgeId(edge)) ? String(edge.count) : "",
        font: { size: 10, color: C.text, strokeWidth: 3, strokeColor: C.bg, align: "middle" },
        arrows: { to: { enabled: true, scaleFactor: 0.55 } },
        color: { color: base, opacity, highlight: edge.cyclic ? C.error : C.accent, hover: edge.cyclic ? C.error : C.accent },
        // Back edges point upward in the layered view; curve them so they do not hide downward ones.
        smooth: layered && edge.cyclic ? { type: "curvedCW", roundness: 0.3 } : undefined,
        title: edge.from + " → " + edge.to + ": " + edge.count + " import" + (edge.count === 1 ? "" : "s") +
          (edge.cyclic ? " — goes against the layering (part of a cycle)" : ""),
      };
    }

    function refreshEdges() {
      edges.update(allEdges.map(visEdge));
      const shown = edges.get({ filter: (e) => !e.hidden }).length;
      const chip = document.getElementById("chip-edges");
      chip.innerHTML = "<strong>" + shown + "</strong> / " + allEdges.length + " edges";
      chip.title = threshold > 1 ? "Hiding edges with fewer than " + threshold + " imports (" + Math.ceil(threshold / 2) + " for cycle edges)" : "All edges shown";
    }

    function setFocus(id) {
      if (focusId === id) return;
      focusId = id;
      refreshEdges();
    }

    function renderCrumbs(crumbs) {
      crumbsEl.replaceChildren();
      crumbs.forEach((crumb, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "sep";
          sep.textContent = "›";
          crumbsEl.appendChild(sep);
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = crumb.label;
        if (i === crumbs.length - 1) {
          btn.setAttribute("aria-current", "page");
        } else {
          btn.addEventListener("click", () => navigate(crumb.path));
        }
        crumbsEl.appendChild(btn);
      });
    }

    function renderStats(stats) {
      document.getElementById("chip-files").innerHTML = "<strong>" + stats.files + "</strong> / " + stats.totalFiles + " files";
      document.getElementById("chip-io").innerHTML = "<strong>" + stats.inbound + "</strong> in · <strong>" + stats.outbound + "</strong> out";
      const cycles = document.getElementById("chip-cycles");
      cycles.innerHTML = "<strong>" + stats.cycles + "</strong> cycle" + (stats.cycles === 1 ? "" : "s");
      cycles.hidden = stats.cycles === 0;
    }

    function renderLevel(next) {
      level = next;
      modeEl.value = next.mode;
      nodeKinds = new Map(next.nodes.map((node) => [node.id, node]));
      renderCrumbs(next.crumbs);
      renderStats(next.stats);
      renderFilterChip(next.filter);
      filterPending = false;
      document.getElementById("empty").hidden = next.nodes.length > 0;

      allEdges = next.edges;
      threshold = chooseThreshold();
      pinnedId = next.focus || null;
      focusId = pinnedId;
      forcedEdges = new Set();

      nodes.clear();
      edges.clear();
      viewEl.value = next.full ? "full" : "clusters";
      layoutEl.disabled = Boolean(next.full);
      minWeightEl.disabled = Boolean(next.full);
      network.setOptions(next.full ? fullMapOptions() : { ...layoutOptions(), nodes: { scaling: { label: { enabled: false } } } });
      nodes.add(next.nodes.map((node) => ({ ...visNode(node, next.focus), level: node.layer || 0 })));
      edges.add(allEdges.map(visEdge));
      refreshEdges();
      if (next.full) {
        setLoading("Laying out " + next.nodes.length + " files…");
        // Let the overlay paint before the (synchronous) stabilisation starts.
        setTimeout(() => network.stabilize(FULL_ITERATIONS), 30);
        if (next.focus) requestDetail(next.focus); else hideDetail();
        return;
      }
      if (layoutEl.value === "force") {
        network.stabilize(300);
      } else {
        nodes.update(layerPositions(next.nodes));
        network.once("afterDrawing", afterLayout);
        network.redraw();
      }
      setLoading(null);
      if (next.focus) {
        requestDetail(next.focus);
      } else {
        hideDetail();
      }
    }

    function navigate(path, focus) {
      setLoading("Loading…");
      vscode.postMessage({ type: "navigate", path, focus });
    }

    function navigateFile(rel) {
      setLoading("Loading…");
      vscode.postMessage({ type: "navigateFile", rel });
    }

    function goUp() {
      if (level && level.crumbs.length > 1) {
        navigate(level.crumbs[level.crumbs.length - 2].path);
      }
    }

    function requestDetail(id) {
      if (!level) return;
      vscode.postMessage({ type: "detail", path: level.path, id });
    }

    // ─── detail panel ─────────────────────────────────────────────

    // The panel always keeps its width so the graph does not shift when details change.
    // With nothing selected it shows the level's insights: dead files and hubs.
    function hideDetail() {
      selectedFile = null;
      detailEl.replaceChildren();
      const info = level && level.insights;
      if (!info) {
        detailEl.appendChild(el("p", "muted", "Click a group to open it, a file or edge for details. Hover a node to trace its imports."));
        return;
      }
      const where = level.full ? "full map" : level.crumbs.length ? level.crumbs[level.crumbs.length - 1].label : "root";
      detailEl.appendChild(el("h2", "", "Insights — " + where));
      if (level.full) {
        detailEl.appendChild(el("p", "sub", level.nodes.length + " files, " + allEdges.length + " imports. Zoom in for labels; hover a file to trace it." +
          (allEdges.length > FULL_EDGE_LIMIT ? " Edges show for the hovered or selected file only." : "")));
        if (level.truncated) {
          detailEl.appendChild(el("p", "warn-note", level.truncated + " least connected files left out to keep the map responsive."));
        }
        if (level.legend && level.legend.length) {
          detailEl.appendChild(el("h3", "", "Colours"));
          const ul = el("ul", "legend-list");
          level.legend.forEach((entry, i) => {
            const li = el("li");
            const swatch = el("span", "swatch");
            swatch.style.background = GROUP_COLORS[i % GROUP_COLORS.length];
            li.appendChild(swatch);
            li.appendChild(el("span", "label", entry.label));
            li.appendChild(el("span", "count", String(entry.count)));
            ul.appendChild(li);
          });
          detailEl.appendChild(ul);
        }
      } else {
        detailEl.appendChild(el("p", "sub", "Files in this group and everything below it."));
      }
      detailEl.appendChild(itemList("Unused files", info.unused, openItem, "None — every file is imported or is an entry point."));
      if (info.testOnly.length) {
        detailEl.appendChild(itemList("Only used by tests", info.testOnly, openItem));
      }
      detailEl.appendChild(itemList("Most imported files", info.hubs.map((hub) => ({ ...hub, title: hub.label + " — imported by " + hub.count + " files from " + hub.spread + " folders" })), openItem, "No file is imported more than once."));
      detailEl.appendChild(itemList("Most imported exports", info.hubSymbols.map((sym) => ({ ...sym, label: sym.label + " · " + sym.id.split("/").pop(), title: sym.label + " from " + sym.id + " — imported by " + sym.count + " files" })), openItem, "No export is imported by more than one file."));
      detailEl.appendChild(el("p", "muted", "Unused = no file imports it and it is not an entry point, barrel or test. Hover a node to trace its imports; red edges go against the layering."));
    }

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function actionButton(label, onClick) {
      const btn = el("button", "toolbar-btn", label);
      btn.type = "button";
      btn.addEventListener("click", onClick);
      return btn;
    }

    function itemList(title, items, onClick, emptyText) {
      const frag = document.createDocumentFragment();
      frag.appendChild(el("h3", "", title + " (" + items.length + ")"));
      if (!items.length) {
        frag.appendChild(el("p", "muted", emptyText || "None"));
        return frag;
      }
      const ul = el("ul");
      for (const item of items) {
        const li = el("li");
        const btn = el("button");
        btn.type = "button";
        btn.title = item.title || item.label;
        btn.appendChild(el("span", "label", item.label));
        if (item.count !== undefined) btn.appendChild(el("span", "count", String(item.count)));
        btn.addEventListener("click", () => onClick(item));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      frag.appendChild(ul);
      return frag;
    }

    /** In the full map files are selected where they are; elsewhere this opens their group. */
    function showFile(rel) {
      if (isFull() && nodes.get(rel)) {
        pinnedId = rel;
        setFocus(rel);
        network.selectNodes([rel]);
        network.focus(rel, { scale: 1.2, animation: { duration: 300 } });
        requestDetail(rel);
        return;
      }
      navigateFile(rel);
    }

    const openItem = (item) => showFile(item.id);

    function goToTarget(item) {
      // Items with a path are files; the rest are folders.
      if (item.path) {
        navigateFile(item.id);
      } else {
        navigate(item.id);
      }
    }

    function renderDetail(detail) {
      detailEl.replaceChildren();
      detailEl.appendChild(el("h2", "", detail.title));
      const actions = el("div", "actions");

      if (detail.kind === "file") {
        selectedFile = detail.id;
        detailEl.appendChild(el("p", "sub", "File"));
        actions.appendChild(actionButton("Open", () => vscode.postMessage({ type: "open", path: detail.absolutePath })));
        actions.appendChild(actionButton("Focus graph", () => vscode.postMessage({ type: "focusFile", path: detail.absolutePath })));
        actions.appendChild(actionButton("Copy for AI", () => vscode.postMessage({ type: "copyContent", ids: [detail.id] })));
        detailEl.appendChild(actions);
        const usage = detail.fileUsage;
        if (usage) {
          const summary = usage.usage === "unused"
            ? "⚠ Nothing imports this file (and it is not an entry point)."
            : usage.usage === "test-only"
              ? "◐ Only tests import this file."
              : "Imported by " + usage.fanIn + " file" + (usage.fanIn === 1 ? "" : "s") + " from " + usage.spread + " folder" + (usage.spread === 1 ? "" : "s") + ".";
          detailEl.appendChild(el("p", usage.usage ? "warn-note" : "sub", summary));
          if (usage.symbols.length || usage.unusedExports.length) {
            const used = usage.symbols.map((sym) => ({ id: detail.id, label: sym.name, count: sym.users, title: sym.name + " — imported by " + sym.users + " files" }));
            detailEl.appendChild(itemList("Exports in use", used, () => vscode.postMessage({ type: "open", path: detail.absolutePath }), "No named imports of this file."));
            if (usage.namespaceUsers) {
              detailEl.appendChild(el("p", "muted", usage.namespaceUsers + " file(s) import it as a namespace (import * as …)."));
            }
            const dead = usage.unusedExports.map((exp) => ({ id: detail.id, label: exp.name + " (" + exp.kind + ")", line: exp.line, title: "Not imported anywhere — click to open" + (exp.line ? " at line " + exp.line : "") }));
            detailEl.appendChild(itemList("Unused exports", dead, (item) => vscode.postMessage({ type: "open", path: detail.absolutePath, line: item.line || 0 }), "None"));
          }
        }
        detailEl.appendChild(itemList("Imports", detail.dependencies || [], openItem));
        detailEl.appendChild(itemList("Imported by", detail.dependents || [], openItem));
        if (detail.packages && detail.packages.length) {
          detailEl.appendChild(el("h3", "", "Packages (" + detail.packages.length + ")"));
          detailEl.appendChild(el("p", "muted", detail.packages.join(", ")));
        }
        return;
      }

      if (detail.kind === "cluster") {
        if (detail.fileCount !== undefined) {
          detailEl.appendChild(el("p", "sub", detail.fileCount + " source files"));
          actions.appendChild(actionButton("Enter", () => navigate(detail.id)));
          actions.appendChild(actionButton("Copy paths", () => vscode.postMessage({ type: "copyPaths", ids: [detail.id] })));
          actions.appendChild(actionButton("Copy for AI", () => vscode.postMessage({ type: "copyContent", ids: [detail.id] })));
          detailEl.appendChild(actions);
        }
        if (detail.folders) {
          detailEl.appendChild(itemList("Folders", detail.folders, (item) => switchMode("folders", { dir: item.id === "root" ? "" : item.id })));
        }
        detailEl.appendChild(itemList("Uses", detail.uses || [], goToTarget));
        detailEl.appendChild(itemList("Used by", detail.usedBy || [], goToTarget));
        return;
      }

      if (detail.kind === "more") {
        detailEl.appendChild(el("p", "sub", "Smaller groups and less connected files hidden from the graph"));
        if (detail.groups && detail.groups.length) {
          detailEl.appendChild(itemList("Groups", detail.groups, (item) => navigate(item.id)));
        }
        if (detail.files && detail.files.length) {
          detailEl.appendChild(itemList("Files", detail.files, openItem));
        }
        return;
      }

      if (detail.kind === "package") {
        detailEl.appendChild(el("p", "sub", "External package"));
        detailEl.appendChild(itemList("Imported by", detail.usedBy || [], openItem));
      }
    }

    function renderEdgeDetail(detail) {
      detailEl.replaceChildren();
      detailEl.appendChild(el("h2", "", detail.from + " → " + detail.to));
      detailEl.appendChild(el("p", "sub", detail.total + " import" + (detail.total === 1 ? "" : "s") +
        (detail.pairs.length < detail.total ? " (first " + detail.pairs.length + " shown)" : "")));
      const ul = el("ul");
      for (const pair of detail.pairs) {
        const li = el("li", "pair");
        const btn = el("button");
        btn.type = "button";
        btn.title = pair.from + " → " + pair.to + " (click to open importer)";
        const label = el("span", "label");
        label.appendChild(document.createTextNode(pair.from + " "));
        label.appendChild(el("span", "arrow", "→"));
        label.appendChild(document.createTextNode(" " + pair.to));
        btn.appendChild(label);
        btn.addEventListener("click", () => vscode.postMessage({ type: "open", path: pair.fromPath }));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      detailEl.appendChild(ul);
    }

    // ─── interactions ─────────────────────────────────────────────

    network.on("click", (params) => {
      if (params.nodes.length) {
        const id = params.nodes[0];
        const node = nodeKinds.get(id);
        if (!node) return;
        if (node.kind === "cluster") {
          navigate(id);
        } else if (node.kind === "context" && id !== "::outside") {
          node.isFile ? navigateFile(id) : navigate(id);
        } else {
          pinnedId = id;
          forcedEdges = new Set();
          setFocus(id);
          requestDetail(id);
        }
        return;
      }
      if (params.edges.length && level && !isFull()) {
        const edge = edges.get(params.edges[0]);
        if (edge) {
          vscode.postMessage({ type: "edgeDetail", path: level.path, from: edge.from, to: edge.to });
        }
        return;
      }
      pinnedId = null;
      forcedEdges = new Set();
      setFocus(null);
      refreshEdges();
      hideDetail();
    });

    // Hover traces a node's imports; a clicked file/package stays traced until the background is clicked.
    network.on("hoverNode", (params) => {
      if (!pinnedId) setFocus(params.node);
    });
    network.on("blurNode", () => {
      if (!pinnedId) setFocus(null);
    });

    layoutEl.addEventListener("change", () => {
      if (level) renderLevel(level);
    });

    viewEl.addEventListener("change", () => {
      if (viewEl.value === "full") {
        setLoading("Loading full map…");
        vscode.postMessage({ type: "fullMap" });
      } else if (level) {
        navigate(level.crumbs[0].path);
      }
    });

    highlightEl.addEventListener("change", () => {
      if (level) nodes.update(level.nodes.map((node) => visNode(node, level.focus)));
    });

    minWeightEl.addEventListener("change", () => {
      threshold = chooseThreshold();
      refreshEdges();
    });

    network.on("doubleClick", (params) => {
      if (!params.nodes.length) return;
      const node = nodeKinds.get(params.nodes[0]);
      if (node && node.kind === "file") {
        vscode.postMessage({ type: "openRel", rel: node.id });
      }
    });

    document.getElementById("fit-btn").addEventListener("click", () => network.fit({ animation: { duration: 250 } }));

    document.getElementById("toggle-packages").addEventListener("change", (event) => {
      showPackages = event.target.checked;
      vscode.postMessage({ type: "packages", show: showPackages });
      if (level) navigate(level.path);
    });

    reloadBtn.addEventListener("click", () => {
      reloadBtn.disabled = true;
      reloadBtn.textContent = "Reloading…";
      setLoading("Rebuilding index…");
      vscode.postMessage({ type: "reload", path: level ? level.path : undefined });
    });

    document.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLInputElement;
      if ((!typing && event.key === "Backspace") || (event.altKey && event.key === "ArrowLeft")) {
        event.preventDefault();
        goUp();
      }
    });

    // ─── cycles & grouping mode ───────────────────────────────────

    function labelOf(id) {
      const node = nodeKinds.get(id);
      return node ? node.label : id;
    }

    function selectCycle(members) {
      const inCycle = new Set(members);
      const cycleEdges = allEdges.filter((edge) => inCycle.has(edge.from) && inCycle.has(edge.to)).map(edgeId);
      pinnedId = null;
      focusId = null;
      forcedEdges = new Set(cycleEdges);
      refreshEdges();
      network.setSelection({ nodes: members, edges: cycleEdges }, { highlightEdges: false });
      network.fit({ nodes: members, animation: { duration: 300 } });
    }

    function renderCycles() {
      if (!level) return;
      selectedFile = null;
      detailEl.replaceChildren();
      const count = level.cycleGroups.length;
      detailEl.appendChild(el("h2", "", count + " dependency cycle" + (count === 1 ? "" : "s")));
      detailEl.appendChild(el("p", "sub", "Nodes in each group can reach each other through imports. Red edges are the imports that go against the layering — usually the ones to remove. Click a group to highlight it; click an edge for the files behind it."));
      const ul = el("ul");
      level.cycleGroups.forEach((members, i) => {
        const li = el("li");
        const btn = el("button");
        btn.type = "button";
        const label = el("span", "label", members.map(labelOf).join(" ⇄ "));
        label.style.whiteSpace = "normal";
        btn.appendChild(label);
        btn.appendChild(el("span", "count", members.length + " nodes"));
        btn.title = "Cycle " + (i + 1);
        btn.addEventListener("click", () => selectCycle(members));
        li.appendChild(btn);
        ul.appendChild(li);
      });
      detailEl.appendChild(ul);
    }

    document.getElementById("chip-cycles").addEventListener("click", renderCycles);

    const modeEl = document.getElementById("mode");

    function switchMode(mode, extra) {
      modeEl.value = mode;
      setLoading(mode === "communities" ? "Detecting communities…" : "Loading…");
      vscode.postMessage({ type: "mode", mode, ...(extra || {}) });
    }

    modeEl.addEventListener("change", () => {
      switchMode(modeEl.value, selectedFile ? { focus: selectedFile } : undefined);
    });

    // ─── search ───────────────────────────────────────────────────

    const searchInput = document.getElementById("search");
    const searchResults = document.getElementById("search-results");
    let searchTimer;
    let activeHit = -1;

    function closeSearch() {
      searchResults.classList.remove("open");
      activeHit = -1;
    }

    function pickHit(hit) {
      closeSearch();
      searchInput.value = "";
      if (hit.kind === "file") {
        showFile(hit.rel);
      } else {
        navigate(hit.level);
      }
    }

    function renderSearch(hits) {
      searchResults.replaceChildren();
      activeHit = -1;
      if (!hits.length) {
        searchResults.appendChild(el("button", "", "No matches"));
      }
      for (const hit of hits) {
        const btn = el("button");
        btn.type = "button";
        btn.title = hit.rel;
        btn.appendChild(el("span", "kind", hit.kind === "file" ? "file" : "dir"));
        btn.appendChild(document.createTextNode(hit.rel));
        btn.addEventListener("click", () => pickHit(hit));
        btn.hit = hit;
        searchResults.appendChild(btn);
      }
      searchResults.classList.add("open");
    }

    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (!q) {
        closeSearch();
        return;
      }
      searchTimer = setTimeout(() => vscode.postMessage({ type: "search", query: q }), 120);
    });

    searchInput.addEventListener("keydown", (event) => {
      const buttons = [...searchResults.querySelectorAll("button")].filter((btn) => btn.hit);
      if (event.key === "Escape") {
        closeSearch();
        return;
      }
      if (!buttons.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        activeHit = (activeHit + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons.forEach((btn, i) => btn.classList.toggle("active", i === activeHit));
        buttons[activeHit].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        pickHit(buttons[Math.max(0, activeHit)].hit);
      }
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest || !event.target.closest(".search")) closeSearch();
    });

    // ─── user filter ──────────────────────────────────────────────

    const filterText = document.getElementById("filter-text");
    const filterTests = document.getElementById("filter-tests");
    const filterMin = document.getElementById("filter-min");
    const filterMsg = document.getElementById("filter-msg");
    const filterChip = document.getElementById("chip-filter");
    let filterTimer;
    let filterPending = false;
    let sentFilter = null;

    function filterKey() {
      return JSON.stringify([filterText.value, filterTests.checked, filterMin.value]);
    }

    function showFilterError(message) {
      filterMsg.textContent = message || "";
      filterMsg.hidden = !message;
      filterText.classList.toggle("invalid", Boolean(message));
      filterText.setAttribute("aria-invalid", message ? "true" : "false");
    }

    function renderFilterChip(info) {
      if (!info) {
        filterChip.hidden = true;
        return;
      }
      document.getElementById("chip-filter-text").innerHTML =
        "Filter: <strong>" + info.kept.toLocaleString() + "</strong> of " + info.total.toLocaleString() + " files";
      filterChip.hidden = false;
    }

    function sendFilter() {
      clearTimeout(filterTimer);
      const key = filterKey();
      if (key === sentFilter) return;
      sentFilter = key;
      filterPending = true;
      setLoading("Applying filter…");
      vscode.postMessage({
        type: "filter",
        text: filterText.value,
        hideTests: filterTests.checked,
        minImporters: Number(filterMin.value),
        path: level ? level.path : undefined,
        focus: selectedFile || undefined,
      });
    }

    function scheduleFilter(delay) {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(sendFilter, delay);
    }

    filterText.addEventListener("input", () => scheduleFilter(400));
    filterText.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        sendFilter();
      } else if (event.key === "Escape" && filterText.value) {
        filterText.value = "";
        sendFilter();
      }
    });
    filterTests.addEventListener("change", () => scheduleFilter(0));
    filterMin.addEventListener("change", () => scheduleFilter(0));
    document.getElementById("filter-clear").addEventListener("click", () => {
      filterText.value = "";
      filterTests.checked = false;
      filterMin.value = "0";
      sendFilter();
    });

    // ─── messages ─────────────────────────────────────────────────

    window.addEventListener("message", (event) => {
      const msg = event.data;
      switch (msg.type) {
        case "level":
          reloadBtn.disabled = false;
          reloadBtn.textContent = "Reload";
          reloadBtn.classList.remove("stale");
          renderLevel(msg.level);
          break;
        case "detail":
          renderDetail(msg.detail);
          break;
        case "edgeDetail":
          renderEdgeDetail(msg.detail);
          break;
        case "searchResults":
          if (searchInput.value.trim()) renderSearch(msg.hits);
          break;
        case "loading":
          setLoading(msg.message);
          break;
        case "filterInit":
          filterText.value = msg.options.text;
          filterTests.checked = msg.options.hideTests;
          filterMin.value = String(msg.options.minImporters);
          sentFilter = filterKey();
          break;
        case "filterStatus":
          showFilterError(msg.error);
          if (msg.error && filterPending) {
            filterPending = false;
            setLoading(null);
          }
          break;
        case "error":
          reloadBtn.disabled = false;
          reloadBtn.textContent = "Reload";
          setLoading(msg.message);
          break;
        case "stale":
          reloadBtn.classList.add("stale");
          reloadBtn.textContent = "Reload •";
          reloadBtn.title = "Files changed since the index was built";
          break;
      }
    });

    hideDetail();
    vscode.postMessage({ type: "ready" });
  </script>
    `,
    });
};
