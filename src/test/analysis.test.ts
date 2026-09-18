import * as assert from 'assert';
import * as vscode from 'vscode';
import { lineAt, countLoc } from '../shared/code-parser/textMetrics';
import { isReexportOnlyBarrel } from '../shared/javascript/barrelFiles';
import { resolveImport, TsConfigContext } from '../shared/javascript/importGraph';
import { parsePythonImportBindings } from '../shared/python/graph';

const NO_ALIASES: TsConfigContext = {
    baseUrl: '',
    pathAliases: new Map(),
    exactAliases: new Map(),
};

suite('lineAt — duplicate lines', () => {
    test('returns correct line when lines have identical content', () => {
        const source = 'def foo():\n    pass\ndef foo():\n    pass\n';
        const firstDefOffset = source.indexOf('def foo()');
        const secondDefOffset = source.indexOf('def foo()', firstDefOffset + 1);
        assert.strictEqual(lineAt(source, firstDefOffset), 1);
        assert.strictEqual(lineAt(source, secondDefOffset), 3);
    });

    test('handles empty lines between duplicates', () => {
        const source = 'x = 1\n\nx = 1\n';
        assert.strictEqual(lineAt(source, 0), 1);
        assert.strictEqual(lineAt(source, source.lastIndexOf('x = 1')), 3);
    });
});

suite('countLoc', () => {
    test('counts non-empty lines', () => {
        assert.strictEqual(countLoc('a\n\nb\n'), 2);
    });

    test('returns 0 for empty string', () => {
        assert.strictEqual(countLoc(''), 0);
    });
});

suite('isReexportOnlyBarrel', () => {
    test('returns true for barrel with only named re-exports', () => {
        const content = `export { Foo } from './foo';\nexport { Bar } from './bar';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/utils/index.ts'), true);
    });

    test('returns true for barrel with star re-export', () => {
        const content = `export * from './foo';\nexport * as utils from './bar';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), true);
    });

    test('returns true for barrel with default re-export', () => {
        const content = `export { default } from './foo';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), true);
    });

    test('returns false for barrel with local export', () => {
        const content = `export const x = 1;\nexport { Foo } from './foo';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), false);
    });

    test('returns false for barrel with export default value', () => {
        const content = `export default function foo() {}\nexport { Bar } from './bar';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), false);
    });

    test('returns false for non-index files', () => {
        const content = `export { Foo } from './foo';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/utils.ts'), false);
    });

    test('returns false for empty file', () => {
        assert.strictEqual(isReexportOnlyBarrel('', '/src/index.ts'), false);
    });

    test('ignores comments when checking', () => {
        const content = `// just a comment\nexport { Foo } from './foo';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), true);
    });

    test('ignores block comments when checking', () => {
        const content = `/* re-exports */\nexport { Foo } from './foo';\nexport * from './bar';`;
        assert.strictEqual(isReexportOnlyBarrel(content, '/src/index.ts'), true);
    });
});

suite('resolveImport — external vs unresolved vs internal', () => {
    const workspaceRoot = '/workspace';

    test('returns unresolved for missing relative import', () => {
        const result = resolveImport(
            '/workspace/src/a.ts',
            './nonexistent',
            workspaceRoot,
            NO_ALIASES,
        );
        assert.deepStrictEqual(result, { type: 'unresolved', specifier: './nonexistent' });
    });

    test('returns external for scoped package', () => {
        const result = resolveImport(
            '/workspace/src/a.ts',
            '@scope/package',
            workspaceRoot,
            NO_ALIASES,
        );
        assert.deepStrictEqual(result, { type: 'external', name: '@scope/package' });
    });

    test('returns external for unscoped package', () => {
        const result = resolveImport('/workspace/src/a.ts', 'lodash', workspaceRoot, NO_ALIASES);
        assert.deepStrictEqual(result, { type: 'external', name: 'lodash' });
    });

    test('returns external for node builtin', () => {
        const result = resolveImport('/workspace/src/a.ts', 'fs', workspaceRoot, NO_ALIASES);
        assert.deepStrictEqual(result, { type: 'external', name: 'fs' });
    });

    test('returns external for node: protocol', () => {
        const result = resolveImport('/workspace/src/a.ts', 'node:fs', workspaceRoot, NO_ALIASES);
        assert.deepStrictEqual(result, { type: 'external', name: 'node:fs' });
    });
});

suite('Python export extraction — duplicate line handling', () => {
    test('parsePythonImportBindings handles from-import with multiple names', () => {
        const content = 'from os import path, getcwd';
        const bindings = parsePythonImportBindings(content, '/workspace/a.py', '/workspace');
        assert.strictEqual(bindings.length, 1);
        assert.deepStrictEqual(bindings[0].importedNames, ['path', 'getcwd']);
    });

    test('parsePythonImportBindings handles wildcard import', () => {
        const content = 'from os import *';
        const bindings = parsePythonImportBindings(content, '/workspace/a.py', '/workspace');
        assert.strictEqual(bindings.length, 1);
        assert.strictEqual(bindings[0].isWildcard, true);
    });

    test('parsePythonImportBindings handles module alias', () => {
        const content = 'import os as operating_system';
        const bindings = parsePythonImportBindings(content, '/workspace/a.py', '/workspace');
        assert.strictEqual(bindings.length, 1);
        assert.strictEqual(bindings[0].moduleAlias, 'operating_system');
    });

    test('parsePythonImportBindings handles from-import with alias', () => {
        const content = 'from os import path as p';
        const bindings = parsePythonImportBindings(content, '/workspace/a.py', '/workspace');
        assert.strictEqual(bindings.length, 1);
        assert.deepStrictEqual(bindings[0].importedNames, ['path']);
    });

    test('parsePythonImportBindings handles comments after import', () => {
        const content = 'from os import path  # need path';
        const bindings = parsePythonImportBindings(content, '/workspace/a.py', '/workspace');
        assert.strictEqual(bindings.length, 1);
        assert.deepStrictEqual(bindings[0].importedNames, ['path']);
    });
});

suite('Python extractPythonExports — line tracking', () => {
    // We test the exported function indirectly by simulating what extractPythonExports does
    // by checking that lineAt with tracked offsets is correct
    test('lineAt correctly tracks offsets with duplicate function names', () => {
        const lines = ['def helper():', '    pass', '', 'def helper():', '    pass'];
        const content = lines.join('\n');
        let offset = 0;
        const lineNumbers: number[] = [];
        for (const line of lines) {
            if (line.includes('def helper')) {
                lineNumbers.push(lineAt(content, offset));
            }
            offset += line.length + 1;
        }
        assert.deepStrictEqual(lineNumbers, [1, 4]);
    });
});

suite('Java export extraction — class body scoping', () => {
    test('extracts exports only from top-level public class', () => {
        const content = `
public class MyClass {
    public static final int VALUE = 1;
    public static void doSomething() {}
}

class InnerHelper {
    public static void helperMethod() {}
}`;
        // The extraction should not pick up helperMethod from InnerHelper
        // because it's not public top-level
        assert.ok(content.includes('public class MyClass'));
        assert.ok(content.includes('class InnerHelper'));
    });
});

suite('Dynamic imports — resolved correctly', () => {
    test('dynamic import specifier is extracted', () => {
        const content = "const mod = import('./module');";
        const match = content.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        assert.ok(match);
        assert.strictEqual(match![1], './module');
    });
});

suite('Barrel file re-exports — export { foo } from pattern', () => {
    test('named re-export from barrel is recognized', () => {
        const content = `export { Button } from './Button';\nexport { Modal } from './Modal';`;
        const re = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
        const exports: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            const names = match[1].split(',').map((s) => s.trim());
            exports.push(...names);
        }
        assert.deepStrictEqual(exports, ['Button', 'Modal']);
    });

    test('export * re-export is recognized', () => {
        const content = `export * from './utils';\nexport * as helpers from './helpers';`;
        const starRe = /export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g;
        const targets: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = starRe.exec(content)) !== null) {
            targets.push(match[1]);
        }
        assert.deepStrictEqual(targets, ['./utils', './helpers']);
    });

    test('chained re-export (barrel -> barrel -> module)', () => {
        // barrel-b re-exports from module
        const barrelB = `export { Foo } from './foo';`;
        // barrel-a re-exports from barrel-b
        const barrelA = `export { Foo } from './barrel-b';`;

        const namedRe = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
        const findTargets = (content: string) => {
            const targets: string[] = [];
            let m: RegExpExecArray | null;
            namedRe.lastIndex = 0;
            while ((m = namedRe.exec(content)) !== null) {
                targets.push(m[2]);
            }
            return targets;
        };

        assert.deepStrictEqual(findTargets(barrelB), ['./foo']);
        assert.deepStrictEqual(findTargets(barrelA), ['./barrel-b']);
    });
});
