import { CodeGraphData } from "./types";

interface Theme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  dep: string;
  depSoft: string;
  dependent: string;
  dependentSoft: string;
  external: string;
  externalSoft: string;
  shadow: string;
}

function getTheme(isDark: boolean): Theme {
  return isDark
    ? {
        bg: "#0f1117",
        surface: "#181b24",
        border: "#2a3142",
        text: "#e8eaef",
        muted: "#8b93a7",
        accent: "#6366f1",
        accentSoft: "rgba(99, 102, 241, 0.2)",
        dep: "#06b6d4",
        depSoft: "rgba(6, 182, 212, 0.2)",
        dependent: "#22c55e",
        dependentSoft: "rgba(34, 197, 94, 0.2)",
        external: "#a855f7",
        externalSoft: "rgba(168, 85, 247, 0.2)",
        shadow: "0 8px 32px rgba(0,0,0,0.35)",
      }
    : {
        bg: "#f4f6fb",
        surface: "#ffffff",
        border: "#e2e6ef",
        text: "#1a1d26",
        muted: "#5c6478",
        accent: "#4f46e5",
        accentSoft: "rgba(79, 70, 229, 0.12)",
        dep: "#0891b2",
        depSoft: "rgba(8, 145, 178, 0.12)",
        dependent: "#16a34a",
        dependentSoft: "rgba(22, 163, 74, 0.12)",
        external: "#9333ea",
        externalSoft: "rgba(147, 51, 234, 0.12)",
        shadow: "0 8px 32px rgba(15, 23, 42, 0.08)",
      };
}

export function getCodeGraphHtml(data: CodeGraphData, isDark: boolean): string {
  const t = getTheme(isDark);

  const legend = `
    <span class="legend-item current">Current file</span>
    <span class="legend-item dependency">Dependencies</span>
    <span class="legend-item dependent">Dependents</span>
    <span class="legend-item external">External</span>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src https://cdn.jsdelivr.net 'unsafe-inline'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Graph</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${t.bg};
      color: ${t.text};
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 10px 14px;
      border-bottom: 1px solid ${t.border};
      background: ${t.surface};
    }

    .toolbar-title {
      min-width: 0;
      flex: 1 1 180px;
    }

    .toolbar-title h1 {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .toolbar-title p {
      color: ${t.muted};
      font-size: 0.72rem;
      margin-top: 2px;
      font-family: ui-monospace, Menlo, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .toolbar-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .stat {
      font-size: 0.72rem;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid ${t.border};
      background: ${t.bg};
      white-space: nowrap;
    }

    .stat strong {
      font-variant-numeric: tabular-nums;
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

    .toolbar-btn {
      appearance: none;
      border: 1px solid ${t.border};
      background: ${t.bg};
      color: ${t.text};
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }

    .toolbar-btn:hover {
      border-color: ${t.accent};
      color: ${t.accent};
    }

    .toolbar-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

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
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-title">
      <h1>Code Graph</h1>
      <p title="${escapeHtml(data.relativePath)}">${escapeHtml(data.relativePath)}</p>
    </div>
    <div class="toolbar-meta">
      <span class="stat"><strong>${data.stats.dependents}</strong> in</span>
      <span class="stat"><strong>${data.stats.dependencies}</strong> out</span>
      <span class="stat"><strong>${data.stats.external}</strong> ext</span>
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
