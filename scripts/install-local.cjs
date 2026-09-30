/**
 * Install the packaged VSIX into Cursor or VS Code.
 * Falls back with a clear message when neither CLI is on PATH.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** `where` lists the extensionless shim first. CreateProcess cannot run it. */
const pickWindowsCli = (candidates, exists) => {
    const runnable = candidates.find((candidate) => /\.(cmd|exe|bat)$/i.test(candidate));
    if (runnable) {
        return runnable;
    }
    const shim = candidates[0];
    if (shim && exists(`${shim}.cmd`)) {
        return `${shim}.cmd`;
    }
    return null;
};

const resolveCli = (name) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(finder, [name], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) {
        return null;
    }
    const candidates = result.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (process.platform === 'win32') {
        return pickWindowsCli(candidates, (file) => fs.existsSync(file));
    }
    return candidates[0] ?? null;
};

const pickedCmd = pickWindowsCli(
    ['C:\\VS Code\\bin\\code', 'C:\\VS Code\\bin\\code.cmd'],
    () => false,
);
const pickedSibling = pickWindowsCli(['C:\\VS Code\\bin\\code'], (file) => file.endsWith('.cmd'));
if (pickedCmd !== 'C:\\VS Code\\bin\\code.cmd' || pickedSibling !== 'C:\\VS Code\\bin\\code.cmd') {
    throw new Error('pickWindowsCli self-check failed');
}

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(vsix)) {
    console.error(`Missing VSIX: ${vsix}`);
    console.error('Run `yarn vsix` first.');
    process.exit(1);
}

const cli = resolveCli('cursor') ?? resolveCli('code');
if (!cli) {
    console.error('Neither `cursor` nor `code` CLI found in PATH.');
    console.error(`VSIX is ready: ${vsix}`);
    console.error('Install manually: Command Palette → "Extensions: Install from VSIX…"');
    console.error(
        'Or add the Cursor/VS Code shell command to PATH, then re-run `yarn install:local`.',
    );
    process.exit(1);
}

console.log(`Installing with ${cli}`);
execFileSync(cli, ['--install-extension', vsix, '--force'], {
    stdio: 'inherit',
});
