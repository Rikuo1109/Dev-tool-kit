/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

/** Returns a runner that allows at most `limit` concurrent tasks. */
export const createLimiter = (limit: number) => {
    let active = 0;
    const queue: (() => void)[] = [];

    const acquire = async (): Promise<void> => {
        if (active < limit) {
            active++;
            return;
        }
        await new Promise<void>((resolve) => queue.push(resolve));
    };

    const release = (): void => {
        const nextTask = queue.shift();
        if (nextTask) {
            nextTask();
        } else {
            active--;
        }
    };

    return async <T>(task: () => Promise<T>): Promise<T> => {
        await acquire();
        try {
            return await task();
        } finally {
            release();
        }
    };
};
