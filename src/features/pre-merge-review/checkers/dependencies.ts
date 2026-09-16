import { execFile } from 'child_process';
import * as path from 'path';
import { ReviewIssue } from '../types';

const LOCKFILES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'poetry.lock',
    'Pipfile.lock',
]);

const HEAVY_DEPENDENCIES = new Set([
    'lodash',
    'moment',
    'jquery',
    'core-js',
    'rxjs',
    '@mui/material',
    'aws-sdk',
]);

export async function checkDependencyChanges(
    gitRoot: string,
    compareBranch: string,
    currentRef: string,
): Promise<ReviewIssue[]> {
    const mergeBase = (await runGit(gitRoot, ['merge-base', compareBranch, currentRef])).trim();

    const seen = new Set<string>();
    const items: ReviewIssue[] = [];

    for (const diffRange of [`${mergeBase}..${currentRef}`, `${mergeBase}..${compareBranch}`]) {
        items.push(...(await collectDependencyIssues(gitRoot, diffRange, seen)));
    }

    return items;
}

async function collectDependencyIssues(
    gitRoot: string,
    diffRange: string,
    seen: Set<string>,
): Promise<ReviewIssue[]> {
    const names = (await runGit(gitRoot, ['diff', '--name-only', diffRange]))
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const items: ReviewIssue[] = [];

    for (const relativePath of names) {
        const baseName = path.basename(relativePath);
        const absolutePath = path.join(gitRoot, relativePath);
        const dedupeKey = `${relativePath}:${diffRange}`;

        if (relativePath.endsWith('package.json')) {
            for (const issue of await checkPackageJson(
                relativePath,
                absolutePath,
                gitRoot,
                diffRange,
            )) {
                const key = `${issue.relativePath}:${issue.message}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                items.push(issue);
            }
            continue;
        }

        if (LOCKFILES.has(baseName)) {
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            items.push({
                relativePath,
                absolutePath,
                line: 1,
                severity: 'info',
                category: 'Dependencies',
                message: 'Lockfile modified — review dependency tree changes',
            });
        }
    }

    return items;
}

async function checkPackageJson(
    relativePath: string,
    absolutePath: string,
    gitRoot: string,
    diffRange: string,
): Promise<ReviewIssue[]> {
    const items: ReviewIssue[] = [];
    const patch = await runGit(gitRoot, ['diff', '-U0', diffRange, '--', relativePath]);

    const addedDeps = [...patch.matchAll(/^\+\s*"([^"]+)":/gm)]
        .map((match) => match[1])
        .filter((name) => !name.startsWith('@types/'));

    for (const dep of addedDeps) {
        items.push({
            relativePath,
            absolutePath,
            line: 1,
            severity: HEAVY_DEPENDENCIES.has(dep) ? 'warning' : 'info',
            category: 'Dependencies',
            message: HEAVY_DEPENDENCIES.has(dep)
                ? `New heavy dependency added: ${dep}`
                : `New dependency added: ${dep}`,
        });
    }

    if (addedDeps.length === 0 && patch.includes('+')) {
        items.push({
            relativePath,
            absolutePath,
            line: 1,
            severity: 'info',
            category: 'Dependencies',
            message: 'package.json modified',
        });
    }

    return items;
}

function runGit(gitRoot: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            'git',
            ['-C', gitRoot, ...args],
            {
                encoding: 'utf-8',
                maxBuffer: 64 * 1024 * 1024,
            },
            (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            },
        );
    });
}
