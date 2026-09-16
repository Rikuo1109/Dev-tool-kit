import { stripComments } from '../../shared/code-parser';

export function exactNormalize(code: string, filePath?: string): string {
    return stripComments(code, filePath).replace(/\s+/g, ' ').trim();
}

export function structuralNormalize(code: string, filePath?: string): string {
    return stripComments(code, filePath)
        .replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|`(\\.|[^`\\])*`/g, 'STR')
        .replace(/\b\d+\.?\d*\b/g, 'NUM')
        .replace(/\b[a-zA-Z_$][\w$]*/g, 'ID')
        .replace(/\s+/g, ' ')
        .trim();
}
