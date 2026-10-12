import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { mapWithConcurrency } from '../../shared/async';
import { REPO_WALK_SKIP_DIRS, scanFolderRespectingRepos } from '../../shared/gitignore';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const REPO_CONCURRENCY = 4;
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
/** One record per commit: hash + author email, followed by its `--numstat` lines. */
const LOG_FORMAT = '%x1e%H%x1f%aE';
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

export interface FileChurn {
    commits: number;
    linesChanged: number;
    authors: Set<string>;
}

interface RepoTarget {
    root: string;
    /** Path limit inside the repo ('' = whole repo). */
    scope: string;
}

interface ChurnCacheEntry {
    head: string;
    churn: Map<string, FileChurn>;
}

/** Per-repo churn keyed by `root::scope::months::day`, reused while HEAD is unchanged. */
export type ChurnCache = Map<string, ChurnCacheEntry>;

export interface ChurnResult {
    /** Absolute POSIX path -> churn, merged across repos. */
    files: Map<string, FileChurn>;
    repoCount: number;
    failedRepos: string[];
}

const runGit = async (cwd: string, args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync(
        'git',
        ['-c', 'log.showSignature=false', '-C', cwd, ...args],
        { encoding: 'utf-8', maxBuffer: GIT_MAX_BUFFER },
    );
    return stdout;
};

const readHead = async (root: string): Promise<string | null> => {
    try {
        return (await runGit(root, ['rev-parse', 'HEAD'])).trim() || null;
    } catch {
        return null; // Unborn branch: no commits yet.
    }
};

/**
 * Maps a `--numstat` path to the post-rename path:
 * `old => new` → `new`, `src/{a => b}/x.ts` → `src/b/x.ts`, `src/{ => lib}/x.ts` → `src/lib/x.ts`.
 */
export const resolveRenamedPath = (raw: string): string => {
    const braced = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    if (braced) {
        const [, prefix, , renamed, suffix] = braced;
        return `${prefix}${renamed}${suffix}`.replace(/\/{2,}/g, '/');
    }
    const plain = raw.indexOf(' => ');
    return plain >= 0 ? raw.slice(plain + 4) : raw;
};

/** Parses `git log --numstat` output (see LOG_FORMAT) into churn keyed by repo-relative path. */
export const parseChurnLog = (output: string): Map<string, FileChurn> => {
    const churn = new Map<string, FileChurn>();
    for (const record of output.split(RECORD_SEP)) {
        const lines = record.split('\n');
        const [hash, email] = (lines[0] ?? '').split(FIELD_SEP);
        if (!hash) {
            continue;
        }
        for (const line of lines.slice(1)) {
            const match = line.match(NUMSTAT_RE);
            if (!match) {
                continue;
            }
            const filePath = resolveRenamedPath(match[3]);
            const added = match[1] === '-' ? 0 : Number(match[1]);
            const deleted = match[2] === '-' ? 0 : Number(match[2]);
            const entry = churn.get(filePath) ?? { commits: 0, linesChanged: 0, authors: new Set() };
            entry.commits++;
            entry.linesChanged += added + deleted;
            if (email) {
                entry.authors.add(email.toLowerCase());
            }
            churn.set(filePath, entry);
        }
    }
    return churn;
};

/** The repo containing the folder (path-limited to it) plus every repo nested inside. */
const discoverTargets = async (folder: string): Promise<RepoTarget[]> => {
    const scan = await scanFolderRespectingRepos(folder, {
        skipEntry: (name) => name.startsWith('.') || REPO_WALK_SKIP_DIRS.has(name),
    });
    const targets: RepoTarget[] = [];
    if (scan.containingRoot) {
        const scope = path.relative(scan.containingRoot, folder).replace(/\\/g, '/');
        targets.push({ root: scan.containingRoot, scope: scope.startsWith('..') ? '' : scope });
    }
    for (const root of scan.nestedRepos) {
        targets.push({ root, scope: '' });
    }
    return targets;
};

const localDayKey = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};

const readRepoChurn = async (
    target: RepoTarget,
    months: number,
    cache: ChurnCache | undefined,
): Promise<Map<string, FileChurn>> => {
    const head = await readHead(target.root);
    if (!head) {
        return new Map();
    }
    // The `--since` window moves with the calendar, so the day is part of the key.
    const key = `${target.root}::${target.scope}::${months}::${localDayKey()}`;
    const cached = cache?.get(key);
    if (cached?.head === head) {
        return cached.churn;
    }

    const args = [
        'log',
        `--since=${months}.months`,
        '--no-merges',
        `--format=${LOG_FORMAT}`,
        '--numstat',
        'HEAD',
    ];
    if (target.scope) {
        args.push('--', target.scope);
    }
    const churn = parseChurnLog(await runGit(target.root, args));
    cache?.set(key, { head, churn });
    return churn;
};

/** Collects per-file commit counts, changed lines and authors over the last `months`. */
export const loadChurn = async (
    folder: string,
    months: number,
    cache?: ChurnCache,
): Promise<ChurnResult> => {
    const targets = await discoverTargets(folder);
    const failedRepos: string[] = [];

    const perRepo = await mapWithConcurrency(targets, REPO_CONCURRENCY, async (target) => {
        try {
            return { target, churn: await readRepoChurn(target, months, cache) };
        } catch {
            failedRepos.push(path.basename(target.root));
            return { target, churn: new Map<string, FileChurn>() };
        }
    });

    const files = new Map<string, FileChurn>();
    for (const { target, churn } of perRepo) {
        const root = target.root.replace(/\\/g, '/');
        for (const [rel, entry] of churn) {
            const absolute = path.posix.join(root, rel);
            const existing = files.get(absolute);
            if (!existing) {
                files.set(absolute, entry);
                continue;
            }
            // Same file reached through two repos (e.g. a nested repo also scanned by its parent).
            files.set(absolute, {
                commits: Math.max(existing.commits, entry.commits),
                linesChanged: Math.max(existing.linesChanged, entry.linesChanged),
                authors: new Set([...existing.authors, ...entry.authors]),
            });
        }
    }

    return { files, repoCount: targets.length, failedRepos: failedRepos.sort() };
};
