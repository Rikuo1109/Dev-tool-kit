export interface GraphNode {
  id: string;
  label: string;
  group: "current" | "dependency" | "dependent" | "external";
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface CodeGraphData {
  fileName: string;
  relativePath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    dependencies: number;
    dependents: number;
    external: number;
  };
}
