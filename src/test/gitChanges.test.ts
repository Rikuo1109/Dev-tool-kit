import * as assert from 'assert';
import { GitChangeAnalyzer } from '../features/dashboard/gitChanges';

suite('Dashboard git daily series', () => {
    // Local noon avoids DST/midnight edge cases when building "now".
    const now = new Date(2026, 9, 16, 12, 0, 0);

    test('returns one column per day, oldest first, today last', () => {
        const days = GitChangeAnalyzer.buildDailySeries(new Map(), now);
        assert.strictEqual(days.length, GitChangeAnalyzer.CHART_DAYS);
        assert.strictEqual(days[0].date, '2026-09-17');
        assert.strictEqual(days[days.length - 1].date, '2026-10-16');
    });

    test('fills gaps with zeros and computes net', () => {
        const byDate = new Map([
            ['2026-10-16', { added: 2269, deleted: 11822 }],
            ['2026-10-13', { added: 5624, deleted: 502 }],
        ]);
        const days = GitChangeAnalyzer.buildDailySeries(byDate, now);
        const byKey = new Map(days.map((d) => [d.date, d]));
        assert.deepStrictEqual(byKey.get('2026-10-16'), {
            date: '2026-10-16',
            added: 2269,
            deleted: 11822,
            net: -9553,
        });
        assert.strictEqual(byKey.get('2026-10-13')?.net, 5122);
        assert.deepStrictEqual(byKey.get('2026-10-14'), {
            date: '2026-10-14',
            added: 0,
            deleted: 0,
            net: 0,
        });
    });

    test('ignores history older than the chart window', () => {
        const byDate = new Map([['2026-09-16', { added: 999, deleted: 1 }]]);
        const days = GitChangeAnalyzer.buildDailySeries(byDate, now);
        assert.ok(days.every((d) => d.added === 0 && d.deleted === 0));
    });

    test('labels are MM/DD', () => {
        const labels = GitChangeAnalyzer.formatGitChartLabels(
            GitChangeAnalyzer.buildDailySeries(new Map(), now),
        );
        assert.strictEqual(labels[0], '09/17');
        assert.strictEqual(labels[labels.length - 1], '10/16');
    });
});
