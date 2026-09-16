const TODO_RE = /\b(TODO|FIXME)\b/i;
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

/** ponytail: fixture-only check for tag extract. */
export function selfCheckTodoScanner(): void {
    const items = scanTodosInContent(
        [
            'const x = 1;',
            '// TODO: wire this up',
            '/* FIXME later */',
            'notodohere',
            '// todo lowercase',
        ].join('\n'),
        '/repo/src/a.ts',
        'src/a.ts',
    );

    if (items.length !== 3) {
        throw new Error(`expected 3 todos, got ${items.length}`);
    }
    if (items[0].tag !== 'TODO' || items[0].line !== 2) {
        throw new Error('first match should be TODO on line 2');
    }
    if (items[1].tag !== 'FIXME' || items[1].line !== 3) {
        throw new Error('second match should be FIXME on line 3');
    }
    if (items[2].tag !== 'TODO' || items[2].line !== 5) {
        throw new Error('lowercase todo should match');
    }

    const ranked = rankTodos([
        {
            relativePath: 'b.ts',
            absolutePath: '/b.ts',
            line: 1,
            tag: 'TODO',
            text: 'TODO',
        },
        {
            relativePath: 'a.ts',
            absolutePath: '/a.ts',
            line: 1,
            tag: 'FIXME',
            text: 'FIXME',
        },
    ]);
    if (ranked.todoTotal !== 2 || ranked.todos[0].tag !== 'FIXME') {
        throw new Error('FIXME should sort before TODO');
    }
}
