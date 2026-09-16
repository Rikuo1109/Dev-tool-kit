import * as path from 'path';

export function normalizePath(value: string): string {
    return path.resolve(value).replace(/\\/g, '/');
}
