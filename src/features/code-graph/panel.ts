import { escapeHtml } from "../../shared/html";
import {
  PANEL_CSP_CDN,
  panelCompactToolbarStyles,
  panelDocument,
  panelToolbarBtnStyles,
} from "../../shared/panel";
import { getPanelTheme, PanelTheme } from "../../shared/theme";
import { CodeGraphData } from "./types";

interface GraphTheme extends PanelTheme {
  dep: string;
  depSoft: string;
  dependent: string;
  dependentSoft: string;
  external: string;
  externalSoft: string;
}

function getGraphTheme(isDark: boolean): GraphTheme {
  const base = getPanelTheme(isDark);
  return isDark
    ? {
        ...base,
        dep: "#06b6d4",
        depSoft: "rgba(6, 182, 212, 0.2)",
        dependent: "#22c55e",
        dependentSoft: "rgba(34, 197, 94, 0.2)",
        external: "#a855f7",
        externalSoft: "rgba(168, 85, 247, 0.2)",
      }
    : {
        ...base,
        dep: "#0891b2",
        depSoft: "rgba(8, 145, 178, 0.12)",
        dependent: "#16a34a",
        dependentSoft: "rgba(22, 163, 74, 0.12)",
        external: "#9333ea",
        externalSoft: "rgba(147, 51, 234, 0.12)",
      };
}

function graphStyles(t: GraphTheme): string {
  return `
    ${panelCompactToolbarStyles(t)}
    ${panelToolbarBtnStyles(t)}

    .toolbar-btn {
      padding: 6px 12px;
      font-size: 0.72rem;
    }

    .legend-item {
      font-size: 0.68rem;
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 600;
      white-space: nowrap;
    }

    .legend-item.current { background: ${t.accentSoft}; color: ${t.accent}; }
    .legend-item.dependency { background: ${t.depSoft}; color: ${t.dep}; }
    .legend-item.dependent { background: ${t.dependentSoft}; color: ${t.dependent}; }
    .legend-item.external { background: ${t.externalSoft}; color: ${t.external}; }

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
      right: 12px;
      bottom: 10px;
      padding: 4px 10px;
      font-size: 0.68rem;
      color: ${t.muted};
      background: ${t.surface};
      border: 1px solid ${t.border};
      border-radius: 999px;
      pointer-events: none;
      opacity: 0.9;
    }
  `;
}

export function getCodeGraphHtml(data: CodeGraphData, isDark: boolean): string {
  const t = getGraphTheme(isDark);

  const legend = `
    <span class="legend-item current">Current file</span>
    <span class="legend-item dependency">Dependencies</span>
    <span class="legend-item dependent">Dependents</span>
    <span class="legend-item external">External</span>
  `;

  return panelDocument({
    title: "Code Graph",
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
      <span class="chip"><strong>${data.stats.external}</strong> ext</span>
      ${legend}
      <button type="button" class="toolbar-btn" id="reload-btn">Reload</button>
    </div>
  </div>

  <div class="graph-wrap">
    <div id="graph"></div>
    <div class="hint">Drag · scroll · click node to open</div>
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

    const colors = {
      current: { background: "${t.accentSoft}", border: "${t.accent}", font: "${t.text}" },
      dependency: { background: "${t.depSoft}", border: "${t.dep}", font: "${t.text}" },
      dependent: { background: "${t.dependentSoft}", border: "${t.dependent}", font: "${t.text}" },
      external: { background: "${t.externalSoft}", border: "${t.external}", font: "${t.text}" },
    };

    const nodes = new vis.DataSet(graphData.nodes.map((node) => ({
      id: node.id,
      label: shortenLabel(node.label),
      title: node.label,
      group: node.group,
      shape: node.group === "external" ? "box" : "dot",
      color: colors[node.group] || colors.current,
      font: { color: "${t.text}", size: 13 },
      borderWidth: 2,
      size: node.group === "current" ? 28 : 18,
    })));

    const edges = new vis.DataSet(graphData.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      arrows: "to",
      color: { color: "${t.border}", highlight: "${t.accent}" },
      smooth: { type: "dynamic" },
    })));

    const container = document.getElementById("graph");
    const network = new vis.Network(container, { nodes, edges }, {
      autoResize: true,
      layout: {
        improvedLayout: true,
        hierarchical: false,
      },
      physics: {
        enabled: true,
        stabilization: { iterations: 180 },
        barnesHut: {
          gravitationalConstant: -4200,
          springLength: 160,
          springConstant: 0.04,
        },
      },
      interaction: {
        hover: true,
        tooltipDelay: 120,
        zoomView: true,
        dragView: true,
      },
    });

    const fitGraph = () => {
      network.fit({
        animation: { duration: 300, easingFunction: "easeInOutQuad" },
      });
    };

    window.addEventListener("resize", fitGraph);

    network.on("click", (params) => {
      if (!params.nodes.length) return;
      const nodeId = params.nodes[0];
      if (String(nodeId).startsWith("ext:")) return;
      vscode.postMessage({ type: "open", path: nodeId });
    });

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
      fitGraph();
    });

    function shortenLabel(label) {
      if (label.length <= 28) return label;
      return "…" + label.slice(-27);
    }
  </script>
    `,
  });
}
