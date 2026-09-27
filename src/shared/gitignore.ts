import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

export const findGitRoot = (startDir: string): string | null => {
    try {
        const root = execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
            encoding: 'utf-8',
        }).trim();
        return root.replace(/\\/g, '/');
    } catch {
        return null;
    }
};

export const isGitRepository = (startDir: string): boolean => {
    return findGitRoot(startDir) !== null;
};

export const listGitVisibleFiles = (folder: string): string[] | null => {
    const gitRoot = findGitRoot(folder);
    if (!gitRoot) {
        return null;
    }

    const files = new Set(lsFilesUnder(gitRoot, folder));
    for (const nested of findNestedGitRoots(folder, gitRoot)) {
        for (const filePath of lsFilesUnder(nested, folder)) {
            files.add(filePath);
        }
    }
    return [...files];
};

export const filterGitIgnoredPaths = (gitRoot: string, filePaths: string[]): string[] => {
    if (filePaths.length === 0) {
        return filePaths;
    }

    const normalizedRoot = path.resolve(gitRoot);
    const relPaths = filePaths.map((absPath) => toGitRelativePath(normalizedRoot, absPath));

    let ignoredRel = new Set<string>();
    try {
        const output = execFileSync('git', ['-C', normalizedRoot, 'check-ignore', '--stdin'], {
            input: relPaths.join('\n'),
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
        }).trim();

        if (output) {
            ignoredRel = new Set(output.split('\n').filter(Boolean));
        }
    } catch (error) {
        if (!isCheckIgnoreNoMatch(error)) {
            return filePaths;
        }
    }

    return filePaths.filter((_, index) => !ignoredRel.has(relPaths[index]));
};

const lsFilesUnder = (gitRoot: string, folder: string): string[] => {
    const normalizedRoot = path.resolve(gitRoot).replace(/\\/g, '/');
    const resolvedFolder = path.resolve(folder).replace(/\\/g, '/');
    const scope = path.relative(normalizedRoot, resolvedFolder).replace(/\\/g, '/');
    const scoped = scope.startsWith('..') ? '' : scope;

    try {
        const args = [
            '-C',
            normalizedRoot,
            'ls-files',
            '-z',
            '--cached',
            '--others',
            '--exclude-standard',
        ];
        if (scoped && scoped !== '.') {
            args.push('--', scoped);
        }
        const output = execFileSync('git', args, {
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
        });
        return output
            .split('\0')
            .filter(Boolean)
            .map((rel) => path.join(normalizedRoot, rel).replace(/\\/g, '/'));
    } catch {
        return [];
    }
};

const NESTED_GIT_SKIP = new Set(['node_modules', 'dist', 'build', '.git']);

const findNestedGitRoots = (folder: string, alreadyKnown: string): string[] => {
    const result: string[] = [];
    const known = path.resolve(alreadyKnown);
    const walk = (dir: string, depth: number) => {
        if (depth > 3) {
            return;
        }
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (
                    !entry.isDirectory() ||
                    entry.name.startsWith('.') ||
                    NESTED_GIT_SKIP.has(entry.name)
                ) {
                    continue;
                }
                const fullPath = path.join(dir, entry.name);
                if (existsSync(path.join(fullPath, '.git'))) {
                    if (path.resolve(fullPath) !== known) {
                        result.push(fullPath);
                    }
                    continue;
                }
                walk(fullPath, depth + 1);
            }
        } catch {
            // Skip unreadable dirs
        }
    };
    walk(path.resolve(folder), 0);
    return result;
};

const toGitRelativePath = (gitRoot: string, filePath: string): string => {
    const trailing = /[/\\]$/.test(filePath);
    const trimmed = trailing ? filePath.replace(/[/\\]+$/, '') : filePath;
    const rel = path.relative(gitRoot, trimmed).replace(/\\/g, '/');
    const base = rel || '.';
    return trailing && base !== '.' ? `${base}/` : base;
};

const isCheckIgnoreNoMatch = (error: unknown): boolean => {
    return (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status: number }).status === 1
    );
};
