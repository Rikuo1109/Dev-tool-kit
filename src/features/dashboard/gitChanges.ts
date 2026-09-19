import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface LineChangeStats {
    added: number;
    deleted: number;
    net: number;
}

export interface GitDayChange {
    date: string;
    added: number;
    deleted: number;
    net: number;
    isMonth?: boolean;
}

export interface UncommittedFile {
    relativePath: string;
    absolutePath: string;
    added: number;
    deleted: number;
    net: number;
}

export interface GitChangeStats {
    available: boolean;
    message?: string;
    days: GitDayChange[];
    today: LineChangeStats;
    /** Net line delta from staged (index) + unstaged (working tree) changes. */
    uncommittedNet: number;
    /** Files contributing to uncommittedNet, largest churn first. */
    uncommittedFiles: UncommittedFile[];
}

interface DailyBucket {
    added: number;
    deleted: number;
}

interface GitDailyStats {
    available: boolean;
    message?: string;
    byDate: Map<string, DailyBucket>;
    today: LineChangeStats;
    uncommittedNet: number;
    uncommittedFiles: UncommittedFile[];
}

export class GitChangeAnalyzer {
    static readonly HISTORY_DAYS = 120;
    static readonly RECENT_DAYS = 7;
    static readonly MONTH_COLUMNS = 3;
    static readonly UNCOMMITTED_FILE_LIMIT = 20;
    static readonly NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t/;
    static readonly NUMSTAT_FILE_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;
    static readonly EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);

    private readonly folder: string;
    private readonly displayRoot: string;
    private readonly gitRoot: string | null;
    private readonly scope: string;

    constructor(folder: string) {
        this.folder = folder;
        this.displayRoot = path.resolve(folder);
        this.gitRoot = this.findGitRoot(folder);
        this.scope = this.gitRoot
            ? path.relative(this.gitRoot, this.displayRoot).replace(/\\/g, '/')
            : '';
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    getAggregatedGitChangeStats(): {
        stats: GitChangeStats;
        subrepoCount: number;
    } {
        const main = this.collectGitDailyStats();
        const subrepos = this.findSubrepos();

        if (subrepos.length === 0) {
            return { stats: this.toChangeStats(main), subrepoCount: 0 };
        }

        const mergedByDate = new Map<string, DailyBucket>();
        this.mergeDailyBuckets(mergedByDate, main.byDate);

        const mergedFiles = new Map<string, UncommittedFile>();
        if (main.available) {
            this.mergeUncommittedFiles(mergedFiles, main.uncommittedFiles);
        }

        let todayAdded = main.available ? main.today.added : 0;
        let todayDeleted = main.available ? main.today.deleted : 0;
        let totalUncommitted = main.available ? main.uncommittedNet : 0;
        let anyAvailable = main.available;

        for (const subrepo of subrepos) {
            const daily = this.collectGitDailyStats(subrepo);
            if (!daily.available) {
                continue;
            }
            anyAvailable = true;
            this.mergeDailyBuckets(mergedByDate, daily.byDate);
            const remapped = daily.uncommittedFiles.map((file) => ({
                ...file,
                relativePath:
                    path.relative(this.displayRoot, file.absolutePath).replace(/\\/g, '/') ||
                    file.relativePath,
            }));
            this.mergeUncommittedFiles(mergedFiles, remapped);
            todayAdded += daily.today.added;
            todayDeleted += daily.today.deleted;
            totalUncommitted += daily.uncommittedNet;
        }

        return {
            stats: {
                available: anyAvailable,
                message: anyAvailable ? undefined : 'No git history available',
                days: this.buildMixedSeries(mergedByDate),
                today: GitChangeAnalyzer.toLineStats(todayAdded, todayDeleted),
                uncommittedNet: totalUncommitted,
                uncommittedFiles: this.rankUncommittedFiles([...mergedFiles.values()]),
            },
            subrepoCount: subrepos.length,
        };
    }

    static formatGitChartLabels(days: GitDayChange[]): string[] {
        return days.map((day) => {
            if (day.isMonth) {
                const [year, month] = day.date.split('-');
                return `${month}/${year}`;
            }
            return GitChangeAnalyzer.formatShortDate(day.date);
        });
    }

    // ─── Private: Git execution ───────────────────────────────────────────────

    private runGit(args: string[]): string {
        return execFileSync('git', ['-C', this.gitRoot!, ...args], {
            encoding: 'utf-8',
            maxBuffer: 32 * 1024 * 1024,
        });
    }

    // ─── Private: Daily stats ─────────────────────────────────────────────────

    private collectGitDailyStats(targetFolder?: string): GitDailyStats {
        const emptyToday = GitChangeAnalyzer.emptyLineStats();
        const emptyByDate = new Map<string, DailyBucket>();

        const folder = targetFolder ?? this.folder;
        const gitRoot = targetFolder ? this.findGitRoot(folder) : this.gitRoot;
        if (!gitRoot) {
            return {
                available: false,
                message: 'Not inside a git repository',
                byDate: emptyByDate,
                today: emptyToday,
                uncommittedNet: 0,
                uncommittedFiles: [],
            };
        }

        const resolvedFolder = path.resolve(folder);
        const scope = path.relative(gitRoot, resolvedFolder).replace(/\\/g, '/');

        try {
            const args = [
                'log',
                `--since=${GitChangeAnalyzer.HISTORY_DAYS} days ago`,
                '--format=%ad',
                '--date=short',
                '--numstat',
                '--no-renames',
            ];

            if (scope && scope !== '.') {
                args.push('--', scope);
            }

            const byDate = this.parseGitNumstat(
                execFileSync('git', ['-C', gitRoot, ...args], {
                    encoding: 'utf-8',
                    maxBuffer: 32 * 1024 * 1024,
                }),
            );
            const todayKey = GitChangeAnalyzer.localDateKey();
            const todayBucket = byDate.get(todayKey) ?? { added: 0, deleted: 0 };
            const uncommitted = this.getUncommittedChangesFor(gitRoot, scope, resolvedFolder);

            return {
                available: true,
                byDate,
                today: GitChangeAnalyzer.toLineStats(todayBucket.added, todayBucket.deleted),
                uncommittedNet: uncommitted.net,
                uncommittedFiles: uncommitted.files,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read git history';
            return {
                available: false,
                message,
                byDate: emptyByDate,
                today: emptyToday,
                uncommittedNet: 0,
                uncommittedFiles: [],
            };
        }
    }

    private parseGitNumstat(output: string): Map<string, DailyBucket> {
        const byDate = new Map<string, DailyBucket>();
        let currentDate: string | null = null;

        for (const rawLine of output.split('\n')) {
            const line = rawLine.trimEnd();
            if (!line) {
                continue;
            }

            if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
                currentDate = line;
                continue;
            }

            if (!currentDate) {
                continue;
            }

            const match = line.match(GitChangeAnalyzer.NUMSTAT_RE);
            if (!match) {
                continue;
            }

            const added = match[1] === '-' ? 0 : Number.parseInt(match[1], 10);
            const deleted = match[2] === '-' ? 0 : Number.parseInt(match[2], 10);
            if (Number.isNaN(added) || Number.isNaN(deleted)) {
                continue;
            }

            const bucket = byDate.get(currentDate) ?? { added: 0, deleted: 0 };
            bucket.added += added;
            bucket.deleted += deleted;
            byDate.set(currentDate, bucket);
        }

        return byDate;
    }

    private getUncommittedChangesFor(
        gitRoot: string,
        scope: string,
        displayRoot: string,
    ): { net: number; files: UncommittedFile[] } {
        const pathArgs = GitChangeAnalyzer.scopeArgs(scope);
        const byFile = new Map<string, UncommittedFile>();

        this.mergeNumstatIntoFiles(
            execFileSync('git', ['-C', gitRoot, 'diff', '--numstat', '--no-renames', ...pathArgs], {
                encoding: 'utf-8',
                maxBuffer: 32 * 1024 * 1024,
            }),
            gitRoot,
            displayRoot,
            byFile,
        );
        this.mergeNumstatIntoFiles(
            execFileSync(
                'git',
                ['-C', gitRoot, 'diff', '--cached', '--numstat', '--no-renames', ...pathArgs],
                { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
            ),
            gitRoot,
            displayRoot,
            byFile,
        );

        const files = [...byFile.values()].sort(
            (a, b) =>
                b.added + b.deleted - (a.added + a.deleted) ||
                a.relativePath.localeCompare(b.relativePath),
        );

        const net = files.reduce((sum, file) => sum + file.net, 0);
        return { net, files };
    }

    private mergeNumstatIntoFiles(
        output: string,
        gitRoot: string,
        displayRoot: string,
        into: Map<string, UncommittedFile>,
    ): void {
        const normalizedRoot = path.resolve(displayRoot);

        for (const rawLine of output.split('\n')) {
            const line = rawLine.trimEnd();
            if (!line) {
                continue;
            }

            const match = line.match(GitChangeAnalyzer.NUMSTAT_FILE_RE);
            if (!match || match[1] === '-' || match[2] === '-') {
                continue;
            }

            const added = Number.parseInt(match[1], 10);
            const deleted = Number.parseInt(match[2], 10);
            if (Number.isNaN(added) || Number.isNaN(deleted) || (added === 0 && deleted === 0)) {
                continue;
            }

            const absolutePath = path.resolve(gitRoot, match[3]).replace(/\\/g, '/');
            const relativePath =
                path.relative(normalizedRoot, absolutePath).replace(/\\/g, '/') ||
                path.basename(absolutePath);

            const existing = into.get(absolutePath);
            if (existing) {
                existing.added += added;
                existing.deleted += deleted;
                existing.net = existing.added - existing.deleted;
            } else {
                into.set(absolutePath, {
                    relativePath,
                    absolutePath,
                    added,
                    deleted,
                    net: added - deleted,
                });
            }
        }
    }

    // ─── Private: Time series ─────────────────────────────────────────────────

    private buildMixedSeries(byDate: Map<string, DailyBucket>, now = new Date()): GitDayChange[] {
        const result: GitDayChange[] = [];
        const cursor = new Date(now);
        cursor.setHours(0, 0, 0, 0);

        const recentStart = new Date(cursor);
        recentStart.setDate(cursor.getDate() - (GitChangeAnalyzer.RECENT_DAYS - 1));
        const recentStartKey = GitChangeAnalyzer.localDateKey(recentStart);

        for (let offset = GitChangeAnalyzer.MONTH_COLUMNS - 1; offset >= 0; offset--) {
            const monthDate = new Date(cursor.getFullYear(), cursor.getMonth() - offset, 1);
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

            let added = 0;
            let deleted = 0;
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            for (let day = 1; day <= daysInMonth; day++) {
                const key = `${monthKey}-${String(day).padStart(2, '0')}`;
                if (key >= recentStartKey) {
                    continue;
                }
                const bucket = byDate.get(key);
                if (!bucket) {
                    continue;
                }
                added += bucket.added;
                deleted += bucket.deleted;
            }

            result.push({
                date: monthKey,
                added,
                deleted,
                net: added - deleted,
                isMonth: true,
            });
        }

        for (let i = GitChangeAnalyzer.RECENT_DAYS - 1; i >= 0; i--) {
            const date = new Date(cursor);
            date.setDate(cursor.getDate() - i);
            const key = GitChangeAnalyzer.localDateKey(date);
            const bucket = byDate.get(key) ?? { added: 0, deleted: 0 };

            result.push({
                date: key,
                added: bucket.added,
                deleted: bucket.deleted,
                net: bucket.added - bucket.deleted,
            });
        }

        return result;
    }

    private mergeDailyBuckets(
        into: Map<string, DailyBucket>,
        from: Map<string, DailyBucket>,
    ): void {
        for (const [date, bucket] of from) {
            const merged = into.get(date) ?? { added: 0, deleted: 0 };
            merged.added += bucket.added;
            merged.deleted += bucket.deleted;
            into.set(date, merged);
        }
    }

    // ─── Private: Subrepos ────────────────────────────────────────────────────

    private findSubrepos(): string[] {
        const result: string[] = [];
        const resolved = path.resolve(this.folder);

        const walk = (dir: string, depth: number) => {
            if (depth > 3) {
                return;
            }

            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (entry.name.startsWith('.') || GitChangeAnalyzer.EXCLUDE_DIRS.has(entry.name)) {
                    continue;
                }

                const fullPath = path.join(dir, entry.name);
                const gitPath = path.join(fullPath, '.git');

                if (fs.existsSync(gitPath)) {
                    result.push(fullPath);
                    continue;
                }

                walk(fullPath, depth + 1);
            }
        };

        walk(resolved, 0);
        return result;
    }

    // ─── Private: Helpers ─────────────────────────────────────────────────────

    private findGitRoot(start: string): string | null {
        let dir = path.resolve(start);

        while (true) {
            if (fs.existsSync(path.join(dir, '.git'))) {
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return null;
            }
            dir = parent;
        }
    }

    private toChangeStats(daily: GitDailyStats): GitChangeStats {
        return {
            available: daily.available,
            message: daily.message,
            days: this.buildMixedSeries(daily.byDate),
            today: daily.today,
            uncommittedNet: daily.uncommittedNet,
            uncommittedFiles: this.rankUncommittedFiles(daily.uncommittedFiles),
        };
    }

    private rankUncommittedFiles(files: UncommittedFile[]): UncommittedFile[] {
        return [...files]
            .sort(
                (a, b) =>
                    b.added + b.deleted - (a.added + a.deleted) ||
                    a.relativePath.localeCompare(b.relativePath),
            )
            .slice(0, GitChangeAnalyzer.UNCOMMITTED_FILE_LIMIT);
    }

    private mergeUncommittedFiles(
        into: Map<string, UncommittedFile>,
        from: UncommittedFile[],
    ): void {
        for (const file of from) {
            const existing = into.get(file.absolutePath);
            if (existing) {
                existing.added += file.added;
                existing.deleted += file.deleted;
                existing.net = existing.added - existing.deleted;
            } else {
                into.set(file.absolutePath, { ...file });
            }
        }
    }

    private static emptyLineStats(): LineChangeStats {
        return { added: 0, deleted: 0, net: 0 };
    }

    private static toLineStats(added: number, deleted: number): LineChangeStats {
        return { added, deleted, net: added - deleted };
    }

    private static scopeArgs(scope: string): string[] {
        return scope && scope !== '.' ? ['--', scope] : [];
    }

    private static localDateKey(date = new Date()): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private static formatShortDate(isoDate: string): string {
        const [, month, day] = isoDate.split('-');
        return `${month}/${day}`;
    }
}
