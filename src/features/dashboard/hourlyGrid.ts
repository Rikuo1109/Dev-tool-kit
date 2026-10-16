import { HOURLY_CELLS } from './gitChanges';

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface HourlyLevelScale {
    /** Colour level per cell: 0 = no commits, 1..levelCount = log-scaled intensity. */
    levels: number[];
    /** Smallest non-zero count (level 1) and the count that reaches the top level. */
    lo: number;
    hi: number;
    max: number;
}

/**
 * Maps commit counts to colour levels on a log scale, like the Commit Heatmap's "whole range"
 * mode: the smallest active cell is level 1 and the 95th percentile saturates the top level,
 * so one very busy slot does not flatten the rest.
 */
export const computeHourlyLevels = (grid: readonly number[], levelCount: number): HourlyLevelScale => {
    const values = grid.filter((count) => count > 0).sort((a, b) => a - b);
    if (values.length === 0) {
        return { levels: grid.map(() => 0), lo: 0, hi: 0, max: 0 };
    }

    const lo = values[0];
    const max = values[values.length - 1];
    const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
    const hi = p95 > lo ? p95 : max;

    const levelOf = (count: number): number => {
        if (count <= 0) {
            return 0;
        }
        if (hi <= lo) {
            return Math.ceil(levelCount / 2);
        }
        const t = Math.min(1, Math.max(0, Math.log(count / lo) / Math.log(hi / lo)));
        return 1 + Math.round(t * (levelCount - 1));
    };

    return { levels: grid.map(levelOf), lo, hi, max };
};

export interface HourlySummary {
    total: number;
    busiest: { weekday: number; hour: number; count: number } | null;
}

export const summarizeHourly = (grid: readonly number[]): HourlySummary => {
    let total = 0;
    let busiest: HourlySummary['busiest'] = null;
    for (let i = 0; i < HOURLY_CELLS; i++) {
        const count = grid[i] ?? 0;
        total += count;
        if (count > 0 && (!busiest || count > busiest.count)) {
            busiest = { weekday: Math.floor(i / 24), hour: i % 24, count };
        }
    }
    return { total, busiest };
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "08:00–09:00" for hour 8 ("23:00–24:00" for hour 23). */
export const formatHourRange = (hour: number): string => `${pad2(hour)}:00–${pad2(hour + 1)}:00`;

/** `Date#getTimezoneOffset()` minutes (UTC − local) → "UTC+7", "UTC-3:30", "UTC". */
export const formatUtcOffset = (timezoneOffsetMinutes: number): string => {
    const minutes = -timezoneOffsetMinutes;
    if (minutes === 0) {
        return 'UTC';
    }
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `UTC${minutes > 0 ? '+' : '-'}${h}${m ? `:${pad2(m)}` : ''}`;
};

/** Local YYYY-MM-DD of the first day covered by a `days`-day window ending on `now`. */
export const hourlyWindowStart = (now: Date, days: number): string => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
};
