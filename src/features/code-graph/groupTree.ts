import { louvainHierarchy, WeightedEdge } from './louvain';

export type GroupMode = 'folders' | 'communities';

export interface Group {
    id: string;
    /** Short label, relative to the parent. */
    label: string;
    /** Full name used outside the parent (context nodes, search, details). */
    title: string;
    parent: string | null;
    groups: string[];
    files: string[];
    fileCount: number;
    depth: number;
}

/** A hierarchy over files: each file belongs to exactly one leaf-most group. */
export interface GroupTree {
    mode: GroupMode;
    root: string;
    groups: Map<string, Group>;
    fileGroup: Map<string, string>;
}

/** Root-level groups beyond this collapse into one "smaller communities" group. */
const MAX_TOP_COMMUNITIES = 40;
const ROOT_ID = '';
const UNCONNECTED_ID = 'c:unconnected';
const SMALL_ID = 'c:small';

const parentDir = (rel: string): string => {
    const slash = rel.lastIndexOf('/');
    return slash < 0 ? '' : rel.slice(0, slash);
};

const joinRel = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

const newGroup = (id: string, parent: string | null, label = id, title = id): Group => ({
    id,
    label,
    title,
    parent,
    groups: [],
    files: [],
    fileCount: 0,
    depth: 0,
});

/** A level with fewer nodes than this pulls its largest subgroup's content up into itself. */
const MIN_LEVEL_NODES = 6;
/** ...as long as the level stays at or below this many nodes. */
const MAX_FLAT_NODES = 25;
/** Subgroups carrying more loose files than this are never dissolved (files would mix). */
const MAX_LIFTED_FILES = 3;

/**
 * Saves clicks on deep, sparse trees (Java packages, nested modules): while a group shows only a
 * few nodes, its largest subgroup is dissolved into it, so `service/impl`, `service/dto` appear
 * directly instead of behind a `service` node.
 */
const flattenSparse = (mode: GroupMode, groups: Map<string, Group>) => {
    const sizeCache = new Map<string, number>();
    const size = (id: string): number => {
        const cached = sizeCache.get(id);
        if (cached !== undefined) {
            return cached;
        }
        const group = groups.get(id)!;
        const total = group.files.length + group.groups.reduce((sum, child) => sum + size(child), 0);
        sizeCache.set(id, total);
        return total;
    };

    const visit = (id: string) => {
        const group = groups.get(id)!;
        for (;;) {
            const count = group.groups.length + group.files.length;
            // A pure wrapper is skipped when choosing the first level; nothing to save there.
            if (count >= MIN_LEVEL_NODES || (count === 1 && group.files.length === 0)) {
                break;
            }
            const candidate = group.groups
                .map((childId) => groups.get(childId)!)
                .filter(
                    (child) =>
                        child.groups.length > 0 &&
                        child.files.length <= MAX_LIFTED_FILES &&
                        count - 1 + child.groups.length + child.files.length <= MAX_FLAT_NODES,
                )
                .sort((a, b) => size(b.id) - size(a.id))[0];
            if (!candidate) {
                break;
            }
            const lifted = candidate.groups.map((childId) => groups.get(childId)!);
            group.groups.splice(group.groups.indexOf(candidate.id), 1, ...candidate.groups);
            group.files.push(...candidate.files);
            for (const child of lifted) {
                child.parent = group.id;
                if (mode === 'folders') {
                    child.label = group.id ? child.id.slice(group.id.length + 1) : child.id;
                }
            }
            groups.delete(candidate.id);
        }
        for (const child of group.groups) {
            visit(child);
        }
    };
    visit(ROOT_ID);

    if (mode === 'folders') {
        for (const group of groups.values()) {
            relabelFolders(group.groups.map((id) => groups.get(id)!));
        }
    }
};

/** Segments kept in a folder label; longer paths show their tail after `…/`. */
const MAX_LABEL_SEGMENTS = 3;

/** Sibling folder labels without the path prefix they all share (`com/acme/app/service` → `service`). */
const relabelFolders = (siblings: Group[]) => {
    if (!siblings.length) {
        return;
    }
    let prefix = parentDir(siblings[0].id);
    for (const sibling of siblings) {
        while (prefix && !sibling.id.startsWith(`${prefix}/`)) {
            prefix = parentDir(prefix);
        }
    }
    for (const sibling of siblings) {
        const rest = prefix ? sibling.id.slice(prefix.length + 1) : sibling.id;
        const parts = rest.split('/');
        sibling.label =
            parts.length > MAX_LABEL_SEGMENTS
                ? `…/${parts.slice(-MAX_LABEL_SEGMENTS).join('/')}`
                : rest;
    }
};

/** Fills depth, fileCount and fileGroup after the structure is final. */
const finalize = (mode: GroupMode, groups: Map<string, Group>): GroupTree => {
    flattenSparse(mode, groups);
    const fileGroup = new Map<string, string>();
    const visit = (id: string, depth: number): number => {
        const group = groups.get(id)!;
        group.depth = depth;
        let count = group.files.length;
        for (const file of group.files) {
            fileGroup.set(file, id);
        }
        for (const child of group.groups) {
            count += visit(child, depth + 1);
        }
        group.fileCount = count;
        return count;
    };
    visit(ROOT_ID, 0);
    return { mode, root: ROOT_ID, groups, fileGroup };
};

/** Replaces `child` with its own children in `parent`, preserving order. */
const spliceChild = (groups: Map<string, Group>, parent: Group, child: Group, lift: Group[]) => {
    const at = parent.groups.indexOf(child.id);
    parent.groups.splice(at, 1, ...lift.map((g) => g.id));
    for (const g of lift) {
        g.parent = parent.id;
    }
    groups.delete(child.id);
};

// ─── Folders ────────────────────────────────────────────────────────────────

const JVM_SOURCE_ROOT = /^(?:(.*)\/)?src\/(?:main|test)\/(?:java|kotlin|scala|groovy)(?:\/(.*))?$/;

/**
 * Folder a file is grouped under. JVM source roots are dropped so packages read as packages and
 * main/test classes of one package share a group: `api/src/main/java/com/x/Foo.java` → `api/com/x`.
 */
export const groupDirOf = (rel: string): string => {
    const dir = parentDir(rel);
    const match = JVM_SOURCE_ROOT.exec(dir);
    if (!match) {
        return dir;
    }
    const [, moduleDir = '', packageDir = ''] = match;
    return joinRel(moduleDir, packageDir);
};

/** Folder hierarchy; a folder that only wraps one subfolder is merged into it (`a/b/c`). */
export const buildFolderTree = (files: string[]): GroupTree => {
    const raw = new Map<string, { dirs: Set<string>; files: string[] }>();
    raw.set('', { dirs: new Set(), files: [] });
    for (const rel of files) {
        const parts = groupDirOf(rel).split('/').filter(Boolean);
        let dir = '';
        for (let i = 0; i < parts.length; i++) {
            const next = joinRel(dir, parts[i]);
            raw.get(dir)!.dirs.add(parts[i]);
            if (!raw.has(next)) {
                raw.set(next, { dirs: new Set(), files: [] });
            }
            dir = next;
        }
        raw.get(dir)!.files.push(rel);
    }

    const compress = (dir: string): string => {
        let current = dir;
        for (;;) {
            const entry = raw.get(current)!;
            if (entry.files.length > 0 || entry.dirs.size !== 1) {
                return current;
            }
            current = joinRel(current, [...entry.dirs][0]);
        }
    };

    const groups = new Map<string, Group>();
    const add = (id: string, parent: string | null) => {
        const label = parent && id.startsWith(`${parent}/`) ? id.slice(parent.length + 1) : id;
        const group = newGroup(id, parent, label || 'root', id || 'root');
        groups.set(id, group);
        const entry = raw.get(id)!;
        group.files = [...entry.files];
        for (const name of [...entry.dirs].sort()) {
            const child = compress(joinRel(id, name));
            group.groups.push(child);
            add(child, id);
        }
    };
    add(ROOT_ID, null);
    return finalize('folders', groups);
};

// ─── Communities ────────────────────────────────────────────────────────────

/** Share of a community's files a folder must hold to name it. */
const NAME_SHARE = 0.6;
/** A leaf folder with this share names the community alone. */
const DOMINANT_SHARE = 0.5;
/** Two leaf folders with this combined share name it together. */
const PAIR_SHARE = 0.3;

const depthOf = (dir: string): number => (dir ? dir.split('/').length : 0);

/** Deepest folder containing every file. */
export const commonDir = (files: string[]): string => {
    if (!files.length) {
        return '';
    }
    let prefix = parentDir(files[0]);
    for (const file of files) {
        while (prefix && !(parentDir(file) === prefix || file.startsWith(`${prefix}/`))) {
            prefix = parentDir(prefix);
        }
    }
    return prefix;
};

/**
 * Names a community after where its files live: the dominant leaf folder, else its two largest
 * leaf folders, else (many small folders) the deepest folder holding most files that is more
 * specific than the repo's common root.
 */
export const nameCommunity = (
    files: string[],
    repoRoot = '',
): { label: string; title: string } => {
    const underDir = new Map<string, number>();
    const byLeaf = new Map<string, number>();
    for (const file of files) {
        let dir = parentDir(file);
        byLeaf.set(dir, (byLeaf.get(dir) ?? 0) + 1);
        for (;;) {
            underDir.set(dir, (underDir.get(dir) ?? 0) + 1);
            if (!dir) {
                break;
            }
            dir = parentDir(dir);
        }
    }

    const total = files.length || 1;
    const leaves = [...byLeaf.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const short = (dir: string, segments: number) =>
        dir.split('/').slice(-segments).join('/') || 'root';
    const plus = (shown: number) => (leaves.length > shown ? ` +${leaves.length - shown}` : '');

    let best = '';
    for (const [dir, count] of underDir) {
        if (count / total >= NAME_SHARE && depthOf(dir) > depthOf(best)) {
            best = dir;
        }
    }

    const [first, second] = leaves;
    let label: string;
    if (first && first[1] / total >= DOMINANT_SHARE) {
        label = short(first[0], 2) + plus(1);
    } else if (first && second && (first[1] + second[1]) / total >= PAIR_SHARE) {
        label = `${short(first[0], 1)} · ${short(second[0], 1)}${plus(2)}`;
    } else if (best && depthOf(best) > depthOf(repoRoot)) {
        label = short(best, 2);
    } else {
        label = first ? short(first[0], 2) + plus(1) : 'root';
    }

    const described = leaves
        .slice(0, 3)
        .map(([dir, count]) => `${dir || 'root'} (${count})`)
        .join(', ');
    return { label, title: `${label} — ${files.length} files: ${described}${plus(3) ? ', …' : ''}` };
};

/**
 * Hierarchy from Louvain community detection over the (undirected) import graph:
 * coarsest communities at the top, finer ones below, files at the bottom.
 */
export const buildCommunityTree = (files: string[], edges: [string, string][]): GroupTree => {
    const indexOf = new Map(files.map((rel, i) => [rel, i]));
    const weighted: WeightedEdge[] = [];
    const connected = new Set<number>();
    for (const [from, to] of edges) {
        const a = indexOf.get(from);
        const b = indexOf.get(to);
        if (a === undefined || b === undefined || a === b) {
            continue;
        }
        weighted.push({ a, b, w: 1 });
        connected.add(a);
        connected.add(b);
    }

    const passes = louvainHierarchy(files.length, weighted);
    const groups = new Map<string, Group>();
    const root = newGroup(ROOT_ID, null, 'All communities', 'All communities');
    groups.set(ROOT_ID, root);

    const ensure = (id: string, parent: string): Group => {
        let group = groups.get(id);
        if (!group) {
            group = newGroup(id, parent);
            groups.set(id, group);
            groups.get(parent)!.groups.push(id);
        }
        return group;
    };

    const unconnected: string[] = [];
    files.forEach((rel, node) => {
        if (!connected.has(node) || passes.length === 0) {
            unconnected.push(rel);
            return;
        }
        let parent = ROOT_ID;
        for (let level = passes.length - 1; level >= 0; level--) {
            parent = ensure(`c${level}:${passes[level][node]}`, parent).id;
        }
        groups.get(parent)!.files.push(rel);
    });

    // Collapse trivial groups bottom-up: one-file groups dissolve, single-child groups merge.
    const collapse = (id: string) => {
        const group = groups.get(id)!;
        for (const child of [...group.groups]) {
            collapse(child);
        }
        // Repeat: a lifted grandchild may itself be trivial.
        for (let changed = true; changed; ) {
            changed = false;
            for (const childId of [...group.groups]) {
                const child = groups.get(childId)!;
                if (child.groups.length === 0 && child.files.length === 1) {
                    group.groups.splice(group.groups.indexOf(childId), 1);
                    group.files.push(child.files[0]);
                    groups.delete(childId);
                    changed = true;
                } else if (child.groups.length === 1 && child.files.length === 0) {
                    spliceChild(groups, group, child, [groups.get(child.groups[0])!]);
                    changed = true;
                }
            }
        }
    };
    collapse(ROOT_ID);

    if (unconnected.length) {
        const group = newGroup(UNCONNECTED_ID, ROOT_ID, 'Unconnected files', 'Files with no internal imports');
        group.files = unconnected;
        groups.set(UNCONNECTED_ID, group);
        root.groups.push(UNCONNECTED_ID);
    }

    // Name groups (needs file lists, so after collapsing).
    const repoRoot = commonDir(files);
    const filesUnder = (id: string): string[] => {
        const group = groups.get(id)!;
        return [...group.files, ...group.groups.flatMap(filesUnder)];
    };
    for (const group of groups.values()) {
        if (group.id === ROOT_ID || group.id === UNCONNECTED_ID) {
            continue;
        }
        Object.assign(group, nameCommunity(filesUnder(group.id), repoRoot));
    }

    // Too many top-level communities: keep the largest, fold the rest into one group.
    const sized = (id: string) => filesUnder(id).length;
    const top = root.groups.filter((id) => id !== UNCONNECTED_ID).sort((a, b) => sized(b) - sized(a));
    if (top.length > MAX_TOP_COMMUNITIES) {
        const rest = top.slice(MAX_TOP_COMMUNITIES - 1);
        const small = newGroup(SMALL_ID, ROOT_ID, `${rest.length} smaller communities`, `${rest.length} smaller communities`);
        groups.set(SMALL_ID, small);
        small.groups = rest;
        for (const id of rest) {
            groups.get(id)!.parent = SMALL_ID;
        }
        root.groups = [...top.slice(0, MAX_TOP_COMMUNITIES - 1), SMALL_ID];
        if (unconnected.length) {
            root.groups.push(UNCONNECTED_ID);
        }
    } else {
        root.groups = [...top, ...(unconnected.length ? [UNCONNECTED_ID] : [])];
    }

    // Sibling labels must be distinguishable.
    for (const group of groups.values()) {
        const seen = new Map<string, number>();
        for (const id of group.groups) {
            const child = groups.get(id)!;
            const n = (seen.get(child.label) ?? 0) + 1;
            seen.set(child.label, n);
            if (n > 1) {
                child.label = `${child.label} #${n}`;
            }
        }
    }

    return finalize('communities', groups);
};
