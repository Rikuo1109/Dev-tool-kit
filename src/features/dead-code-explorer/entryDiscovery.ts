import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXCLUDE_GLOB } from '../../shared/constants';
import { normalizePath } from '../../shared/fs';
import { parseWebpackLikeEntries } from './entryParse';

const QUOTED_SRC_RE = /['"]((?:\.\.?\/)?(?:src\/)?[^'"]+\.(?:tsx?|jsx?|mjs|cjs))['"]/g;

interface EntryDiscoveryResult {
    entries: string[];
    labels: Map<string, string>;
}

/** Discover webpack/vite/package entry seeds under workspaceRoot. */
export async function discoverBundlerEntries(
    workspaceFolder: vscode.WorkspaceFolder,
    workspaceRoot: string,
    extraGlobs: string[],
): Promise<EntryDiscoveryResult> {
    const entries = new Set<string>();
    const labels = new Map<string, string>();

    for (const pattern of extraGlobs) {
        const matches = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, pattern),
            EXCLUDE_GLOB,
        );
        for (const uri of matches) {
            const abs = normalizePath(uri.fsPath);
            entries.add(abs);
            labels.set(abs, `entry glob ${pattern}`);
        }
    }

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
                main?: string;
                module?: string;
                scripts?: Record<string, string>;
            };
            for (const field of [pkg.main, pkg.module]) {
                addResolved(workspaceRoot, field, entries, labels, 'package.json');
            }
            for (const script of Object.values(pkg.scripts ?? {})) {
                QUOTED_SRC_RE.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = QUOTED_SRC_RE.exec(script)) !== null) {
                    addResolved(workspaceRoot, match[1], entries, labels, 'package script');
                }
            }
        } catch {
            // ignore
        }
    }

    const configUris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(
            workspaceFolder,
            '**/{webpack,webpack.config,vite.config}*.{js,ts,cjs,mjs}',
        ),
        EXCLUDE_GLOB,
    );

    for (const uri of configUris) {
        let content: string;
        try {
            content = fs.readFileSync(uri.fsPath, 'utf-8');
        } catch {
            continue;
        }
        const configDir = path.dirname(uri.fsPath);
        parseWebpackLikeEntries(content, configDir, workspaceRoot, entries, labels);
    }

    for (const rel of ['src/index.js', 'src/index.tsx', 'src/mobile.js', 'src/mobile.tsx']) {
        addResolved(workspaceRoot, rel, entries, labels, 'convention');
    }

    return {
        entries: [...entries],
        labels,
    };
}

function addResolved(
    workspaceRoot: string,
    rel: string | undefined,
    entries: Set<string>,
    labels: Map<string, string>,
    label: string,
): void {
    if (!rel) {
        return;
    }
    const abs = resolveExisting(workspaceRoot, rel.replace(/^\.\//, ''));
    if (abs) {
        entries.add(abs);
        if (!labels.has(abs)) {
            labels.set(abs, label);
        }
    }
}

function resolveExisting(root: string, rel: string): string | null {
    const candidates = [
        path.join(root, rel),
        path.join(root, `${rel}.js`),
        path.join(root, `${rel}.ts`),
        path.join(root, `${rel}.tsx`),
        path.join(root, `${rel}.jsx`),
        path.join(root, rel, 'index.js'),
        path.join(root, rel, 'index.ts'),
        path.join(root, rel, 'index.tsx'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return normalizePath(candidate);
        }
    }
    return null;
}
