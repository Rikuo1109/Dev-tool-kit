import path from 'path';

export const normalizePath = (value: string) => {
    return path.resolve(value).replace(/\\/g, '/');
};

export const toRelativePath = (filePath: string, workspaceRoot: string) => {
    const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    return rel || path.basename(filePath);
};

export const isPathInsideFolder = (filePath: string, folderPath: string) => {
    const file = normalizePath(filePath);
    const folder = normalizePath(folderPath).replace(/\/$/, '');
    return file === folder || file.startsWith(`${folder}/`);
};
