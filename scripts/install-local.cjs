/**
 * Install the packaged VSIX into Cursor or VS Code.
 * Falls back with a clear message when neither CLI is on PATH.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(vsix)) {
    console.error(`Missing VSIX: ${vsix}`);
    console.error('Run `yarn vsix` first.');
    process.exit(1);
}

function resolveCli(name) {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(finder, [name], { encoding: 'utf8' });
    if (result.status !== 0) {
        return null;
    }
    return result.stdout.trim().split(/\r?\n/).find(Boolean) ?? null;
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
