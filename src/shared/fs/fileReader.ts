import fs from 'fs';
import path from 'path';

export const readFileSafe = (filePath: string) => {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
};

export const createContentCache = (): ((absPath: string) => string) => {
    const cache = new Map<string, string>();
    return (absPath: string): string => {
        const cached = cache.get(absPath);
        if (cached !== undefined) {
            return cached;
        }
        const text = fs.readFileSync(absPath, 'utf-8');
        cache.set(absPath, text);
        return text;
    };
};

export const walkForFile = (
    dir: string,
    fileName: string,
    results: string[],
    depth: number,
    maxDepth: number,
) => {
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
};
