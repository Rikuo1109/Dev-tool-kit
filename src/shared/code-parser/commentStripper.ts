export const stripJavaCommentsAndStrings = (content: string): string => {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/"(\\.|[^"\\])*"/g, ' ')
        .replace(/'(\\.|[^'\\])*'/g, ' ');
};
