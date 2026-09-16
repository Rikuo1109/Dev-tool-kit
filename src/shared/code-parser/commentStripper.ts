export const stripComments = (code: string, filePath?: string): string => {
    if (filePath?.endsWith('.py')) {
        return code
            .replace(/"""[\s\S]*?"""/g, '')
            .replace(/'''[\s\S]*?'''/g, '')
            .replace(/#.*$/gm, '');
    }
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
};

export const stripJavaCommentsAndStrings = (content: string): string => {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/"(\\.|[^"\\])*"/g, ' ')
        .replace(/'(\\.|[^'\\])*'/g, ' ');
};
