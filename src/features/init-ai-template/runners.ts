import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

export type WriteResult = 'created' | 'updated' | 'skipped';

const ensureDirectory = async (dirPath: string): Promise<void> => {
    await fs.promises.mkdir(dirPath, { recursive: true });
};

export const writeTextFile = async (
    absolutePath: string,
    content: string,
    overwrite: boolean,
): Promise<WriteResult> => {
    await ensureDirectory(path.dirname(absolutePath));

    if (fs.existsSync(absolutePath) && !overwrite) {
        return 'skipped';
    }

    const existed = fs.existsSync(absolutePath);
    await fs.promises.writeFile(absolutePath, content, 'utf-8');
    return existed ? 'updated' : 'created';
};

export const isGitRepository = (rootPath: string): boolean => {
    return fs.existsSync(path.join(rootPath, '.git'));
};

export const runGitNexusSetup = async (cwd: string, log: (line: string) => void): Promise<void> => {
    log('Running gitnexus setup (global MCP + skills)…');
    const { stdout, stderr } = await execFileAsync('npx', ['-y', 'gitnexus@latest', 'setup'], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
        env: process.env,
    });
    if (stdout.trim()) {
        log(stdout.trim());
    }
    if (stderr.trim()) {
        log(stderr.trim());
    }
};

export const runGitNexusAnalyze = async (
    cwd: string,
    log: (line: string) => void,
): Promise<void> => {
    log('Running gitnexus analyze (project index + skills)…');
    const { stdout, stderr } = await execFileAsync('npx', ['-y', 'gitnexus@latest', 'analyze'], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
        env: process.env,
    });
    if (stdout.trim()) {
        log(stdout.trim());
    }
    if (stderr.trim()) {
        log(stderr.trim());
    }
};

export const formatCommandError = (error: unknown): string => {
    if (error instanceof Error) {
        const execError = error as Error & { stderr?: string; stdout?: string };
        const parts = [error.message];
        if (execError.stderr?.trim()) {
            parts.push(execError.stderr.trim());
        } else if (execError.stdout?.trim()) {
            parts.push(execError.stdout.trim());
        }
        return parts.join('\n');
    }
    return String(error);
};
