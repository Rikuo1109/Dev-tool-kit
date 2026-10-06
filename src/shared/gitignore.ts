import { execFile, execFileSync } from 'child_process';
import { Dirent, existsSync, promises as fsp } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createLimiter, mapWithConcurrency } from './async';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const NESTED_REPO_CONCURRENCY = 4;

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

export interface GitVisibleListing {
    /** Root of the repo that was listed, expressed through the folder path as given. */
    gitRoot: string;
    /** Tracked + untracked-not-ignored files (absolute, `/`-separated), deduplicated. */
    files: string[];
    /** Nested repos (any nesting level) whose files are included; excludes the containing repo. */
    nestedRoots: string[];
    /** False when `git ls-files` failed for the top-level repo (e.g. broken `.git`). */
    ok: boolean;
}

const toPosix = (value: string): string => path.resolve(value).replace(/\\/g, '/');

const runGit = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, {
        encoding: 'utf-8',
        maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
};

export const findGitRootAsync = async (startDir: string): Promise<string | null> => {
    try {
        const root = (await runGit(['-C', startDir, 'rev-parse', '--show-toplevel'])).trim();
        return root ? root.replace(/\\/g, '/') : null;
    } catch {
        return null;
    }
};

/** Files tracked or untracked-not-ignored under `folder`, including nested repos. `null` outside git. */
export const listGitVisibleFiles = async (folder: string): Promise<string[] | null> => {
    return (await listGitVisibleFilesDetailed(folder))?.files ?? null;
};

export const listGitVisibleFilesDetailed = async (
    folder: string,
): Promise<GitVisibleListing | null> => {
    const gitRoot = await findGitRootAsync(folder);
    return gitRoot ? collectRepoTree(await toFolderNamespace(gitRoot, folder), folder) : null;
};

/**
 * git prints the repo root as a real path; re-express it through `folder` as given so scope and
 * nested-repo paths line up when the folder path crosses a symlink (e.g. /tmp → /private/tmp).
 */
const toFolderNamespace = async (gitRoot: string, folder: string): Promise<string> => {
    try {
        const [realRoot, realFolder] = await Promise.all([fsp.realpath(gitRoot), fsp.realpath(folder)]);
        const up = path.relative(realFolder, realRoot);
        const isAncestor = up.split(path.sep).every((segment) => segment === '..' || segment === '');
        return isAncestor ? toPosix(path.resolve(folder, up)) : gitRoot;
    } catch {
        return gitRoot;
    }
};

/** Same as `listGitVisibleFilesDetailed` for a directory already known to hold a `.git` entry. */
export const listRepoTreeFiles = (repoRoot: string): Promise<GitVisibleListing> => {
    return collectRepoTree(repoRoot, repoRoot);
};

/**
 * Lists `folder` through `gitRoot`, then recurses into nested repos found three ways:
 * untracked nested repos reported by git as `dir/`, initialized submodules, and `.git`
 * dirs within three levels (catches nested repos the outer repo ignores).
 */
const collectRepoTree = async (gitRoot: string, folder: string): Promise<GitVisibleListing> => {
    const seen = new Set<string>([toPosix(gitRoot)]);

    interface VisitResult {
        files: string[];
        roots: string[];
    }

    // Results are assembled in discovery order (not completion order) so output is deterministic.
    const visit = async (repoRoot: string, scopeFolder: string): Promise<VisitResult | null> => {
        const listing = await lsFilesUnder(repoRoot, scopeFolder);
        if (!listing) {
            return null;
        }

        const scanned = await findNestedGitRoots(scopeFolder);
        const candidates = [...listing.nestedRepoDirs, ...scanned].map(toPosix).filter((root) => {
            if (seen.has(root) || !existsSync(path.join(root, '.git'))) {
                return false;
            }
            seen.add(root);
            return true;
        });

        const children = await mapWithConcurrency(
            candidates,
            NESTED_REPO_CONCURRENCY,
            (root) => visit(root, root),
        );

        const files = [...listing.files];
        const roots = [...candidates];
        for (const child of children) {
            if (child) {
                files.push(...child.files);
                roots.push(...child.roots);
            }
        }
        return { files, roots: [...new Set(roots)] };
    };

    const result = await visit(gitRoot, folder);
    if (!result) {
        return { gitRoot, files: [], nestedRoots: [], ok: false };
    }

    // Drop duplicates and gitlink entries (submodule roots listed as tracked paths).
    const files = [...new Set(result.files)].filter((filePath) => !seen.has(filePath));
    // Child roots are listed after their parent's candidates; keep first occurrence order.
    const nestedRoots = [...new Set(result.roots)];
    return { gitRoot, files, nestedRoots, ok: true };
};

/** Directories the repo-aware walk never enters outside git (same as the dashboard's walk). */
export const REPO_WALK_SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.gitnexus']);

const WALK_READDIR_CONCURRENCY = 16;
const WALK_REPO_CONCURRENCY = 4;

export interface RepoAwareScanOptions {
    /** Skip rule for entries (files and dirs) met while walking outside any repo. */
    skipEntry: (name: string) => boolean;
    /** Filter for files that come from git listings. */
    keepRepoFile?: (filePath: string) => boolean;
}

export interface RepoAwareScan {
    /** Files in deterministic depth-first order. */
    files: string[];
    /** Repos inside the folder (any nesting level), excluding `containingRoot`. */
    nestedRepos: string[];
    /** Repo that contains the folder itself, or `null` when the folder is outside git. */
    containingRoot: string | null;
}

/**
 * Inside a repo: git-visible listing (incl. nested repos). Outside: depth-first disk walk with
 * `skipEntry`; a directory holding `.git` is not walked, its git-visible listing replaces it.
 */
export const scanFolderRespectingRepos = async (
    folder: string,
    options: RepoAwareScanOptions,
): Promise<RepoAwareScan> => {
    const keep = options.keepRepoFile ?? (() => true);
    const listing = await listGitVisibleFilesDetailed(folder);
    if (listing) {
        return {
            files: listing.files.filter(keep),
            nestedRepos: listing.nestedRoots,
            containingRoot: listing.gitRoot,
        };
    }

    const readdirLimit = createLimiter(WALK_READDIR_CONCURRENCY);
    const repoLimit = createLimiter(WALK_REPO_CONCURRENCY);
    const empty = (): Omit<RepoAwareScan, 'containingRoot'> => ({ files: [], nestedRepos: [] });

    const walk = async (
        dir: string,
        detectRepo: boolean,
    ): Promise<Omit<RepoAwareScan, 'containingRoot'>> => {
        let entries: Dirent[];
        try {
            entries = await readdirLimit(() => fsp.readdir(dir, { withFileTypes: true }));
        } catch {
            return empty(); // Skip unreadable dirs
        }

        if (detectRepo && entries.some((entry) => entry.name === '.git')) {
            const repo = await repoLimit(() => listRepoTreeFiles(dir));
            if (repo.ok) {
                return {
                    files: repo.files.filter(keep),
                    nestedRepos: [dir.replace(/\\/g, '/'), ...repo.nestedRoots],
                };
            }
            // Broken repo (git cannot list it): fall back to walking it like a plain folder.
        }

        const nested = await Promise.all(
            entries.map(async (entry): Promise<Omit<RepoAwareScan, 'containingRoot'>> => {
                if (options.skipEntry(entry.name)) {
                    return empty();
                }
                const fullPath = path.join(dir, entry.name);
                return entry.isDirectory()
                    ? walk(fullPath, true)
                    : { files: [fullPath], nestedRepos: [] };
            }),
        );
        return {
            files: nested.flatMap((part) => part.files),
            nestedRepos: nested.flatMap((part) => part.nestedRepos),
        };
    };

    // The root itself is known not to be inside a repo (rev-parse failed), so only detect below it.
    return { ...(await walk(folder, false)), containingRoot: null };
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

interface LsFilesResult {
    files: string[];
    /** Untracked nested repos (git prints them as `dir/`) and initialized submodules. */
    nestedRepoDirs: string[];
}

const lsFilesUnder = async (gitRoot: string, folder: string): Promise<LsFilesResult | null> => {
    const normalizedRoot = toPosix(gitRoot);
    const scope = path.relative(normalizedRoot, toPosix(folder)).replace(/\\/g, '/');
    const scoped = scope.startsWith('..') ? '' : scope;
    const pathArgs = scoped && scoped !== '.' ? ['--', scoped] : [];

    try {
        const output = await runGit([
            '-C',
            normalizedRoot,
            'ls-files',
            '-z',
            '--cached',
            '--others',
            '--exclude-standard',
            ...pathArgs,
        ]);
        const files: string[] = [];
        const nestedRepoDirs: string[] = [];
        for (const rel of output.split('\0')) {
            if (!rel) {
                continue;
            }
            const absPath = path.join(normalizedRoot, rel).replace(/\\/g, '/');
            if (rel.endsWith('/')) {
                nestedRepoDirs.push(absPath.replace(/\/+$/, ''));
            } else {
                files.push(absPath);
            }
        }
        nestedRepoDirs.push(...(await listSubmodules(normalizedRoot, pathArgs)));
        return { files, nestedRepoDirs };
    } catch {
        return null;
    }
};

const listSubmodules = async (gitRoot: string, pathArgs: string[]): Promise<string[]> => {
    if (!existsSync(path.join(gitRoot, '.gitmodules'))) {
        return [];
    }
    try {
        const output = await runGit(['-C', gitRoot, 'ls-files', '-s', '-z', ...pathArgs]);
        return output
            .split('\0')
            .filter((line) => line.startsWith('160000 '))
            .map((line) => path.join(gitRoot, line.slice(line.indexOf('\t') + 1)).replace(/\\/g, '/'));
    } catch {
        return [];
    }
};

const NESTED_GIT_SKIP = new Set(['node_modules', 'dist', 'build', '.git']);
const NESTED_GIT_MAX_DEPTH = 3;

/** `.git` holders within three levels of `folder`; does not descend into the repos it finds. */
const findNestedGitRoots = async (folder: string): Promise<string[]> => {
    const result: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > NESTED_GIT_MAX_DEPTH) {
            return;
        }
        let entries: Dirent[];
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return; // Skip unreadable dirs
        }
        const subdirs = entries.filter(
            (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                !NESTED_GIT_SKIP.has(entry.name),
        );
        for (const entry of subdirs) {
            const fullPath = path.join(dir, entry.name);
            if (existsSync(path.join(fullPath, '.git'))) {
                result.push(fullPath);
                continue;
            }
            await walk(fullPath, depth + 1);
        }
    };
    await walk(path.resolve(folder), 0);
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
