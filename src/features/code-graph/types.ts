export interface GraphNode {
  id: string;
  label: string;
  group: "current" | "dependency" | "dependent";
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface CodeGraphData {
  fileName: string;
  relativePath: string;
  rootPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    dependencies: number;
    dependents: number;
  };
}

export interface GraphExpansion {
  centerPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
