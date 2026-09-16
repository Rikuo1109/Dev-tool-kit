export const extractVueScript = (content: string): string => {
    const blocks = [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    return blocks.map((block) => block[1]).join('\n');
};

export const scriptContent = (content: string, filePath: string): string => {
    if (!filePath.endsWith('.vue')) {
        return content;
    }
    return extractVueScript(content) || content;
};
