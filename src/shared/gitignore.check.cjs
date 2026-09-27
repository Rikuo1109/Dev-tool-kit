'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const output = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
);
const files = output.split('\0').filter(Boolean);

assert.ok(files.includes('package.json'), 'expected package.json in git-visible list');
assert.ok(
    files.every((rel) => !rel.split('/').includes('node_modules')),
    'git-visible list must not include node_modules',
);

console.log(`gitignore.check: ${files.length} files, no node_modules`);
