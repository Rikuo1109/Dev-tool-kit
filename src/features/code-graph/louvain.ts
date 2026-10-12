export interface WeightedEdge {
    a: number;
    b: number;
    w: number;
}

const MAX_PASSES = 12;
const MAX_SWEEPS = 30;

/**
 * Louvain community detection on an undirected weighted graph of `n` nodes.
 * Returns one partition per aggregation pass, finest first: `passes[k][node]` is the community
 * of original node `node` after pass k. Deterministic (nodes are visited in index order).
 */
export const louvainHierarchy = (n: number, edges: WeightedEdge[], resolution = 1): number[][] => {
    // Current (aggregated) graph.
    let size = n;
    let adjacency: Map<number, number>[] = Array.from({ length: n }, () => new Map());
    let degree = new Float64Array(n);
    for (const { a, b, w } of edges) {
        if (a === b) {
            degree[a] += 2 * w;
            continue;
        }
        adjacency[a].set(b, (adjacency[a].get(b) ?? 0) + w);
        adjacency[b].set(a, (adjacency[b].get(a) ?? 0) + w);
        degree[a] += w;
        degree[b] += w;
    }
    const m2 = degree.reduce((sum, value) => sum + value, 0);
    if (m2 === 0) {
        return [];
    }

    const passes: number[][] = [];
    let original = Array.from({ length: n }, (_, i) => i);

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const community = Array.from({ length: size }, (_, i) => i);
        const total = Float64Array.from(degree);
        let moved = false;

        for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
            let sweepMoves = 0;
            for (let node = 0; node < size; node++) {
                const current = community[node];
                const k = degree[node];
                const linkTo = new Map<number, number>();
                for (const [neighbor, w] of adjacency[node]) {
                    const c = community[neighbor];
                    linkTo.set(c, (linkTo.get(c) ?? 0) + w);
                }

                total[current] -= k;
                let best = current;
                let bestGain = (linkTo.get(current) ?? 0) - (resolution * total[current] * k) / m2;
                for (const [c, w] of linkTo) {
                    const gain = w - (resolution * total[c] * k) / m2;
                    if (gain > bestGain + 1e-12) {
                        best = c;
                        bestGain = gain;
                    }
                }
                total[best] += k;

                if (best !== current) {
                    community[node] = best;
                    sweepMoves++;
                }
            }
            if (sweepMoves === 0) {
                break;
            }
            moved = true;
        }

        // Renumber communities 0..count-1 in first-seen order.
        const renumber = new Map<number, number>();
        for (const c of community) {
            if (!renumber.has(c)) {
                renumber.set(c, renumber.size);
            }
        }
        const count = renumber.size;
        if (!moved || count === size) {
            break;
        }

        const mapped = community.map((c) => renumber.get(c)!);
        original = original.map((node) => mapped[node]);
        passes.push(original);

        // Aggregate: one node per community.
        const nextAdjacency: Map<number, number>[] = Array.from({ length: count }, () => new Map());
        const nextDegree = new Float64Array(count);
        for (let node = 0; node < size; node++) {
            const from = mapped[node];
            nextDegree[from] += degree[node];
            for (const [neighbor, w] of adjacency[node]) {
                const to = mapped[neighbor];
                if (to !== from) {
                    nextAdjacency[from].set(to, (nextAdjacency[from].get(to) ?? 0) + w);
                }
            }
        }
        adjacency = nextAdjacency;
        degree = nextDegree;
        size = count;
    }

    return passes;
};
