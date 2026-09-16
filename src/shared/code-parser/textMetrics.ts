export const lineAt = (source: string, index: number) => {
    return source.slice(0, index).split('\n').length;
};

export const countLoc = (content: string) => {
    return content.split('\n').filter((line) => line.trim().length > 0).length;
};

export const blockLineCount = (block: { text: string }) => {
    return block.text.split('\n').filter((line) => line.trim().length > 0).length;
};
