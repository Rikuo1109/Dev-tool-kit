import * as assert from 'assert';
import { toSignatures } from '../shared/aiSignatures';
import { parseChurnLog, resolveRenamedPath } from '../features/hotspots/churn';
import { measureComplexity } from '../features/hotspots/metrics';

suite('toSignatures — brace languages', () => {
    test('elides function and method bodies, keeps imports and types', () => {
        const source = [
            "import { a } from './a';",
            'export interface Foo { x: number }',
            'export function run(x: number): number {',
            '    if (x > 1) {',
            '        return x;',
            '    }',
            '    return 0;',
            '}',
            'class Box {',
            '    size(): number {',
            '        return 1 + 2;',
            '    }',
            '}',
        ].join('\n');
        const result = toSignatures(source, 'src/run.ts');
        assert.ok(result.includes("import { a } from './a';"));
        assert.ok(result.includes('export interface Foo { x: number }'));
        assert.ok(result.includes('export function run(x: number): number { … }'));
        assert.ok(result.includes('size(): number { … }'));
        assert.ok(result.includes('class Box {'));
        assert.ok(!result.includes('return x;'));
    });

    test('elides arrow function bodies', () => {
        const source = 'export const go = async (a: string) => {\n    await a;\n};\n';
        assert.strictEqual(
            toSignatures(source, 'go.js'),
            'export const go = async (a: string) => { … };\n',
        );
    });

    test('ignores braces inside strings and comments', () => {
        const source = 'function f() {\n    const s = "}";\n    // }\n    return s;\n}\nconst after = 1;';
        assert.strictEqual(toSignatures(source, 'f.ts'), 'function f() { … }\nconst after = 1;');
    });

    test('keeps single-line bodies and class bodies from mixins', () => {
        const source = 'const id = (x) => { return x; };\nclass A extends mixin(B) {\n    m() {\n        return 1;\n    }\n}';
        const result = toSignatures(source, 'a.ts');
        assert.ok(result.includes('const id = (x) => { return x; };'));
        assert.ok(result.includes('class A extends mixin(B) {'));
        assert.ok(result.includes('m() { … }'));
    });

    test('leaves unknown languages untouched', () => {
        const source = 'fn main() {\n    println!("hi");\n}';
        assert.strictEqual(toSignatures(source, 'main.rs'), source);
    });
});

suite('toSignatures — Python', () => {
    test('replaces def bodies with ellipsis and keeps class bodies', () => {
        const source = [
            'class A:',
            '    """Doc."""',
            '    def m(self, x):',
            '        return x',
            '',
            'def f(',
            '    a,',
            '    b,',
            ') -> int:',
            '    total = a + b',
            '    return total',
            '',
            'X = 1',
        ].join('\n');
        assert.strictEqual(
            toSignatures(source, 'mod.py'),
            [
                'class A:',
                '    """Doc."""',
                '    def m(self, x):',
                '        ...',
                '',
                'def f(',
                '    a,',
                '    b,',
                ') -> int:',
                '    ...',
                '',
                'X = 1',
            ].join('\n'),
        );
    });

    test('keeps one-line defs as they are', () => {
        const source = 'def f(x): return x\nY = 2';
        assert.strictEqual(toSignatures(source, 'one.py'), source);
    });
});

suite('hotspots — churn parsing', () => {
    test('resolves rename syntax to the new path', () => {
        assert.strictEqual(resolveRenamedPath('src/a.ts'), 'src/a.ts');
        assert.strictEqual(resolveRenamedPath('old.ts => new.ts'), 'new.ts');
        assert.strictEqual(resolveRenamedPath('src/{a => b}/x.ts'), 'src/b/x.ts');
        assert.strictEqual(resolveRenamedPath('src/{ => lib}/x.ts'), 'src/lib/x.ts');
        assert.strictEqual(resolveRenamedPath('src/{lib => }/x.ts'), 'src/x.ts');
    });

    test('aggregates commits, lines and authors per file', () => {
        const output = [
            '\x1eaaa\x1fMe@x.com',
            '',
            '3\t1\tsrc/a.ts',
            '-\t-\tlogo.png',
            '\x1ebbb\x1fyou@x.com',
            '',
            '2\t2\tsrc/{old => new}/b.ts',
            '1\t0\tsrc/a.ts',
        ].join('\n');
        const churn = parseChurnLog(output);
        const a = churn.get('src/a.ts')!;
        assert.strictEqual(a.commits, 2);
        assert.strictEqual(a.linesChanged, 5);
        assert.deepStrictEqual([...a.authors].sort(), ['me@x.com', 'you@x.com']);
        assert.strictEqual(churn.get('src/new/b.ts')?.linesChanged, 4);
        assert.strictEqual(churn.get('logo.png')?.linesChanged, 0);
    });
});

suite('hotspots — complexity', () => {
    test('counts decision points, ignoring strings, comments and optional types', () => {
        const source = [
            'function f(a?: string) {',
            '    // if this were code',
            '    const s = "if && ||";',
            '    if (a && b) {',
            '        return a ? 1 : 2;',
            '    }',
            '    return a ?? b?.c;',
            '}',
        ].join('\n');
        // if, &&, ternary ? → 3 decisions, +1 base.
        assert.strictEqual(measureComplexity(source, 'f.ts').complexity, 4);
    });

    test('counts Python keywords', () => {
        const source = 'def f(x):\n    # if\n    if x and y:\n        return 1\n    elif z:\n        return 2';
        assert.strictEqual(measureComplexity(source, 'f.py').complexity, 4);
    });
});
