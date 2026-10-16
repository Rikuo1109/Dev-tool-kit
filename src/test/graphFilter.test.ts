import * as assert from 'assert';
import { ClusterModel } from '../features/code-graph/clusterGraph';
import {
    createFilteredIndex,
    evaluateGraphFilter,
    GraphFilterOptions,
    isGraphFilterActive,
    matchesGraphFilter,
    parseGraphFilter,
    sanitizeGraphFilter,
} from '../features/code-graph/graphFilter';
import { ImportIndex, ParsedImport } from '../shared/javascript/importGraph';

const ROOT = '/repo';

const keeps = (text: string, rel: string): boolean => {
    const parsed = parseGraphFilter(text);
    assert.deepStrictEqual(parsed.errors, [], `unexpected errors for "${text}"`);
    return matchesGraphFilter(parsed, rel);
};

suite('graph filter: pattern parsing', () => {
    test('empty text keeps everything', () => {
        const parsed = parseGraphFilter('   ');
        assert.deepStrictEqual(parsed.errors, []);
        assert.strictEqual(parsed.includes.length, 0);
        assert.strictEqual(parsed.excludes.length, 0);
        assert.ok(matchesGraphFilter(parsed, 'src/a.ts'));
    });

    test('include globs are OR-ed and anchored at the workspace root', () => {
        assert.ok(keeps('src/features/**', 'src/features/a/b.ts'));
        assert.ok(!keeps('src/features/**', 'lib/src/features/b.ts'));
        assert.ok(keeps('src/features/** lib/**', 'lib/x.ts'));
        assert.ok(!keeps('src/features/** lib/**', 'docs/x.ts'));
        assert.ok(keeps('src/*/index.ts', 'src/app/index.ts'));
        assert.ok(!keeps('src/*/index.ts', 'src/app/deep/index.ts'));
        assert.ok(keeps('src/**/index.ts', 'src/app/deep/index.ts'));
        assert.ok(keeps('src/**/index.ts', 'src/index.ts'));
    });

    test('a folder glob also covers everything beneath it', () => {
        assert.ok(keeps('src/feat*', 'src/features/a.ts'));
    });

    test('a glob without a slash matches a name at any depth', () => {
        assert.ok(keeps('*.ts', 'src/deep/a.ts'));
        assert.ok(!keeps('*.ts', 'src/deep/a.js'));
        assert.ok(keeps('__tests__*', 'src/__tests__/a.ts'));
    });

    test('exclude patterns win over includes', () => {
        assert.ok(!keeps('src/** !**/*.test.*', 'src/a.test.ts'));
        assert.ok(keeps('src/** !**/*.test.*', 'src/a.ts'));
        assert.ok(!keeps('*.ts !**/dist/**', 'src/dist/a.ts'));
        assert.ok(keeps('*.ts !**/dist/**', 'src/a.ts'));
    });

    test('only excludes keep everything else', () => {
        assert.ok(keeps('!**/*.test.*', 'src/a.ts'));
        assert.ok(!keeps('!**/*.test.*', 'src/a.test.ts'));
    });

    test('plain text is a case-insensitive path substring match', () => {
        assert.ok(keeps('auth', 'src/features/Authentication/login.ts'));
        assert.ok(keeps('auth', 'src/oauth.ts'));
        assert.ok(!keeps('auth', 'src/billing.ts'));
        assert.ok(keeps('src/features', 'x/src/features/a.ts'));
        assert.ok(keeps('/src', 'src/a.ts'));
        assert.ok(!keeps('/src', 'source.ts'));
        assert.ok(!keeps('auth !test', 'src/auth/test/a.ts'));
        assert.ok(keeps('auth !test', 'src/auth/a.ts'));
    });

    test('commas, whitespace, braces and quotes separate patterns correctly', () => {
        assert.strictEqual(parseGraphFilter('a,b  c ,d').includes.length, 4);
        // The comma inside braces is part of one pattern.
        const braces = parseGraphFilter('src/**/*.{ts,tsx}');
        assert.deepStrictEqual(braces.errors, []);
        assert.strictEqual(braces.includes.length, 1);
        assert.ok(matchesGraphFilter(braces, 'src/a/b.tsx'));
        assert.ok(matchesGraphFilter(braces, 'src/b.ts'));
        assert.ok(!matchesGraphFilter(braces, 'src/b.js'));
        assert.ok(keeps('"my dir/**"', 'my dir/a.ts'));
        assert.ok(keeps('src/[ab].ts', 'src/a.ts'));
        assert.ok(!keeps('src/[!ab].ts', 'src/a.ts'));
        assert.ok(keeps('src/?.ts', 'src/a.ts'));
    });

    test('Windows separators in the path are normalised', () => {
        assert.ok(keeps('src/features/**', 'src\\features\\a.ts'));
    });

    test('invalid patterns report an error instead of throwing', () => {
        for (const bad of ['src/{a,b', 'a}', 'src/[abc', '!', '"unterminated', 'src/**/*.{ts,tsx']) {
            const parsed = parseGraphFilter(bad);
            assert.ok(parsed.errors.length > 0, `"${bad}" should be invalid`);
        }
        assert.ok(parseGraphFilter('x'.repeat(2001)).errors.length > 0);
        assert.ok(parseGraphFilter(Array.from({ length: 60 }, (_, i) => `p${i}`).join(' ')).errors.length > 0);
    });
});

suite('graph filter: options', () => {
    test('sanitize coerces untrusted input', () => {
        assert.deepStrictEqual(sanitizeGraphFilter(undefined), { text: '', hideTests: false, minImporters: 0 });
        assert.deepStrictEqual(
            sanitizeGraphFilter({ text: 'src', hideTests: true, minImporters: 2, extra: 1 }),
            { text: 'src', hideTests: true, minImporters: 2 },
        );
        assert.strictEqual(sanitizeGraphFilter({ minImporters: 7 }).minImporters, 0);
        assert.strictEqual(sanitizeGraphFilter({ text: 5 }).text, '');
        assert.strictEqual(sanitizeGraphFilter({ hideTests: 'yes' }).hideTests, false);
    });

    test('active when any part is set', () => {
        assert.ok(!isGraphFilterActive({ text: '  ', hideTests: false, minImporters: 0 }));
        assert.ok(isGraphFilterActive({ text: 'a', hideTests: false, minImporters: 0 }));
        assert.ok(isGraphFilterActive({ text: '', hideTests: true, minImporters: 0 }));
        assert.ok(isGraphFilterActive({ text: '', hideTests: false, minImporters: 1 }));
    });
});

/** Minimal import index: `edges` maps a relative file to the relative files it imports. */
const buildIndex = (edges: Record<string, string[]>): ImportIndex => {
    const abs = (rel: string) => `${ROOT}/${rel}`;
    const importers = new Map<string, string[]>();
    for (const [from, deps] of Object.entries(edges)) {
        for (const dep of deps) {
            importers.set(abs(dep), [...(importers.get(abs(dep)) ?? []), abs(from)]);
        }
    }
    const imports = (file: string): ParsedImport[] =>
        (edges[file.slice(ROOT.length + 1)] ?? []).map((dep) => ({
            specifier: `./${dep}`,
            resolvedPath: abs(dep),
            named: new Set<string>(),
            defaultImport: false,
            namespace: false,
            sideEffect: false,
        }));
    return {
        workspaceRoot: ROOT,
        files: Object.keys(edges).map(abs),
        entryPoints: new Set([abs('src/main.ts')]),
        relativePath: (file: string) => file.slice(ROOT.length + 1),
        getContent: () => '',
        getDependencies: (file: string) => (edges[file.slice(ROOT.length + 1)] ?? []).map(abs),
        getImporters: (file: string) => importers.get(file) ?? [],
        getImports: imports,
        resolve: (_from: string, specifier: string) => abs(specifier.slice(2)),
        javaTypeIndex: {},
    } as unknown as ImportIndex;
};

const options = (patch: Partial<GraphFilterOptions>): GraphFilterOptions => ({
    text: '',
    hideTests: false,
    minImporters: 0,
    ...patch,
});

suite('graph filter: applied to an index', () => {
    const base = buildIndex({
        'src/main.ts': ['src/app/a.ts', 'src/lib/util.ts'],
        'src/app/a.ts': ['src/lib/util.ts', 'src/lib/log.ts'],
        'src/app/a.test.ts': ['src/app/a.ts'],
        'src/lib/util.ts': ['src/lib/log.ts'],
        'src/lib/log.ts': ['src/lib/util.ts'],
        'docs/x.ts': ['src/lib/log.ts'],
    });
    const rels = (kept: Set<string> | null) => [...(kept ?? [])].map((f) => f.slice(ROOT.length + 1)).sort();

    test('no filter keeps the whole index', () => {
        assert.deepStrictEqual(evaluateGraphFilter(base, options({})), { kept: null });
    });

    test('include / exclude / hide tests', () => {
        assert.deepStrictEqual(rels(evaluateGraphFilter(base, options({ text: 'src/app/**' })).kept), [
            'src/app/a.test.ts',
            'src/app/a.ts',
        ]);
        assert.deepStrictEqual(rels(evaluateGraphFilter(base, options({ text: 'src/** !**/lib/**' })).kept), [
            'src/app/a.test.ts',
            'src/app/a.ts',
            'src/main.ts',
        ]);
        assert.ok(
            !rels(evaluateGraphFilter(base, options({ hideTests: true })).kept).includes('src/app/a.test.ts'),
        );
    });

    test('min importers counts importers inside the remaining set', () => {
        // log.ts is imported by a.ts, util.ts and docs/x.ts; a.ts only by main.ts and a.test.ts.
        const kept = evaluateGraphFilter(base, options({ text: 'src/**', minImporters: 2 })).kept;
        assert.deepStrictEqual(rels(kept), ['src/app/a.ts', 'src/lib/log.ts', 'src/lib/util.ts']);
        // Without docs/x.ts and the test, log.ts keeps 2 importers (a.ts, util.ts); a.ts keeps 1 (main.ts).
        const strict = evaluateGraphFilter(base, options({ text: 'src/** !**/*.test.*', minImporters: 2 })).kept;
        assert.deepStrictEqual(rels(strict), ['src/lib/log.ts', 'src/lib/util.ts']);
    });

    test('invalid pattern or empty result is reported, not applied', () => {
        const invalid = evaluateGraphFilter(base, options({ text: 'src/{a' }));
        assert.strictEqual(invalid.kept, null);
        assert.ok(invalid.error);
        const none = evaluateGraphFilter(base, options({ text: 'does-not-exist' }));
        assert.strictEqual(none.kept, null);
        assert.strictEqual(none.error, 'No files match this filter');
    });

    test('filtered index drops imports to and from removed files', () => {
        const kept = evaluateGraphFilter(base, options({ text: 'src/** !**/*.test.*' })).kept!;
        const filtered = createFilteredIndex(base, kept);
        assert.ok(!filtered.files.some((f) => f.endsWith('a.test.ts')));
        assert.deepStrictEqual(filtered.getImporters(`${ROOT}/src/app/a.ts`), [`${ROOT}/src/main.ts`]);
        assert.deepStrictEqual(filtered.getImporters(`${ROOT}/src/lib/log.ts`).sort(), [
            `${ROOT}/src/app/a.ts`,
            `${ROOT}/src/lib/util.ts`,
        ]);
        assert.deepStrictEqual(filtered.getDependencies(`${ROOT}/src/app/a.test.ts`), []);
        assert.strictEqual(filtered.resolve(`${ROOT}/src/main.ts`, './docs/x.ts'), null);
        assert.deepStrictEqual(filtered.entryPoints, new Set([`${ROOT}/src/main.ts`]));
    });

    test('clusters, edges and cycles reflect the filtered set', () => {
        const everything = new ClusterModel(base);
        assert.strictEqual(everything.fileCount, 6);

        const kept = evaluateGraphFilter(base, options({ text: 'src/lib/**' })).kept!;
        const model = new ClusterModel(createFilteredIndex(base, kept));
        assert.strictEqual(model.fileCount, 2);
        assert.strictEqual(model.edgeCount, 2);
        const level = model.buildLevel(model.rootLevel, { showPackages: false });
        assert.strictEqual(level.stats.files, 2);
        assert.strictEqual(level.stats.totalFiles, 2);
        assert.deepStrictEqual(level.nodes.map((node) => node.id).sort(), ['src/lib/log.ts', 'src/lib/util.ts']);
        // util.ts <-> log.ts is a cycle that survives; the edges from outside the filter are gone.
        assert.strictEqual(level.stats.cycles, 1);
        assert.strictEqual(level.stats.inbound, 0);

        // Dropping one side of the cycle removes it.
        const single = evaluateGraphFilter(base, options({ text: 'src/lib/util.ts' })).kept!;
        const lone = new ClusterModel(createFilteredIndex(base, single));
        assert.strictEqual(lone.buildLevel(lone.rootLevel, { showPackages: false }).stats.cycles, 0);
    });
});
