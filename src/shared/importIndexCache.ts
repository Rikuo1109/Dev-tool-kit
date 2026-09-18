import { ImportIndex } from './javascript/importGraph';

const cache = new Map<string, { index: ImportIndex; timestamp: number }>();
const TTL_MS = 5 * 60 * 1000;

export const getCachedImportIndex = (workspaceRoot: string): ImportIndex | undefined => {
    const entry = cache.get(workspaceRoot);
    if (!entry) {
        return undefined;
    }
    if (Date.now() - entry.timestamp > TTL_MS) {
        cache.delete(workspaceRoot);
        return undefined;
    }
    return entry.index;
};

export const setCachedImportIndex = (workspaceRoot: string, index: ImportIndex): void => {
    cache.set(workspaceRoot, { index, timestamp: Date.now() });
};

export const invalidateImportIndex = (workspaceRoot: string): void => {
    cache.delete(workspaceRoot);
};

export const invalidateAllImportIndices = (): void => {
    cache.clear();
};
