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
/** hash, author date (author's own timezone, YYYY-MM-DD), mailmapped name/email, subject. */
const LOG_FORMAT = ['%H', '%ad', '%aN', '%aE', '%s'].join('%x1f') + '%x1e';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CommitRecord {
    hash: string;
    date: string;
    authorName: string;
    authorEmail: string;
    subject: string;
    /** Repo label relative to the opened folder. */
    repo: string;
}

interface RepoTarget {
    root: string;
    /** Path limit inside the repo ('' = whole repo). */
    scope: string;
    label: string;
}

interface RepoLogCacheEntry {
    head: string;
    commits: CommitRecord[];
}

/** Commit lists keyed by `root::scope`, reused while that repo's HEAD is unchanged. */
export type CommitLogCache = Map<string, RepoLogCacheEntry>;

export interface CommitHistory {
    /** Newest first per repo, deduplicated by hash across repos. */
    commits: CommitRecord[];
    repoCount: number;
    failedRepos: string[];
    currentUserEmail: string | null;
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

const parseLog = (output: string, repo: string): CommitRecord[] => {
    const commits: CommitRecord[] = [];
    for (const rawRecord of output.split(RECORD_SEP)) {
        const record = rawRecord.replace(/^\n+/, '');
        if (!record) {
            continue;
        }
        const [hash, date, authorName, authorEmail, ...subjectParts] = record.split(FIELD_SEP);
        if (!hash || !DATE_RE.test(date ?? '')) {
            continue;
        }
        commits.push({
            hash,
            date,
            authorName: authorName ?? '',
            authorEmail: authorEmail ?? '',
            subject: subjectParts.join(FIELD_SEP),
            repo,
        });
    }
    return commits;
};

const toLabel = (folder: string, root: string): string => {
    const rel = path.relative(folder, root).replace(/\\/g, '/');
    if (!rel) {
        return path.basename(folder);
    }
    return rel.startsWith('..') ? path.basename(root) : rel;
};

/** The repo containing the folder (path-limited to it) plus every repo nested inside. */
const discoverTargets = async (folder: string): Promise<RepoTarget[]> => {
    const scan = await scanFolderRespectingRepos(folder, {
        skipEntry: (name) => name.startsWith('.') || REPO_WALK_SKIP_DIRS.has(name),
    });
    const targets: RepoTarget[] = [];
    if (scan.containingRoot) {
        const scope = path.relative(scan.containingRoot, folder).replace(/\\/g, '/');
        targets.push({
            root: scan.containingRoot,
            scope: scope.startsWith('..') ? '' : scope,
            label: toLabel(folder, scan.containingRoot),
        });
    }
    for (const root of scan.nestedRepos) {
        targets.push({ root, scope: '', label: toLabel(folder, root) });
    }
    return targets;
};

const readRepoCommits = async (
    target: RepoTarget,
    cache: CommitLogCache | undefined,
): Promise<CommitRecord[]> => {
    const head = await readHead(target.root);
    if (!head) {
        return [];
    }
    const key = `${target.root}::${target.scope}`;
    const cached = cache?.get(key);
    if (cached?.head === head) {
        return cached.commits;
    }

    const args = ['log', '--date=short', `--format=${LOG_FORMAT}`, 'HEAD'];
    if (target.scope) {
        args.push('--', target.scope);
    }
    const commits = parseLog(await runGit(target.root, args), target.label);
    cache?.set(key, { head, commits });
    return commits;
};

const readUserEmail = async (cwd: string): Promise<string | null> => {
    try {
        return (await runGit(cwd, ['config', 'user.email'])).trim() || null;
    } catch {
        return null;
    }
};

/** Loads HEAD history for every repo under `folder` (one `git log` per changed repo). */
export const loadCommitHistory = async (
    folder: string,
    cache?: CommitLogCache,
): Promise<CommitHistory> => {
    const targets = await discoverTargets(folder);
    const failedRepos: string[] = [];

    const [perRepo, currentUserEmail] = await Promise.all([
        mapWithConcurrency(targets, REPO_CONCURRENCY, async (target) => {
            try {
                return await readRepoCommits(target, cache);
            } catch {
                failedRepos.push(target.label);
                return [];
            }
        }),
        readUserEmail(targets[0]?.root ?? folder),
    ]);

    if (cache) {
        const live = new Set(targets.map((target) => `${target.root}::${target.scope}`));
        for (const key of cache.keys()) {
            if (!live.has(key)) {
                cache.delete(key);
            }
        }
    }

    const seen = new Set<string>();
    const commits: CommitRecord[] = [];
    for (const list of perRepo) {
        for (const commit of list) {
            if (!seen.has(commit.hash)) {
                seen.add(commit.hash);
                commits.push(commit);
            }
        }
    }

    return { commits, repoCount: targets.length, failedRepos: failedRepos.sort(), currentUserEmail };
};

export interface HeatmapAuthor {
    key: string;
    name: string;
    email: string;
    count: number;
}

export interface HeatmapPayload {
    folderName: string;
    repoCount: number;
    totalCommits: number;
    today: string;
    minDate: string | null;
    /** Sorted: current git user first, then by commit count. */
    authors: HeatmapAuthor[];
    /** Lower-cased `git config user.email`, if any. */
    meKey: string | null;
    /** date -> flat [authorIndex, count, authorIndex, count, ...]. */
    days: Record<string, number[]>;
    failedRepos: string[];
}

export const authorKeyOf = (commit: Pick<CommitRecord, 'authorEmail' | 'authorName'>): string => {
    return (commit.authorEmail || commit.authorName).trim().toLowerCase();
};

export const localDateKey = (date = new Date()): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

export const buildHeatmapPayload = (
    history: CommitHistory,
    folderName: string,
    today = localDateKey(),
): HeatmapPayload => {
    const meKey = history.currentUserEmail?.trim().toLowerCase() || null;
    const byAuthor = new Map<string, HeatmapAuthor>();
    let minDate: string | null = null;

    for (const commit of history.commits) {
        const key = authorKeyOf(commit);
        const author = byAuthor.get(key);
        if (author) {
            author.count++;
        } else {
            // Newest commit first, so the latest spelling of the name wins.
            byAuthor.set(key, {
                key,
                name: commit.authorName,
                email: commit.authorEmail,
                count: 1,
            });
        }
        if (!minDate || commit.date < minDate) {
            minDate = commit.date;
        }
    }

    const authors = [...byAuthor.values()].sort(
        (a, b) =>
            Number(b.key === meKey) - Number(a.key === meKey) ||
            b.count - a.count ||
            a.name.localeCompare(b.name),
    );
    const indexOf = new Map(authors.map((author, index) => [author.key, index]));

    const perDay = new Map<string, Map<number, number>>();
    for (const commit of history.commits) {
        const index = indexOf.get(authorKeyOf(commit))!;
        const day = perDay.get(commit.date) ?? new Map<number, number>();
        day.set(index, (day.get(index) ?? 0) + 1);
        perDay.set(commit.date, day);
    }

    const days: Record<string, number[]> = {};
    for (const date of [...perDay.keys()].sort()) {
        days[date] = [...perDay.get(date)!.entries()].sort((a, b) => a[0] - b[0]).flat();
    }

    return {
        folderName,
        repoCount: history.repoCount,
        totalCommits: history.commits.length,
        today,
        minDate,
        authors,
        meKey,
        days,
        failedRepos: history.failedRepos,
    };
};
