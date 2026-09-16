import fs from 'fs';

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
