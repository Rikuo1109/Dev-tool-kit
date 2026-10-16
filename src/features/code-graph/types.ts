export interface GraphNode {
    id: string;
    label: string;
    group: 'current' | 'dependency' | 'dependent';
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

export type ClusterNodeKind = 'cluster' | 'file' | 'context' | 'more' | 'package';

export interface ClusterNode {
    id: string;
    label: string;
    kind: ClusterNodeKind;
    fileCount: number;
    /** Longer description for tooltips. */
    title?: string;
    /** Layer for the layered layout, 0 = top (importers). */
    layer?: number;
    /** Files: number of files importing it. */
    fanIn?: number;
    /** Files: nothing imports it, or only tests do. */
    usage?: 'unused' | 'test-only';
    /** Groups: unused files inside. */
    unusedCount?: number;
    /** Groups: their most imported file. */
    topHub?: { label: string; fanIn: number };
    /** Full map: index into `ClusterLevel.legend` (top-level group colour), -1 for "other". */
    colorGroup?: number;
    /** Context node that is a single file rather than a folder. */
    isFile?: boolean;
}

export interface ClusterEdge {
    from: string;
    to: string;
    /** Number of file-level imports aggregated into this edge. */
    count: number;
    /** Points against the layer order: one of the imports that closes a dependency cycle. */
    cyclic: boolean;
}

export interface ClusterCrumb {
    path: string;
    label: string;
}

export interface ClusterLevel {
    path: string;
    mode: 'folders' | 'communities';
    crumbs: ClusterCrumb[];
    nodes: ClusterNode[];
    edges: ClusterEdge[];
    /** Node ids of each dependency cycle (strongly connected component) at this level. */
    cycleGroups: string[][];
    /** Usage findings for the files under this level. */
    insights?: LevelInsights;
    /** Every file at once instead of one group's children. */
    full?: boolean;
    /** Full map: top-level groups that have their own colour, largest first. */
    legend?: { id: string; label: string; count: number }[];
    /** Full map: files left out to stay drawable. */
    truncated?: number;
    focus?: string;
    /** A user filter is active: files kept / files the index scanned. */
    filter?: { kept: number; total: number };
    stats: {
        files: number;
        totalFiles: number;
        clusters: number;
        inbound: number;
        outbound: number;
        packages: number;
        cycles: number;
    };
}

export interface DetailItem {
    id: string;
    label: string;
    path?: string;
    count?: number;
}

export interface ClusterNodeDetail {
    id: string;
    title: string;
    kind: ClusterNodeKind;
    absolutePath?: string;
    fileCount?: number;
    files?: DetailItem[];
    dependencies?: DetailItem[];
    dependents?: DetailItem[];
    packages?: string[];
    uses?: DetailItem[];
    usedBy?: DetailItem[];
    /** Files: who uses it and which exports are dead. */
    fileUsage?: FileUsage;
    /** "More" node: groups hidden from the graph. */
    groups?: DetailItem[];
    /** Communities: folders its files come from. */
    folders?: DetailItem[];
}

export interface EdgeDetail {
    from: string;
    to: string;
    total: number;
    pairs: { from: string; fromPath: string; to: string; toPath?: string }[];
}

export interface SearchHit {
    kind: 'file' | 'folder';
    rel: string;
    absolutePath?: string;
    /** Level to open for this hit. */
    level: string;
}

export interface LevelInsights {
    /** Files nothing imports (not entry points, barrels or tests). */
    unused: DetailItem[];
    /** Files imported only by tests. */
    testOnly: DetailItem[];
    /** Most imported files; `count` = importers, `spread` = distinct importing folders. */
    hubs: (DetailItem & { spread: number })[];
    /** Most imported exports; `label` = symbol, `id` = file. */
    hubSymbols: DetailItem[];
}

export interface FileUsage {
    fanIn: number;
    /** Distinct folders the importers live in. */
    spread: number;
    usage?: 'unused' | 'test-only';
    /** Imported symbols with the number of files importing each. */
    symbols: { name: string; users: number }[];
    namespaceUsers: number;
    /** Exports no file imports. */
    unusedExports: { name: string; kind: string; line?: number }[];
}
