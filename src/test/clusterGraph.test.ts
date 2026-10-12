import * as assert from 'assert';
import {
    ClusterModel,
    compactLayers,
    findCycles,
    layerNodes,
    packageNameOf,
} from '../features/code-graph/clusterGraph';
import { commonDir, groupDirOf, nameCommunity } from '../features/code-graph/groupTree';
import { louvainHierarchy } from '../features/code-graph/louvain';
import { ImportIndex, ParsedImport } from '../shared/javascript/importGraph';

const ROOT = '/repo';

/** Minimal import index: `edges` maps a relative file to the relative files it imports. */
const fakeIndex = (
    edges: Record<string, string[]>,
    packages: Record<string, string[]> = {},
): ImportIndex => {
    const abs = (rel: string) => `${ROOT}/${rel}`;
    const files = Object.keys(edges).map(abs);
    return {
        workspaceRoot: ROOT,
        files,
        getDependencies: (file: string) => (edges[file.slice(ROOT.length + 1)] ?? []).map(abs),
        getImports: (file: string): ParsedImport[] =>
            (packages[file.slice(ROOT.length + 1)] ?? []).map((specifier) => ({
                specifier,
                resolvedPath: null,
                named: new Set<string>(),
                defaultImport: false,
                namespace: false,
                sideEffect: false,
            })),
    } as unknown as ImportIndex;
};

const ids = (model: ClusterModel, level: string) =>
    model
        .buildLevel(level, { showPackages: false })
        .nodes.map((node) => `${node.kind}:${node.id}`)
        .sort();

suite('ClusterModel', () => {
    const model = new ClusterModel(
        fakeIndex({
            'src/app/main.ts': ['src/app/ui/button.ts', 'src/lib/util.ts'],
            'src/app/ui/button.ts': ['src/lib/util.ts'],
            'src/lib/util.ts': ['src/lib/deep/only/leaf.ts'],
            'src/lib/deep/only/leaf.ts': ['src/lib/util.ts'],
            // Enough siblings that `src` is not flattened (sparse levels pull subgroups up).
            ...Object.fromEntries(['p', 'q', 'r', 's'].map((name) => [`src/${name}/x.ts`, []])),
        }),
    );

    test('skips wrapper folders for the top level', () => {
        assert.strictEqual(model.rootLevel, 'src');
        assert.deepStrictEqual(ids(model, 'src'), [
            'cluster:src/app',
            'cluster:src/lib',
            'cluster:src/p',
            'cluster:src/q',
            'cluster:src/r',
            'cluster:src/s',
        ]);
    });

    test('aggregates file imports into one weighted edge between clusters', () => {
        const level = model.buildLevel('src', { showPackages: false });
        const edge = level.edges.find((e) => e.from === 'src/app' && e.to === 'src/lib');
        assert.strictEqual(edge?.count, 2);
        assert.strictEqual(edge?.cyclic, false);
    });

    test('merges single-child folder chains and flags cycles', () => {
        assert.deepStrictEqual(ids(model, 'src/lib'), [
            'cluster:src/lib/deep/only',
            'context:src/app',
            'file:src/lib/util.ts',
        ]);
        const level = model.buildLevel('src/lib', { showPackages: false });
        assert.strictEqual(level.stats.cycles, 1);
        assert.deepStrictEqual(
            level.crumbs.map((c) => c.label),
            ['src', 'lib'],
        );
    });

    test('locates the level showing a file', () => {
        assert.strictEqual(model.levelForFile('src/lib/deep/only/leaf.ts'), 'src/lib/deep/only');
        assert.strictEqual(model.levelForDir('src/lib/deep'), 'src/lib/deep/only');
    });

    test('lists file pairs behind an edge', () => {
        const detail = model.edgeDetail('src', 'src/app', 'src/lib', false);
        assert.strictEqual(detail.total, 2);
        assert.deepStrictEqual(detail.pairs.map((p) => p.from).sort(), [
            'src/app/main.ts',
            'src/app/ui/button.ts',
        ]);
    });

    test('adds package nodes only when asked', () => {
        const withPkgs = new ClusterModel(
            fakeIndex({ 'a/x.ts': [], 'b/y.ts': [] }, { 'a/x.ts': ['@scope/pkg/sub', 'node:fs'] }),
        );
        const level = withPkgs.buildLevel('', { showPackages: true });
        assert.deepStrictEqual(
            level.nodes.filter((n) => n.kind === 'package').map((n) => n.label).sort(),
            ['@scope/pkg', 'fs'],
        );
    });
});

suite('packageNameOf', () => {
    test('keeps the scope and drops subpaths', () => {
        assert.strictEqual(packageNameOf('@scope/pkg/deep'), '@scope/pkg');
        assert.strictEqual(packageNameOf('lodash/fp'), 'lodash');
        assert.strictEqual(packageNameOf('node:path'), 'path');
    });
});

suite('findCycles', () => {
    test('finds cycles longer than two nodes and ignores acyclic tails', () => {
        const cycles = findCycles(
            ['a', 'b', 'c', 'd'],
            [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
                { from: 'c', to: 'a' },
                { from: 'c', to: 'd' },
            ],
        );
        assert.deepStrictEqual(cycles, [['a', 'b', 'c']]);
    });
});

suite('louvainHierarchy', () => {
    test('separates two cliques joined by one edge', () => {
        const edges = [];
        for (const base of [0, 4]) {
            for (let i = 0; i < 4; i++) {
                for (let j = i + 1; j < 4; j++) {
                    edges.push({ a: base + i, b: base + j, w: 1 });
                }
            }
        }
        edges.push({ a: 3, b: 4, w: 1 });
        const passes = louvainHierarchy(8, edges);
        const finest = passes[0];
        assert.ok(finest.slice(0, 4).every((c) => c === finest[0]));
        assert.ok(finest.slice(4).every((c) => c === finest[4]));
        assert.notStrictEqual(finest[0], finest[4]);
    });
});

suite('community mode', () => {
    const edges: Record<string, string[]> = {};
    const clique = (names: string[]) => {
        for (const from of names) {
            edges[from] = names.filter((to) => to !== from);
        }
    };
    clique(['src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts', 'src/b/4.ts']);
    clique(['src/c/5.ts', 'src/c/6.ts', 'src/c/7.ts']);
    edges['src/b/4.ts'].push('src/c/5.ts');
    edges['src/lonely.ts'] = [];

    const model = new ClusterModel(fakeIndex(edges), 'communities');

    test('groups tightly connected files regardless of folders', () => {
        const level = model.buildLevel(model.rootLevel, { showPackages: false });
        const clusters = level.nodes.filter((n) => n.kind === 'cluster');
        assert.deepStrictEqual(clusters.map((n) => n.fileCount).sort(), [1, 3, 4]);
        const withB = model.levelForFile('src/b/4.ts');
        assert.strictEqual(model.levelForFile('src/a/1.ts'), withB);
        assert.notStrictEqual(model.levelForFile('src/c/5.ts'), withB);
    });

    test('puts files without internal imports in their own group', () => {
        const level = model.buildLevel(model.rootLevel, { showPackages: false });
        assert.ok(level.nodes.some((n) => n.label === 'Unconnected files'));
    });

    test('reports where a community lives', () => {
        const detail = model.nodeDetail(model.rootLevel, model.levelForFile('src/a/1.ts'));
        assert.deepStrictEqual(detail.folders?.map((f) => f.id), ['src/a', 'src/b']);
    });
});

suite('nameCommunity', () => {
    test('uses the dominant folder', () => {
        assert.strictEqual(nameCommunity(['x/a/1.ts', 'x/a/2.ts', 'x/b/3.ts']).label, 'x/a +1');
    });

    test('pairs the two largest folders when none dominates', () => {
        const files = ['s/a/1.ts', 's/a/2.ts', 's/b/3.ts', 's/b/4.ts', 's/c/5.ts', 's/d/6.ts'];
        assert.strictEqual(nameCommunity(files, 's').label, 'a · b +2');
    });

    test('falls back to the common folder for many small folders', () => {
        const files = Array.from({ length: 10 }, (_, i) => `repo/pkg/m${i}/f.ts`);
        assert.strictEqual(nameCommunity(files, 'repo').label, 'repo/pkg');
        assert.strictEqual(commonDir(files), 'repo/pkg');
    });
});

suite('layerNodes', () => {
    test('a DAG has no back edges and importers sit above what they import', () => {
        const { backEdges, layers } = layerNodes(
            ['pages', 'features', 'utils'],
            [
                { from: 'pages', to: 'features', count: 5 },
                { from: 'features', to: 'utils', count: 40 },
                { from: 'pages', to: 'utils', count: 2 },
            ],
        );
        assert.strictEqual(backEdges.size, 0);
        assert.ok(layers.get('pages')! < layers.get('features')!);
        assert.ok(layers.get('features')! < layers.get('utils')!);
    });

    test('flags the minority direction by share, not raw count', () => {
        // 5 of pages' 5 imports go to features; 37 of features' 2,000 go back to pages.
        const { backEdges } = layerNodes(
            ['pages', 'features', 'utils'],
            [
                { from: 'pages', to: 'features', count: 5 },
                { from: 'features', to: 'pages', count: 37 },
                { from: 'features', to: 'utils', count: 1963 },
            ],
        );
        assert.deepStrictEqual([...backEdges], ['features\npages']);
    });
});

suite('compactLayers', () => {
    test('merges a long chain into a few monotone bands', () => {
        const chain = new Map(Array.from({ length: 20 }, (_, i) => [`n${i}`, i]));
        const bands = compactLayers(chain);
        const values = [...bands.values()];
        assert.ok(Math.max(...values) + 1 <= 6);
        for (let i = 1; i < 20; i++) {
            assert.ok(bands.get(`n${i}`)! >= bands.get(`n${i - 1}`)!);
        }
    });

    test('keeps short layerings as they are', () => {
        const layers = new Map([
            ['a', 0],
            ['b', 1],
            ['c', 1],
        ]);
        assert.deepStrictEqual([...compactLayers(layers)], [...layers]);
    });
});

suite('JVM grouping and sparse levels', () => {
    test('drops source roots and merges main/test of one package', () => {
        assert.strictEqual(groupDirOf('src/main/java/com/acme/App.java'), 'com/acme');
        assert.strictEqual(groupDirOf('api/src/test/kotlin/com/acme/FooTest.kt'), 'api/com/acme');
        assert.strictEqual(groupDirOf('web/src/app.ts'), 'web/src');
    });

    test('shows Spring-style packages one click from the top', () => {
        const edges: Record<string, string[]> = {};
        for (const pkg of ['controller', 'service', 'repository', 'entity', 'dto', 'config']) {
            edges[`src/main/java/com/acme/app/${pkg}/A.java`] = [];
        }
        edges['src/test/java/com/acme/app/service/ATest.java'] = [];
        const model = new ClusterModel(fakeIndex(edges));
        const level = model.buildLevel(model.rootLevel, { showPackages: false });
        assert.deepStrictEqual(
            level.nodes.map((n) => n.label).sort(),
            ['config', 'controller', 'dto', 'entity', 'repository', 'service'],
        );
        assert.strictEqual(
            model.levelForFile('src/test/java/com/acme/app/service/ATest.java'),
            model.levelForFile('src/main/java/com/acme/app/service/A.java'),
        );
    });
});
