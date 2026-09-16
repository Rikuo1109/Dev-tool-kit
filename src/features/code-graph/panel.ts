import { escapeHtml } from '../../shared/html';
import {
    PANEL_CSP_CDN,
    panelCompactToolbarStyles,
    panelDocument,
    panelLoadingStyles,
    panelToolbarBtnStyles,
    reloadPanelScript,
} from '../../shared/panel';
import { getPanelTheme, PanelTheme } from '../../shared/theme';
import { CodeGraphData } from './types';

interface GraphTheme extends PanelTheme {
    dep: string;
    depSoft: string;
    dependent: string;
    dependentSoft: string;
}

function getGraphTheme(isDark: boolean): GraphTheme {
    const base = getPanelTheme(isDark);
    return isDark
        ? {
              ...base,
              dep: '#06b6d4',
              depSoft: 'rgba(6, 182, 212, 0.2)',
              dependent: '#22c55e',
              dependentSoft: 'rgba(34, 197, 94, 0.2)',
          }
        : {
              ...base,
              dep: '#0891b2',
              depSoft: 'rgba(8, 145, 178, 0.12)',
              dependent: '#16a34a',
              dependentSoft: 'rgba(22, 163, 74, 0.12)',
          };
}

function graphStyles(t: GraphTheme): string {
    return `
    ${panelCompactToolbarStyles(t)}
    ${panelToolbarBtnStyles(t)}
    ${panelLoadingStyles(t)}

    .copy-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .copy-select {
      padding: 5px 6px;
      font-size: 0.65rem;
      border: 1px solid ${t.border};
      border-radius: 6px;
      background: ${t.bg};
      color: ${t.text};
      cursor: pointer;
      max-width: 148px;
    }

    .copy-select:focus {
      outline: 1px solid ${t.accent};
      outline-offset: 1px;
    }

    .legend-item {
      font-size: 0.62rem;
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 600;
      white-space: nowrap;
    }

    .legend-item.current { background: ${t.accentSoft}; color: ${t.accent}; }
    .legend-item.dependency { background: ${t.depSoft}; color: ${t.dep}; }
    .legend-item.dependent { background: ${t.dependentSoft}; color: ${t.dependent}; }

    .graph-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      background: ${t.bg};
    }

    #graph {
      width: 100%;
      height: 100%;
    }

    .hint {
      position: absolute;
      right: 10px;
      bottom: 8px;
      padding: 3px 8px;
      font-size: 0.62rem;
      color: ${t.muted};
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 999px;
      pointer-events: none;
      opacity: 0.9;
    }

    .layer-labels {
      position: absolute;
      left: 10px;
      top: 0;
      bottom: 0;
      width: 72px;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      padding: 56px 0 28px;
      font-size: 0.58rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${t.muted};
      opacity: 0.85;
    }

    .graph-loading {
      flex: 1;
      min-height: 0;
    }
  `;
}

export function getCodeGraphLoadingHtml(
    relativePath: string,
    isDark: boolean,
    status = 'Analyzing imports…',
): string {
    const t = getGraphTheme(isDark);

    return panelDocument({
        title: 'Code Graph',
        styles: graphStyles(t),
        body: `
  <div class="toolbar">
    <div class="toolbar-title">
      <h1>Code Graph</h1>
      <p title="${escapeHtml(relativePath)}">${escapeHtml(relativePath)}</p>
    </div>
  </div>

  <div class="graph-loading loading">
    <div class="spinner"></div>
    <h2>Building code graph</h2>
    <p id="loading-status">${escapeHtml(status)}</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    ${reloadPanelScript()}

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type !== "loadingStatus" || typeof msg.message !== "string") {
        return;
      }
      const statusEl = document.getElementById("loading-status");
      if (statusEl) {
        statusEl.textContent = msg.message;
      }
    });
  </script>
    `,
    });
}

export function getCodeGraphHtml(data: CodeGraphData, isDark: boolean): string {
    const t = getGraphTheme(isDark);

    const legend = `
    <span class="legend-item dependent">Dependents ↑</span>
    <span class="legend-item current">Current file</span>
    <span class="legend-item dependency">Dependencies ↓</span>
  `;

    return panelDocument({
        title: 'Code Graph',
        csp: PANEL_CSP_CDN,
        styles: graphStyles(t),
        body: `
  <div class="toolbar">
    <div class="toolbar-title">
      <h1>Code Graph</h1>
      <p title="${escapeHtml(data.relativePath)}">${escapeHtml(data.relativePath)}</p>
    </div>
    <div class="toolbar-meta">
      <span class="chip"><strong>${data.stats.dependents}</strong> in</span>
      <span class="chip"><strong>${data.stats.dependencies}</strong> out</span>
      ${legend}
      <div class="copy-control">
        <select id="copy-mode" class="copy-select" aria-label="Copy format">
          <option value="paths">Paths</option>
          <option value="content">Content (AI)</option>
        </select>
        <button type="button" class="toolbar-btn" id="copy-btn" disabled>Copy</button>
      </div>
      <button type="button" class="toolbar-btn" id="reload-btn">Reload</button>
    </div>
  </div>

  <div class="graph-wrap">
    <div class="layer-labels" aria-hidden="true">
      <span>Dependents</span>
      <span>Current</span>
      <span>Dependencies</span>
    </div>
    <div id="graph"></div>
    <div class="hint">Shift+click select · Copy or ⌘C · click expand · double-click open</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();
    const graphData = ${JSON.stringify(data)};

    document.getElementById("reload-btn")?.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = true;
        btn.textContent = "Reloading…";
      }
      vscode.postMessage({ type: "reload" });
    });

    const copyModeEl = document.getElementById("copy-mode");
    const copyBtn = document.getElementById("copy-btn");

    function getCopyMode() {
      return copyModeEl instanceof HTMLSelectElement ? copyModeEl.value : "paths";
    }

    function updateCopyBtn() {
      if (!(copyBtn instanceof HTMLButtonElement)) {
        return;
      }
      const count = selected.size;
      copyBtn.disabled = count === 0;
      copyBtn.textContent = count === 0 ? "Copy" : "Copy (" + count + ")";
    }

    function copySelected(mode) {
      if (selected.size === 0) {
        return;
      }

      if (mode === "content") {
        vscode.postMessage({ type: "copyContent", paths: [...selected] });
        return;
      }

      const lines = [...selected].map((nodeId) => {
        const node = nodes.get(nodeId);
        return node?.fullLabel || nodeId;
      });
      vscode.postMessage({ type: "copy", text: lines.join("\\n") });
    }

    copyBtn?.addEventListener("click", () => {
      copySelected(getCopyMode());
    });

    const colors = {
      current: { background: "${t.accentSoft}", border: "${t.accent}", font: "${t.text}" },
      dependency: { background: "${t.depSoft}", border: "${t.dep}", font: "${t.text}" },
      dependent: { background: "${t.dependentSoft}", border: "${t.dependent}", font: "${t.text}" },
    };

    const levelByGroup = {
      dependent: 0,
      current: 1,
      dependency: 2,
    };

    const rootPath = graphData.rootPath;
    const levelByNode = new Map(graphData.nodes.map((node) => [
      node.id,
      levelByGroup[node.group] ?? 1,
    ]));
    const expanded = new Set();
    const expanding = new Set();
    const selected = new Set();

    function nodeLabel(label) {
      const base = label.split("/").pop() || label;
      return base.length <= 32 ? base : "…" + base.slice(-31);
    }

    function buildTitle(nodeId, fullLabel) {
      const hints = [];
      if (expanded.has(nodeId)) {
        hints.push("expanded");
      } else {
        hints.push("click to expand");
      }
      if (selected.has(nodeId)) {
        hints.push("selected");
      }
      hints.push("shift+click to select");
      return fullLabel + "\\n(" + hints.join(" · ") + ")";
    }

    function paletteForNode(nodeId, group) {
      const palette = colors[group] || colors.current;
      if (!selected.has(nodeId)) {
        return palette;
      }
      return {
        background: palette.background,
        border: "${t.warn}",
        highlight: { background: palette.background, border: "${t.accent}" },
      };
    }

    function applyNodeVisual(nodeId) {
      const existing = nodes.get(nodeId);
      if (!existing) {
        return;
      }
      const isRoot = nodeId === rootPath;
      nodes.update({
        id: nodeId,
        color: paletteForNode(nodeId, existing.group),
        borderWidth: selected.has(nodeId) ? 3 : isRoot || expanded.has(nodeId) ? 2 : 1,
        title: buildTitle(nodeId, existing.fullLabel || existing.label),
      });
    }

    function syncAllNodeVisuals() {
      for (const node of nodes.get()) {
        applyNodeVisual(node.id);
      }
    }

    function visNode(node, level, options = {}) {
      const isRoot = node.id === rootPath;
      const group = isRoot ? "current" : node.group;
      return {
        id: node.id,
        label: nodeLabel(node.label),
        fullLabel: node.label,
        title: buildTitle(node.id, node.label),
        group,
        level,
        shape: "box",
        color: paletteForNode(node.id, group),
        font: {
          color: "${t.text}",
          size: isRoot ? 12 : 11,
          face: "ui-monospace, Menlo, monospace",
        },
        borderWidth: selected.has(node.id) ? 3 : isRoot ? 2 : expanded.has(node.id) ? 2 : 1,
        margin: 8,
        widthConstraint: { maximum: 148 },
        ...options,
      };
    }

    function visEdge(edge) {
      return {
        from: edge.from,
        to: edge.to,
        arrows: { to: { enabled: true, scaleFactor: 0.65 } },
        color: { color: "${t.border}", highlight: "${t.accent}" },
        smooth: {
          type: "cubicBezier",
          forceDirection: "vertical",
          roundness: 0.35,
        },
      };
    }

    function countByLevel(items) {
      const counts = new Map();
      for (const node of items) {
        const level = node.level ?? 1;
        counts.set(level, (counts.get(level) || 0) + 1);
      }
      return counts;
    }

    function computeLayoutMetrics(items) {
      const levelCounts = countByLevel(items);
      const maxSiblings = Math.max(...levelCounts.values(), 1);
      const container = document.getElementById("graph");
      const width = container?.clientWidth || 960;
      const nodeWidth = 148;
      const minGap = 28;
      const minCenterDistance = nodeWidth + minGap;
      const spreadSpacing = Math.ceil((width - 96) / maxSiblings);
      return {
        nodeSpacing: Math.max(minCenterDistance, spreadSpacing),
        levelSeparation: 112,
        treeSpacing: Math.max(180, minCenterDistance),
      };
    }

    const layoutMetrics = computeLayoutMetrics(
      graphData.nodes.map((node) => ({ level: levelByNode.get(node.id) ?? 1 })),
    );

    const nodes = new vis.DataSet(
      graphData.nodes.map((node) =>
        visNode(node, levelByNode.get(node.id) ?? 1),
      ),
    );

    const edges = new vis.DataSet(graphData.edges.map((edge) => visEdge(edge)));

    const container = document.getElementById("graph");
    const layoutOptions = {
      hierarchical: {
        enabled: true,
        direction: "UD",
        sortMethod: "directed",
        levelSeparation: layoutMetrics.levelSeparation,
        nodeSpacing: layoutMetrics.nodeSpacing,
        treeSpacing: layoutMetrics.treeSpacing,
        blockShifting: false,
        edgeMinimization: false,
        parentCentralization: false,
      },
    };

    const network = new vis.Network(container, { nodes, edges }, {
      autoResize: true,
      layout: layoutOptions,
      physics: {
        enabled: false,
      },
      interaction: {
        hover: true,
        tooltipDelay: 120,
        zoomView: true,
        dragView: true,
        dragNodes: false,
      },
    });

    const fitGraph = () => {
      network.fit({
        animation: { duration: 300, easingFunction: "easeInOutQuad" },
      });
    };

    const relayout = () => {
      const next = computeLayoutMetrics(nodes.get());
      network.setOptions({
        layout: {
          hierarchical: {
            ...layoutOptions.hierarchical,
            nodeSpacing: next.nodeSpacing,
            treeSpacing: next.treeSpacing,
          },
        },
      });
      fitGraph();
    };

    function edgeKey(from, to) {
      return from + "->" + to;
    }

    const edgeIds = new Set(
      graphData.edges.map((edge) => edgeKey(edge.from, edge.to)),
    );

    function mergeExpansion(centerPath, newNodes, newEdges) {
      const centerLevel = levelByNode.get(centerPath) ?? 1;
      let added = false;

      for (const node of newNodes) {
        if (node.id === centerPath || nodes.get(node.id)) {
          continue;
        }

        const level =
          node.group === "dependent" ? centerLevel - 1 : centerLevel + 1;
        levelByNode.set(node.id, level);
        nodes.add(visNode(node, level));
        added = true;
      }

      for (const edge of newEdges) {
        const key = edgeKey(edge.from, edge.to);
        if (edgeIds.has(key)) {
          continue;
        }
        edgeIds.add(key);
        edges.add(visEdge(edge));
        added = true;
      }

      if (added) {
        syncAllNodeVisuals();
        relayout();
      }
    }

    function refreshNodeStyle(nodeId) {
      applyNodeVisual(nodeId);
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "expandResult" && msg.centerPath) {
        expanding.delete(msg.centerPath);
        expanded.add(msg.centerPath);
        mergeExpansion(msg.centerPath, msg.nodes || [], msg.edges || []);
        refreshNodeStyle(msg.centerPath);
        return;
      }

      if (msg.type === "expandError" && msg.path) {
        expanding.delete(msg.path);
        expanded.delete(msg.path);
      }
    });

    window.addEventListener("resize", relayout);

    document.addEventListener("keydown", (event) => {
      if (selected.size === 0) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "c") {
        return;
      }

      event.preventDefault();
      copySelected(getCopyMode());
    });

    network.on("click", (params) => {
      if (!params.nodes.length) {
        selected.clear();
        syncAllNodeVisuals();
        updateCopyBtn();
        return;
      }

      const nodeId = params.nodes[0];
      const shiftKey = Boolean(params.event?.srcEvent?.shiftKey);

      if (shiftKey) {
        if (selected.has(nodeId)) {
          selected.delete(nodeId);
        } else {
          selected.add(nodeId);
        }
        syncAllNodeVisuals();
        updateCopyBtn();
        return;
      }

      selected.clear();
      syncAllNodeVisuals();
      updateCopyBtn();

      if (expanded.has(nodeId) || expanding.has(nodeId)) {
        return;
      }
      expanding.add(nodeId);
      vscode.postMessage({ type: "expand", path: nodeId });
    });

    network.on("doubleClick", (params) => {
      if (!params.nodes.length) return;
      vscode.postMessage({ type: "open", path: params.nodes[0] });
    });

    network.once("initRedraw", fitGraph);
  </script>
    `,
    });
}
