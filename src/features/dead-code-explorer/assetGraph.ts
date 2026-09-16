import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXCLUDE_GLOB } from '../../shared/constants';
import { ImportIndex, normalizePath } from '../../shared/javascript/importGraph';
import { isAssetReferenced } from './assetMatch';

const COPY_FROM_RE = /from\s*:\s*['"]([^'"]+)['"]/g;
const PUBLIC_URL_RE =
    /['"`](\/(?:service-worker|firebase-messaging-sw)[^'"`]*|\/assets\/[^'"`]+|[^'"`]*tinymce[^'"`]*)['"`]/gi;
const SW_REGISTER_RE = /serviceWorker\.register\s*\(\s*['"`]([^'"`]+)['"`]/g;
const SCRIPT_SRC_RE = /<(?:script|link)[^>]+(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi;
const IMPORT_SCRIPTS_RE = /importScripts\s*\(\s*['"]([^'"]+)['"]/g;

export interface AssetGraph {
    /** Absolute paths known to be runtime/public assets. */
    aliveAssets: Set<string>;
    /** Relative path fragments referenced (for fuzzy match). */
    urlFragments: Set<string>;
}

/** Build runtime/public asset graph from webpack copy patterns + string refs. */
export async function buildAssetGraph(
    workspaceFolder: vscode.WorkspaceFolder,
    workspaceRoot: string,
    index: ImportIndex,
): Promise<AssetGraph> {
    const aliveAssets = new Set<string>();
    const urlFragments = new Set<string>();

    const configUris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(
            workspaceFolder,
            '**/{webpack,webpack.config,vite.config,copy-webpack}*.{js,ts,cjs,mjs}',
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
        COPY_FROM_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = COPY_FROM_RE.exec(content)) !== null) {
            const from = match[1].replace(/\\/g, '/');
            urlFragments.add(from.replace(/^\.\//, ''));
            const abs = path.resolve(path.dirname(uri.fsPath), from);
            markTreeIfExists(abs, aliveAssets);
            // also try workspace-relative
            markTreeIfExists(path.join(workspaceRoot, from), aliveAssets);
        }
    }

    for (const filePath of index.files) {
        const content = index.getContent(filePath);
        collectUrlFragments(content, urlFragments);
    }

    // HTML in public/
    const htmlUris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, 'public/**/*.{html,htm}'),
        EXCLUDE_GLOB,
    );
    for (const uri of htmlUris) {
        try {
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            collectUrlFragments(content, urlFragments);
            SCRIPT_SRC_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = SCRIPT_SRC_RE.exec(content)) !== null) {
                resolvePublicRef(workspaceRoot, match[1], aliveAssets, urlFragments);
            }
        } catch {
            // skip
        }
    }

    // Map URL fragments back onto public/ files known to the index or filesystem
    for (const filePath of index.files) {
        const rel = index.relativePath(filePath).replace(/\\/g, '/');
        if (isAssetReferenced(rel, urlFragments)) {
            aliveAssets.add(filePath);
        }
    }

    // Explicit public SW / messaging files by convention
    for (const rel of ['public/service-worker.js', 'public/firebase-messaging-sw.js']) {
        const abs = normalizePath(path.join(workspaceRoot, rel));
        if (fs.existsSync(abs)) {
            aliveAssets.add(abs);
        }
    }

    return { aliveAssets, urlFragments };
}

function collectUrlFragments(content: string, urlFragments: Set<string>): void {
    for (const re of [PUBLIC_URL_RE, SW_REGISTER_RE, IMPORT_SCRIPTS_RE]) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            const raw = match[1].replace(/\\/g, '/');
            urlFragments.add(raw.replace(/^\//, ''));
            urlFragments.add(raw);
            if (/tinymce/i.test(raw)) {
                urlFragments.add('tinymce');
            }
        }
    }
}

function resolvePublicRef(
    workspaceRoot: string,
    ref: string,
    aliveAssets: Set<string>,
    urlFragments: Set<string>,
): void {
    const cleaned = ref.replace(/^\//, '').replace(/^\.\//, '');
    urlFragments.add(cleaned);
    const candidates = [
        path.join(workspaceRoot, 'public', cleaned),
        path.join(workspaceRoot, cleaned),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            aliveAssets.add(normalizePath(candidate));
        }
    }
}

function markTreeIfExists(absPath: string, aliveAssets: Set<string>): void {
    if (!fs.existsSync(absPath)) {
        return;
    }
    const stat = fs.statSync(absPath);
    if (stat.isFile()) {
        aliveAssets.add(normalizePath(absPath));
        return;
    }
    if (!stat.isDirectory()) {
        return;
    }
    // ponytail: ceiling — shallow mark dir itself; files matched via fragment/index walk
    aliveAssets.add(normalizePath(absPath));
}
