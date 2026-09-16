export type SourceLanguage = 'javascript' | 'python' | 'java' | 'unknown';

export function getSourceLanguage(filePath: string): SourceLanguage {
    if (/\.(tsx?|jsx?|mjs|cjs|vue)$/i.test(filePath)) {
        return 'javascript';
    }
    if (/\.py$/i.test(filePath)) {
        return 'python';
    }
    if (/\.java$/i.test(filePath)) {
        return 'java';
    }
    return 'unknown';
}

export function isJavaScriptSource(filePath: string): boolean {
    return getSourceLanguage(filePath) === 'javascript';
}
