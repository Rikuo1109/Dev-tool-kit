import * as assert from 'assert';
import { emptyHourlyGrid } from '../features/dashboard/gitChanges';
import {
    computeHourlyLevels,
    formatHourRange,
    formatUtcOffset,
    hourlyWindowStart,
    summarizeHourly,
} from '../features/dashboard/hourlyGrid';

suite('Dashboard hourly grid helpers', () => {
    test('levels: zero stays 0, smallest active cell is level 1, top saturates', () => {
        const grid = emptyHourlyGrid();
        grid[0] = 1;
        grid[1] = 6;
        grid[2] = 31;
        grid[3] = 148;
        const scale = computeHourlyLevels(grid, 9);
        assert.strictEqual(scale.levels[10], 0);
        assert.strictEqual(scale.levels[0], 1);
        assert.strictEqual(scale.levels[3], 9);
        assert.ok(scale.levels[1] < scale.levels[2], '6 and 31 must differ');
        assert.ok(scale.levels[1] > scale.levels[0]);
        assert.strictEqual(scale.lo, 1);
        assert.strictEqual(scale.max, 148);
    });

    test('levels: identical counts draw at the middle level', () => {
        const grid = emptyHourlyGrid();
        grid[5] = 3;
        grid[6] = 3;
        const scale = computeHourlyLevels(grid, 9);
        assert.strictEqual(scale.levels[5], 5);
        assert.strictEqual(scale.levels[6], 5);
    });

    test('levels: empty grid', () => {
        const scale = computeHourlyLevels(emptyHourlyGrid(), 9);
        assert.ok(scale.levels.every((l) => l === 0));
        assert.strictEqual(scale.max, 0);
    });

    test('summary: total and busiest slot (first wins ties)', () => {
        const grid = emptyHourlyGrid();
        grid[1 * 24 + 15] = 7;
        grid[4 * 24 + 10] = 7;
        grid[0] = 2;
        const summary = summarizeHourly(grid);
        assert.strictEqual(summary.total, 16);
        assert.deepStrictEqual(summary.busiest, { weekday: 1, hour: 15, count: 7 });
        assert.strictEqual(summarizeHourly(emptyHourlyGrid()).busiest, null);
    });

    test('formatters', () => {
        assert.strictEqual(formatHourRange(8), '08:00–09:00');
        assert.strictEqual(formatHourRange(23), '23:00–24:00');
        assert.strictEqual(formatUtcOffset(-420), 'UTC+7');
        assert.strictEqual(formatUtcOffset(0), 'UTC');
        assert.strictEqual(formatUtcOffset(210), 'UTC-3:30');
        assert.strictEqual(hourlyWindowStart(new Date(2026, 9, 16, 12), 90), '2026-07-18');
    });
});
