import { normalizePath, toRelativePath } from '../../shared/fs';
import { ImportIndex } from '../../shared/javascript/importGraph';
import { buildCommunityTree, buildFolderTree, Group, GroupMode, GroupTree } from './groupTree';
import {
    ClusterCrumb,
    ClusterEdge,
    ClusterLevel,
    ClusterNode,
    ClusterNodeDetail,
    DetailItem,
    EdgeDetail,
    SearchHit,
} from './types';

/** Files and groups shown individually per level; the rest collapse into one "more" node. */
const MAX_FILE_NODES = 80;
const MAX_CLUSTER_NODES = 60;
/** Outside-the-level context nodes; the weakest collapse into one "outside" node. */
const MAX_CONTEXT_NODES = 24;
const MAX_PACKAGE_NODES = 40;
const MAX_EDGE_PAIRS = 200;
const MAX_DETAIL_ITEMS = 300;
const MAX_SEARCH_HITS = 30;
const MAX_COMPOSITION_DIRS = 12;
/** Full map stays drawable up to about this many files; beyond it the least connected are left out. */
const MAX_FULL_MAP_FILES = 4000;
/** Distinct colours in the full map; smaller groups share a neutral one. */
const MAX_LEGEND_GROUPS = 12;

const MORE_SUFFIX = '::more';
const OUTSIDE_ID = '::outside';
const PACKAGE_PREFIX = 'pkg:';

const parentDir = (rel: string): string => {
    const slash = rel.lastIndexOf('/');
    return slash < 0 ? '' : rel.slice(0, slash);
};

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

const isUnderPath = (rel: string, dir: string): boolean => dir === '' || rel.startsWith(`${dir}/`);

/** `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`, `node:fs` → `fs`. */
export const packageNameOf = (specifier: string): string => {
    const bare = specifier.replace(/^node:/, '');
    const parts = bare.split('/');
    return bare.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
};

const isBareSpecifier = (specifier: string): boolean => {
    return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[A-Za-z]:/.test(specifier);
};

/** Strongly connected components with more than one node (Tarjan, iterative). */
export const findCycles = (nodeIds: string[], edges: { from: string; to: string }[]): string[][] => {
    const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
    for (const { from, to } of edges) {
        adjacency.get(from)?.push(to);
    }

    const indexOf = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const components: string[][] = [];
    let counter = 0;

    for (const start of nodeIds) {
        if (indexOf.has(start)) {
            continue;
        }
        const work: { id: string; next: number }[] = [{ id: start, next: 0 }];
        indexOf.set(start, counter);
        low.set(start, counter++);
        stack.push(start);
        onStack.add(start);

        while (work.length) {
            const frame = work[work.length - 1];
            const neighbors = adjacency.get(frame.id) ?? [];
            if (frame.next < neighbors.length) {
                const neighbor = neighbors[frame.next++];
                if (!adjacency.has(neighbor)) {
                    continue;
                }
                if (!indexOf.has(neighbor)) {
                    indexOf.set(neighbor, counter);
                    low.set(neighbor, counter++);
                    stack.push(neighbor);
                    onStack.add(neighbor);
                    work.push({ id: neighbor, next: 0 });
                } else if (onStack.has(neighbor)) {
                    low.set(frame.id, Math.min(low.get(frame.id)!, indexOf.get(neighbor)!));
                }
                continue;
            }

            work.pop();
            if (work.length) {
                const parent = work[work.length - 1].id;
                low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!));
            }
            if (low.get(frame.id) === indexOf.get(frame.id)) {
                const component: string[] = [];
                let member: string;
                do {
                    member = stack.pop()!;
                    onStack.delete(member);
                    component.push(member);
                } while (member !== frame.id);
                if (component.length > 1) {
                    components.push(component.sort());
                }
            }
        }
    }

    return components.sort((a, b) => b.length - a.length);
};

const SIFT_PASSES = 6;

/**
 * Local improvement of a node order: moves each node to the position that minimises the weight
 * of edges pointing backwards (from a later node to an earlier one), until nothing improves.
 */
const siftOrder = (initial: string[], out: Map<string, Map<string, number>>): string[] => {
    const order = [...initial];
    const w = (from: string, to: string) => out.get(from)?.get(to) ?? 0;
    for (let pass = 0; pass < SIFT_PASSES; pass++) {
        let improved = false;
        for (const node of [...order]) {
            const others = order.filter((id) => id !== node);
            // Cost with `node` at slot i: its edges to earlier nodes and edges into it from later ones.
            let cost = others.reduce((sum, id) => sum + w(id, node), 0);
            let bestCost = cost;
            let bestSlot = 0;
            for (let i = 0; i < others.length; i++) {
                cost += w(node, others[i]) - w(others[i], node);
                if (cost < bestCost - 1e-9) {
                    bestCost = cost;
                    bestSlot = i + 1;
                }
            }
            const currentSlot = order.indexOf(node);
            const currentCost =
                others.slice(0, currentSlot).reduce((sum, id) => sum + w(node, id), 0) +
                others.slice(currentSlot).reduce((sum, id) => sum + w(id, node), 0);
            if (bestCost < currentCost - 1e-9) {
                others.splice(bestSlot, 0, node);
                order.splice(0, order.length, ...others);
                improved = true;
            }
        }
        if (!improved) {
            break;
        }
    }
    return order;
};

export interface LayerResult {
    /** Edges (as `from\nto`) that go against the layer order: removing them breaks every cycle. */
    backEdges: Set<string>;
    /** Layer per node, 0 = top (importers), increasing toward what is imported. */
    layers: Map<string, number>;
}

/**
 * Orders nodes so most import weight points "down", using the weighted greedy feedback-arc-set
 * heuristic (Eades–Lin–Smyth), then assigns longest-path layers on the remaining DAG. The few
 * edges pointing back up are the imports that close cycles.
 *
 * An edge weighs its share of the source's outgoing imports, not its raw count: 5 imports from a
 * 13-file folder say more about its role than 37 stray imports out of a 1,300-file one.
 */
export const layerNodes = (
    nodeIds: string[],
    edges: { from: string; to: string; count: number }[],
): LayerResult => {
    const ids = new Set(nodeIds);
    const relevant = edges.filter(({ from, to }) => from !== to && ids.has(from) && ids.has(to));
    const outTotal = new Map<string, number>();
    for (const { from, count } of relevant) {
        outTotal.set(from, (outTotal.get(from) ?? 0) + count);
    }
    const out = new Map<string, Map<string, number>>(nodeIds.map((id) => [id, new Map()]));
    const inc = new Map<string, Map<string, number>>(nodeIds.map((id) => [id, new Map()]));
    for (const { from, to, count } of relevant) {
        const share = count / outTotal.get(from)!;
        out.get(from)!.set(to, (out.get(from)!.get(to) ?? 0) + share);
        inc.get(to)!.set(from, (inc.get(to)!.get(from) ?? 0) + share);
    }

    const remaining = new Set(nodeIds);
    const weight = (map: Map<string, number>) => {
        let sum = 0;
        for (const [id, w] of map) {
            if (remaining.has(id)) {
                sum += w;
            }
        }
        return sum;
    };
    const head: string[] = [];
    const tail: string[] = [];
    while (remaining.size) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const id of [...remaining]) {
                if (weight(out.get(id)!) === 0) {
                    tail.unshift(id);
                    remaining.delete(id);
                    changed = true;
                } else if (weight(inc.get(id)!) === 0) {
                    head.push(id);
                    remaining.delete(id);
                    changed = true;
                }
            }
        }
        if (!remaining.size) {
            break;
        }
        let best = '';
        let bestDelta = -Infinity;
        for (const id of remaining) {
            const delta = weight(out.get(id)!) - weight(inc.get(id)!);
            if (delta > bestDelta) {
                best = id;
                bestDelta = delta;
            }
        }
        head.push(best);
        remaining.delete(best);
    }

    const order = siftOrder([...head, ...tail], out);
    const position = new Map(order.map((id, i) => [id, i]));
    const backEdges = new Set<string>();
    const layers = new Map<string, number>(order.map((id) => [id, 0]));
    for (const id of order) {
        for (const [to] of out.get(id)!) {
            if (position.get(to)! <= position.get(id)!) {
                backEdges.add(`${id}\n${to}`);
            } else {
                layers.set(to, Math.max(layers.get(to)!, layers.get(id)! + 1));
            }
        }
    }
    return { backEdges, layers: compactLayers(layers) };
};

/** At most this many bands in the layered view, so it stays wider than tall. */
const MAX_BANDS = 6;
/** Layerings this shallow are kept as they are. */
const MIN_BANDS = 4;

/**
 * Longest-path layering of a dense graph is often a near-total order (one node per layer), which
 * renders as a tall column. Merges consecutive ranks into a few bands of similar node counts;
 * the mapping is monotone, so every forward edge still points down or sideways within a band.
 */
export const compactLayers = (layers: Map<string, number>): Map<string, number> => {
    const ranks = [...new Set(layers.values())].sort((a, b) => a - b);
    const bands = Math.min(
        ranks.length,
        MAX_BANDS,
        Math.max(MIN_BANDS, Math.ceil(Math.sqrt(layers.size) / 1.2)),
    );
    if (ranks.length <= bands) {
        const dense = new Map(ranks.map((rank, i) => [rank, i]));
        return new Map([...layers].map(([id, rank]) => [id, dense.get(rank)!]));
    }

    const perRank = new Map<number, number>();
    for (const rank of layers.values()) {
        perRank.set(rank, (perRank.get(rank) ?? 0) + 1);
    }
    const target = layers.size / bands;
    const bandOf = new Map<number, number>();
    let band = 0;
    let filled = 0;
    ranks.forEach((rank, i) => {
        const remainingRanks = ranks.length - i;
        const remainingBands = bands - band;
        // Close the current band when it is full, but never leave later bands without a rank.
        if (filled > 0 && (filled + perRank.get(rank)! / 2 > target || remainingRanks < remainingBands)) {
            if (band < bands - 1) {
                band++;
                filled = 0;
            }
        }
        bandOf.set(rank, band);
        filled += perRank.get(rank)!;
    });
    return new Map([...layers].map(([id, rank]) => [id, bandOf.get(rank)!]));
};

/**
 * Hierarchical view of an import index. Each level is one group (a folder, or a community found
 * by Louvain): its child groups become cluster nodes, its own files become file nodes, and imports
 * crossing the group boundary are drawn to context nodes (the sibling branch they come from).
 */
export class ClusterModel {
    readonly mode: GroupMode;
    private readonly root: string;
    private readonly tree: GroupTree;
    private readonly relByAbs = new Map<string, string>();
    private readonly absByRel = new Map<string, string>();
    /** Internal import edges as [fromRel, toRel], deduplicated. */
    private readonly edges: [string, string][] = [];
    private readonly depsByRel = new Map<string, string[]>();
    private readonly importersByRel = new Map<string, string[]>();
    private readonly packagesByRel = new Map<string, Set<string>>();
    /** Ancestor groups (root first) of each file and group. */
    private readonly ancestorCache = new Map<string, string[]>();

    constructor(index: ImportIndex, mode: GroupMode = 'folders') {
        this.mode = mode;
        this.root = index.workspaceRoot;

        for (const abs of index.files) {
            const rel = toRelativePath(normalizePath(abs), this.root).replace(/\\/g, '/');
            if (rel.startsWith('..')) {
                continue;
            }
            this.relByAbs.set(abs, rel);
            this.absByRel.set(rel, abs);
        }

        for (const [abs, fromRel] of this.relByAbs) {
            const deps = new Set<string>();
            for (const dep of index.getDependencies(abs)) {
                const toRel = this.relByAbs.get(dep);
                if (toRel && toRel !== fromRel) {
                    deps.add(toRel);
                }
            }
            for (const toRel of deps) {
                this.edges.push([fromRel, toRel]);
                const importers = this.importersByRel.get(toRel) ?? [];
                importers.push(fromRel);
                this.importersByRel.set(toRel, importers);
            }
            this.depsByRel.set(fromRel, [...deps]);

            const packages = new Set<string>();
            for (const imp of index.getImports(abs)) {
                if (!imp.resolvedPath && isBareSpecifier(imp.specifier)) {
                    packages.add(packageNameOf(imp.specifier));
                }
            }
            if (packages.size) {
                this.packagesByRel.set(fromRel, packages);
            }
        }

        const files = [...this.absByRel.keys()];
        this.tree =
            mode === 'communities' ? buildCommunityTree(files, this.edges) : buildFolderTree(files);
    }

    get fileCount(): number {
        return this.absByRel.size;
    }

    get edgeCount(): number {
        return this.edges.length;
    }

    hasFile(abs: string): boolean {
        return this.relByAbs.has(normalizePath(abs));
    }

    absOf(rel: string): string | undefined {
        return this.absByRel.get(rel);
    }

    relOf(abs: string): string | undefined {
        return this.relByAbs.get(normalizePath(abs));
    }

    /** Top level to show first: skips leading groups that only wrap one subgroup. */
    get rootLevel(): string {
        let current = this.group(this.tree.root);
        while (current.files.length === 0 && current.groups.length === 1) {
            current = this.group(current.groups[0]);
        }
        return current.id;
    }

    /** Level (group id) that shows `rel` as a file node. */
    levelForFile(rel: string): string {
        return this.tree.fileGroup.get(rel) ?? this.rootLevel;
    }

    /** Folder mode: nearest displayable level for a folder path (a merged chain snaps to its end). */
    levelForDir(dir: string): string {
        if (this.tree.groups.has(dir)) {
            return this.depthOk(dir) ? dir : this.rootLevel;
        }
        if (this.mode !== 'folders') {
            return this.rootLevel;
        }
        for (const group of this.tree.groups.values()) {
            const parent = group.parent;
            if (
                parent !== null &&
                isUnderPath(group.id, dir) &&
                (parent === '' || isUnderPath(dir, parent))
            ) {
                return this.depthOk(group.id) ? group.id : this.rootLevel;
            }
        }
        return this.rootLevel;
    }

    buildLevel(level: string, options: { showPackages: boolean; focus?: string }): ClusterLevel {
        if (!this.tree.groups.has(level)) {
            level = this.rootLevel;
        }
        const group = this.group(level);

        const nodes = new Map<string, ClusterNode>();
        const childGroups = [...group.groups].sort(
            (a, b) => this.group(b).fileCount - this.group(a).fileCount,
        );
        const hiddenGroups = childGroups.slice(MAX_CLUSTER_NODES);
        for (const id of childGroups.slice(0, MAX_CLUSTER_NODES)) {
            const child = this.group(id);
            nodes.set(id, {
                id,
                label: child.label,
                title: child.title,
                kind: 'cluster',
                fileCount: child.fileCount,
            });
        }

        // Rank files by how connected they are inside this level, keep the top ones.
        const counted = this.countEdges(level);
        const degree = new Map<string, number>();
        for (const [key, count] of counted) {
            const [from, to] = key.split('\n');
            degree.set(from, (degree.get(from) ?? 0) + count);
            degree.set(to, (degree.get(to) ?? 0) + count);
        }
        const files = [...group.files].sort(
            (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
        );
        if (options.focus && files.indexOf(options.focus) >= MAX_FILE_NODES) {
            files.splice(files.indexOf(options.focus), 1);
            files.unshift(options.focus);
        }
        const shownFiles = files.slice(0, MAX_FILE_NODES);
        const hiddenFiles = files.length - shownFiles.length;
        for (const rel of shownFiles) {
            nodes.set(rel, { id: rel, label: baseName(rel), kind: 'file', fileCount: 1 });
        }
        const moreId = `${level}${MORE_SUFFIX}`;
        const hiddenCount = hiddenFiles + hiddenGroups.length;
        if (hiddenCount) {
            const parts = [
                hiddenGroups.length ? `${hiddenGroups.length} groups` : '',
                hiddenFiles ? `${hiddenFiles} files` : '',
            ].filter(Boolean);
            nodes.set(moreId, {
                id: moreId,
                label: `+${parts.join(', ')}`,
                kind: 'more',
                fileCount:
                    hiddenFiles +
                    hiddenGroups.reduce((sum, id) => sum + this.group(id).fileCount, 0),
            });
        }

        // Context nodes: strongest outside branches, the rest merged.
        const contextWeight = new Map<string, number>();
        for (const [key, count] of counted) {
            for (const id of key.split('\n')) {
                if (!this.isUnder(id, level)) {
                    contextWeight.set(id, (contextWeight.get(id) ?? 0) + count);
                }
            }
        }
        const contexts = [...contextWeight.entries()].sort((a, b) => b[1] - a[1]);
        for (const [id] of contexts.slice(0, MAX_CONTEXT_NODES)) {
            const isFile = this.absByRel.has(id);
            const groupLabel =
                this.mode === 'folders' ? this.titleOf(id) : this.tree.groups.get(id)?.label;
            nodes.set(id, {
                id,
                label: isFile ? id : (groupLabel ?? id),
                title: this.titleOf(id),
                kind: 'context',
                fileCount: isFile ? 1 : this.group(id).fileCount,
                isFile,
            });
        }
        if (contexts.length > MAX_CONTEXT_NODES) {
            nodes.set(OUTSIDE_ID, {
                id: OUTSIDE_ID,
                label: `${contexts.length - MAX_CONTEXT_NODES} other outside`,
                kind: 'context',
                fileCount: 0,
            });
        }

        const mapNode = (id: string): string => {
            if (nodes.has(id)) {
                return id;
            }
            return this.isUnder(id, level) && hiddenCount ? moreId : OUTSIDE_ID;
        };

        const edgeMap = new Map<string, number>();
        for (const [key, count] of counted) {
            const [rawFrom, rawTo] = key.split('\n');
            const from = mapNode(rawFrom);
            const to = mapNode(rawTo);
            if (from === to) {
                continue;
            }
            const mapped = `${from}\n${to}`;
            edgeMap.set(mapped, (edgeMap.get(mapped) ?? 0) + count);
        }

        const edges: ClusterEdge[] = [];
        for (const [key, count] of edgeMap) {
            const [from, to] = key.split('\n');
            edges.push({ from, to, count, cyclic: false });
        }

        // Cycles among the nodes of this level (packages never close a cycle). Only the edges that
        // go against the layer order are flagged: they are the imports to cut to break the cycles.
        const cycleGroups = findCycles([...nodes.keys()], edges);
        const { backEdges, layers } = layerNodes([...nodes.keys()], edges);
        for (const edge of edges) {
            edge.cyclic = backEdges.has(`${edge.from}\n${edge.to}`);
        }
        for (const node of nodes.values()) {
            node.layer = layers.get(node.id) ?? 0;
        }
        const bottomLayer = Math.max(0, ...layers.values()) + 1;

        let packageCount = 0;
        if (options.showPackages) {
            const pkgEdges = new Map<string, number>();
            const pkgTotals = new Map<string, number>();
            for (const [rel, packages] of this.packagesByRel) {
                if (!this.isUnder(rel, level)) {
                    continue;
                }
                const from = mapNode(this.childOf(level, rel));
                for (const name of packages) {
                    const key = `${from}\n${name}`;
                    pkgEdges.set(key, (pkgEdges.get(key) ?? 0) + 1);
                    pkgTotals.set(name, (pkgTotals.get(name) ?? 0) + 1);
                }
            }
            const keptPackages = new Set(
                [...pkgTotals.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_PACKAGE_NODES)
                    .map(([name]) => name),
            );
            packageCount = pkgTotals.size;
            for (const name of keptPackages) {
                const id = `${PACKAGE_PREFIX}${name}`;
                nodes.set(id, {
                    id,
                    label: name,
                    kind: 'package',
                    fileCount: pkgTotals.get(name)!,
                    layer: bottomLayer,
                });
            }
            for (const [key, count] of pkgEdges) {
                const [from, name] = key.split('\n');
                if (keptPackages.has(name)) {
                    edges.push({ from, to: `${PACKAGE_PREFIX}${name}`, count, cyclic: false });
                }
            }
        }

        let inbound = 0;
        let outbound = 0;
        for (const [from, to] of this.edges) {
            const fromIn = this.isUnder(from, level);
            const toIn = this.isUnder(to, level);
            if (fromIn && !toIn) {
                outbound++;
            } else if (!fromIn && toIn) {
                inbound++;
            }
        }

        return {
            path: level,
            mode: this.mode,
            crumbs: this.crumbsFor(level),
            nodes: [...nodes.values()],
            edges,
            cycleGroups,
            focus: options.focus && nodes.has(options.focus) ? options.focus : undefined,
            stats: {
                files: group.fileCount,
                totalFiles: this.fileCount,
                clusters: group.groups.length,
                inbound,
                outbound,
                packages: packageCount,
                cycles: cycleGroups.length,
            },
        };
    }

    /**
     * Every file and import in one graph, coloured by top-level group. Very large repos keep the
     * most connected files so the webview stays responsive.
     */
    buildFullMap(): ClusterLevel {
        const top = this.rootLevel;
        const groupOf = (rel: string) => {
            const child = this.childOf(top, rel);
            return child === rel ? top : child;
        };

        const degree = new Map<string, number>();
        for (const [from, to] of this.edges) {
            degree.set(from, (degree.get(from) ?? 0) + 1);
            degree.set(to, (degree.get(to) ?? 0) + 1);
        }
        const all = [...this.absByRel.keys()].filter((rel) => this.isUnder(rel, top));
        const kept = all
            .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
            .slice(0, MAX_FULL_MAP_FILES);
        const keptSet = new Set(kept);

        const sizes = new Map<string, number>();
        for (const rel of kept) {
            const group = groupOf(rel);
            sizes.set(group, (sizes.get(group) ?? 0) + 1);
        }
        const legend = [...sizes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_LEGEND_GROUPS)
            .map(([id, count]) => ({
                id,
                label: id === top ? `${this.titleOf(top)} (files)` : this.group(id).label,
                count,
            }));
        const colorOf = new Map(legend.map((entry, i) => [entry.id, i]));

        const nodes: ClusterNode[] = kept.map((rel) => ({
            id: rel,
            label: baseName(rel),
            title: rel,
            kind: 'file',
            fileCount: 1,
            colorGroup: colorOf.get(groupOf(rel)) ?? -1,
        }));
        const edges: ClusterEdge[] = this.edges
            .filter(([from, to]) => keptSet.has(from) && keptSet.has(to))
            .map(([from, to]) => ({ from, to, count: 1, cyclic: false }));

        return {
            path: top,
            mode: this.mode,
            full: true,
            crumbs: [{ path: top, label: 'Full map' }],
            nodes,
            edges,
            cycleGroups: [],
            legend,
            truncated: all.length - kept.length,
            stats: {
                files: all.length,
                totalFiles: this.fileCount,
                clusters: 0,
                inbound: 0,
                outbound: 0,
                packages: 0,
                cycles: 0,
            },
        };
    }

    nodeDetail(level: string, id: string): ClusterNodeDetail {
        if (id === OUTSIDE_ID) {
            return { id, title: 'Other outside groups', kind: 'cluster', uses: [], usedBy: [] };
        }

        if (id.endsWith(MORE_SUFFIX)) {
            const shown = new Set(
                this.buildLevel(level, { showPackages: false }).nodes.map((node) => node.id),
            );
            const files = (this.tree.groups.get(level)?.files ?? []).filter((rel) => !shown.has(rel));
            const groups = (this.tree.groups.get(level)?.groups ?? []).filter((g) => !shown.has(g));
            return {
                id,
                title: `More in ${this.titleOf(level)}`,
                kind: 'more',
                files: this.toItems(files),
                groups: groups
                    .map((g) => ({ id: g, label: this.titleOf(g), count: this.group(g).fileCount }))
                    .sort((a, b) => b.count - a.count),
            };
        }

        if (id.startsWith(PACKAGE_PREFIX)) {
            const name = id.slice(PACKAGE_PREFIX.length);
            const users = [...this.packagesByRel.entries()]
                .filter(([rel, packages]) => this.isUnder(rel, level) && packages.has(name))
                .map(([rel]) => rel);
            return { id, title: name, kind: 'package', usedBy: this.toItems(users) };
        }

        if (this.absByRel.has(id)) {
            return {
                id,
                title: id,
                kind: 'file',
                absolutePath: this.absByRel.get(id),
                dependencies: this.toItems(this.depsByRel.get(id) ?? []),
                dependents: this.toItems(this.importersByRel.get(id) ?? []),
                packages: [...(this.packagesByRel.get(id) ?? [])].sort(),
            };
        }

        if (!this.tree.groups.has(id)) {
            return { id, title: id, kind: 'cluster', uses: [], usedBy: [] };
        }

        // Group: what it talks to, aggregated at the level it is shown in.
        const outgoing = new Map<string, number>();
        const incoming = new Map<string, number>();
        for (const [from, to] of this.edges) {
            const fromIn = this.isUnder(from, id);
            const toIn = this.isUnder(to, id);
            if (fromIn && !toIn) {
                const key = this.childOf(level, to);
                outgoing.set(key, (outgoing.get(key) ?? 0) + 1);
            } else if (!fromIn && toIn) {
                const key = this.childOf(level, from);
                incoming.set(key, (incoming.get(key) ?? 0) + 1);
            }
        }
        const ranked = (map: Map<string, number>): DetailItem[] =>
            [...map.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, MAX_DETAIL_ITEMS)
                .map(([target, count]) => ({
                    id: target,
                    label: this.titleOf(target),
                    count,
                    path: this.absByRel.get(target),
                }));

        const detail: ClusterNodeDetail = {
            id,
            title: this.titleOf(id),
            kind: 'cluster',
            fileCount: this.group(id).fileCount,
            uses: ranked(outgoing),
            usedBy: ranked(incoming),
        };

        if (this.mode === 'communities') {
            const byDir = new Map<string, number>();
            for (const abs of this.filesUnder(id)) {
                const dir = parentDir(this.relByAbs.get(abs)!) || 'root';
                byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
            }
            detail.folders = [...byDir.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, MAX_COMPOSITION_DIRS)
                .map(([dir, count]) => ({ id: dir, label: dir, count }));
        }
        return detail;
    }

    /** File pairs behind one drawn edge. */
    edgeDetail(level: string, from: string, to: string, showPackages: boolean): EdgeDetail {
        const view = this.buildLevel(level, { showPackages });
        const shown = new Set(view.nodes.map((node) => node.id));
        const moreId = `${level}${MORE_SUFFIX}`;
        const mapNode = (rel: string): string => {
            const child = this.childOf(level, rel);
            if (shown.has(child)) {
                return child;
            }
            return this.isUnder(child, level) && shown.has(moreId) ? moreId : OUTSIDE_ID;
        };
        const label = (id: string) => (this.absByRel.has(id) ? id : this.titleOf(id));

        const pairs: EdgeDetail['pairs'] = [];
        let total = 0;

        if (to.startsWith(PACKAGE_PREFIX)) {
            const name = to.slice(PACKAGE_PREFIX.length);
            for (const [rel, packages] of this.packagesByRel) {
                if (this.isUnder(rel, level) && packages.has(name) && mapNode(rel) === from) {
                    total++;
                    if (pairs.length < MAX_EDGE_PAIRS) {
                        pairs.push({ from: rel, fromPath: this.absByRel.get(rel)!, to: name });
                    }
                }
            }
            return { from: label(from), to: name, total, pairs };
        }

        for (const [a, b] of this.edges) {
            if (!this.isUnder(a, level) && !this.isUnder(b, level)) {
                continue;
            }
            if (mapNode(a) === from && mapNode(b) === to) {
                total++;
                if (pairs.length < MAX_EDGE_PAIRS) {
                    pairs.push({
                        from: a,
                        fromPath: this.absByRel.get(a)!,
                        to: b,
                        toPath: this.absByRel.get(b),
                    });
                }
            }
        }
        return { from: label(from), to: label(to), total, pairs };
    }

    search(query: string): SearchHit[] {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return [];
        }
        const hits: { hit: SearchHit; rank: number }[] = [];
        for (const [rel, abs] of this.absByRel) {
            const lower = rel.toLowerCase();
            if (!lower.includes(needle)) {
                continue;
            }
            const base = baseName(lower);
            const rank = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : 2;
            hits.push({
                hit: { kind: 'file', rel, absolutePath: abs, level: this.levelForFile(rel) },
                rank: rank * 1000 + rel.length,
            });
        }
        for (const group of this.tree.groups.values()) {
            if (group.parent === null || !this.depthOk(group.id)) {
                continue;
            }
            const name = this.mode === 'folders' ? baseName(group.id) : group.title;
            if (name.toLowerCase().includes(needle)) {
                hits.push({
                    hit: { kind: 'folder', rel: group.title, level: group.id },
                    rank: 500 + group.title.length,
                });
            }
        }
        return hits
            .sort((a, b) => a.rank - b.rank)
            .slice(0, MAX_SEARCH_HITS)
            .map(({ hit }) => hit);
    }

    /** Files (absolute) under a group id, or the file itself. */
    filesUnder(id: string): string[] {
        if (this.absByRel.has(id)) {
            return [this.absByRel.get(id)!];
        }
        return [...this.absByRel.entries()]
            .filter(([rel]) => this.isUnder(rel, id))
            .map(([, abs]) => abs);
    }

    // ─── internals ──────────────────────────────────────────────────────────

    private group(id: string): Group {
        return this.tree.groups.get(id)!;
    }

    private titleOf(id: string): string {
        if (this.absByRel.has(id)) {
            return id;
        }
        return this.tree.groups.get(id)?.title ?? id;
    }

    /** Groups above the first displayed level are never navigated to. */
    private depthOk(id: string): boolean {
        return id === this.rootLevel || this.isUnder(id, this.rootLevel);
    }

    /** Ancestor groups (root first) of a file or group; excludes the group itself. */
    private ancestorsOf(id: string): string[] {
        const cached = this.ancestorCache.get(id);
        if (cached) {
            return cached;
        }
        const parent = this.absByRel.has(id)
            ? this.tree.fileGroup.get(id)
            : (this.tree.groups.get(id)?.parent ?? null);
        const chain =
            parent === null || parent === undefined ? [] : [...this.ancestorsOf(parent), parent];
        this.ancestorCache.set(id, chain);
        return chain;
    }

    private isUnder(id: string, groupId: string): boolean {
        const group = this.tree.groups.get(groupId);
        return !!group && id !== groupId && this.ancestorsOf(id)[group.depth] === groupId;
    }

    /**
     * Node id representing `id` (a file or group) when viewing `level`: its displayed child when
     * inside, otherwise the branch it hangs from below the common ancestor.
     */
    private childOf(level: string, id: string): string {
        const chain = this.ancestorsOf(id);
        const depth = this.group(level).depth;
        if (chain[depth] === level) {
            return chain[depth + 1] ?? id;
        }
        const levelChain = [...this.ancestorsOf(level), level];
        let common = 0;
        while (common + 1 < chain.length && chain[common + 1] === levelChain[common + 1]) {
            common++;
        }
        return chain[common + 1] ?? id;
    }

    private countEdges(level: string): Map<string, number> {
        const counted = new Map<string, number>();
        for (const [from, to] of this.edges) {
            const fromIn = this.isUnder(from, level);
            const toIn = this.isUnder(to, level);
            if (!fromIn && !toIn) {
                continue;
            }
            const a = this.childOf(level, from);
            const b = this.childOf(level, to);
            if (a === b) {
                continue;
            }
            const key = `${a}\n${b}`;
            counted.set(key, (counted.get(key) ?? 0) + 1);
        }
        return counted;
    }

    private crumbsFor(level: string): ClusterCrumb[] {
        const top = this.rootLevel;
        const chain = [...this.ancestorsOf(level), level];
        const start = Math.max(0, chain.indexOf(top));
        return chain.slice(start).map((id, i) => {
            const group = this.group(id);
            const label = i === 0 && this.mode === 'folders' ? group.title : group.label;
            return { path: id, label };
        });
    }

    private toItems(rels: string[]): DetailItem[] {
        return [...rels]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, MAX_DETAIL_ITEMS)
            .map((rel) => ({ id: rel, label: rel, path: this.absByRel.get(rel) }));
    }
}
