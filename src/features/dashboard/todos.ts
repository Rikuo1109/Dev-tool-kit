const TODO_RE = /(?:\/\/|\/?\*|#).*\b(TODO|FIXME)\b/i;
const TODO_DISPLAY_LIMIT = 50;
const PREVIEW_MAX = 120;

export interface TodoItem {
    relativePath: string;
    absolutePath: string;
    line: number;
    tag: 'TODO' | 'FIXME';
    text: string;
}

export function scanTodosInContent(
    content: string,
    absolutePath: string,
    relativePath: string,
): TodoItem[] {
    const items: TodoItem[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) {
            continue;
        }

        const match = trimmed.match(TODO_RE);
        if (!match) {
            continue;
        }

        const tag = match[1].toUpperCase() as 'TODO' | 'FIXME';
        items.push({
            relativePath,
            absolutePath: absolutePath.replace(/\\/g, '/'),
            line: i + 1,
            tag,
            text: trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX - 1)}…` : trimmed,
        });
    }

    return items;
}

export function rankTodos(todos: TodoItem[]): {
    todos: TodoItem[];
    todoTotal: number;
} {
    const sorted = [...todos].sort(
        (a, b) =>
            (a.tag === 'FIXME' ? 0 : 1) - (b.tag === 'FIXME' ? 0 : 1) ||
            a.relativePath.localeCompare(b.relativePath) ||
            a.line - b.line,
    );

    return {
        todoTotal: sorted.length,
        todos: sorted.slice(0, TODO_DISPLAY_LIMIT),
    };
}
