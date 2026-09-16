import * as fs from 'fs';
import * as path from 'path';
import { readFileSafe } from '../fs';
import { resolvePythonModule } from './graph';

const SCRIPT_SECTION_RE = /\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/g;
const SCRIPT_ENTRY_RE = /^\s*[\w.-]+\s*=\s*["']([\w.]+):[\w.]+["']/gm;

export function discoverPythonEntryPoints(workspaceRoot: string): string[] {
    const entries = new Set<string>();

    for (const pyprojectPath of findPyprojectFiles(workspaceRoot)) {
        const content = readFileSafe(pyprojectPath);
        for (const moduleRef of parseScriptModules(content)) {
            const resolved = resolvePythonModule(pyprojectPath, moduleRef, workspaceRoot);
            if (resolved) {
                entries.add(resolved);
            }
        }
    }

    for (const filePath of findPythonFilesWithMainGuard(workspaceRoot)) {
        entries.add(filePath);
    }

    return [...entries];
}

function parseScriptModules(content: string): string[] {
    const modules = new Set<string>();

    SCRIPT_SECTION_RE.lastIndex = 0;
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = SCRIPT_SECTION_RE.exec(content)) !== null) {
        const section = sectionMatch[1];
        SCRIPT_ENTRY_RE.lastIndex = 0;
        let entryMatch: RegExpExecArray | null;
        while ((entryMatch = SCRIPT_ENTRY_RE.exec(section)) !== null) {
            modules.add(entryMatch[1]);
        }
    }

    return [...modules];
}

function findPyprojectFiles(workspaceRoot: string): string[] {
    const results: string[] = [];
    walkForFile(workspaceRoot, 'pyproject.toml', results, 0, 4);
    return results;
}

function findPythonFilesWithMainGuard(workspaceRoot: string): string[] {
    const results: string[] = [];
    walkForPythonFiles(workspaceRoot, results, 0, 6);
    return results.filter((filePath) =>
        /if\s+__name__\s*==\s*['"]__main__['"]/.test(readFileSafe(filePath)),
    );
}

function walkForPythonFiles(dir: string, results: string[], depth: number, maxDepth: number): void {
    if (depth > maxDepth) {
        return;
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === '__pycache__'
        ) {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.py')) {
            results.push(fullPath);
            continue;
        }

        if (entry.isDirectory()) {
            walkForPythonFiles(fullPath, results, depth + 1, maxDepth);
        }
    }
}

function walkForFile(
    dir: string,
    fileName: string,
    results: string[],
    depth: number,
    maxDepth: number,
): void {
    if (depth > maxDepth) {
        return;
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
            results.push(fullPath);
            continue;
        }

        if (entry.isDirectory()) {
            walkForFile(fullPath, fileName, results, depth + 1, maxDepth);
        }
    }
}
