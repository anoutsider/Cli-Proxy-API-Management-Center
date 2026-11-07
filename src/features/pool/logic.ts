import type { TFunction } from 'i18next';
import type {
  PoolAccount,
  PoolDayKind,
  PoolForecast,
  PoolHistoryPoint,
  PoolPoint,
} from '@/types/poolForecast';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export const POOL_REFRESH_MS = 60_000;
export const STALE_AFTER_MS = 30 * MINUTE_MS;
export const CHART_SPAN_MS = 7 * DAY_MS;

type VerdictReset = { hours: number; email: string; percent: number };

export type PoolVerdict =
  | { kind: 'no-accounts' }
  | { kind: 'no-history' }
  | { kind: 'enough' }
  | { kind: 'out-now'; nextReset: VerdictReset | null }
  | {
      kind: 'runs-out';
      soonHours: number;
      /** Null when a quiet day does not run out within 7 days. */
      lateHours: number | null;
      nextReset: VerdictReset | null;
    };

/** Whole hours left, truncated like the panel countdowns so the verdict never claims extra time. */
const hoursUntil = (atMs: number, nowMs: number) => Math.floor((atMs - nowMs) / HOUR_MS);

export const toPercent = (fraction: number) => Math.round(fraction * 100);

/** Usage percent rounded down, so 100% shows only for an account that is full. */
export const usedPercent = (fraction: number) => Math.floor(fraction * 100 + 1e-6);

const upcomingReset = (
  nextReset: PoolForecast['pool']['nextReset'],
  nowMs: number
): VerdictReset | null =>
  nextReset && nextReset.atMs > nowMs
    ? {
        hours: Math.max(1, hoursUntil(nextReset.atMs, nowMs)),
        email: nextReset.email,
        percent: toPercent(nextReset.restores),
      }
    : null;

/**
 * One-sentence outlook. The current pool comes first: no account in it, then no quota left in it.
 * Then the run-out times, where the busy day sets the soonest bound.
 */
export function buildVerdict(forecast: PoolForecast, nowMs: number): PoolVerdict {
  const { accounts, remaining, burnPerDay, runsOutAtMs } = forecast.pool;
  if (accounts === 0) return { kind: 'no-accounts' };
  const nextReset = upcomingReset(forecast.pool.nextReset, nowMs);
  if (remaining <= 0) return { kind: 'out-now', nextReset };
  if (burnPerDay === null || runsOutAtMs === null) return { kind: 'no-history' };
  const times = [runsOutAtMs.busy, runsOutAtMs.typical, runsOutAtMs.quiet].filter(
    (value): value is number => value !== null
  );
  if (times.length === 0) return { kind: 'enough' };
  const soonest = Math.min(...times);
  if (soonest <= nowMs) return { kind: 'out-now', nextReset };
  const soonHours = Math.max(1, hoursUntil(soonest, nowMs));
  return {
    kind: 'runs-out',
    soonHours,
    lateHours:
      runsOutAtMs.quiet === null ? null : Math.max(1, hoursUntil(Math.max(...times), nowMs)),
    nextReset,
  };
}

const withNextReset = (sentence: string, nextReset: VerdictReset | null, t: TFunction) =>
  nextReset
    ? `${sentence} ${t('pool.verdict_next_reset', {
        count: nextReset.hours,
        email: nextReset.email,
        percent: nextReset.percent,
      })}`
    : sentence;

/** The verdict as one or two sentences in the current language. */
export function verdictText(verdict: PoolVerdict, t: TFunction): string {
  switch (verdict.kind) {
    case 'no-accounts':
      return t('pool.verdict_no_accounts');
    case 'no-history':
      return t('pool.verdict_no_history');
    case 'enough':
      return t('pool.verdict_enough');
    case 'out-now':
      return withNextReset(t('pool.verdict_out_now'), verdict.nextReset, t);
    case 'runs-out': {
      const outlook =
        verdict.lateHours === null
          ? t('pool.verdict_busy_only', { count: verdict.soonHours })
          : verdict.lateHours === verdict.soonHours
            ? t('pool.verdict_runs_out', { count: verdict.soonHours })
            : t('pool.verdict_runs_out_range', {
                soon: verdict.soonHours,
                late: verdict.lateHours,
              });
      return withNextReset(outlook, verdict.nextReset, t);
    }
  }
}

const STATE_RANK: Record<PoolAccount['state'], number> = {
  next: 0,
  eligible: 1,
  draining: 1,
  'at-limit': 2,
  'no-data': 3,
  'needs-sign-in': 4,
  disabled: 5,
  unknown: 6,
};

/** Routing order: the next account, then eligible and draining by reset time, then the rest. */
export function orderAccounts(accounts: PoolAccount[]): PoolAccount[] {
  const resetKey = (account: PoolAccount) =>
    account.sevenDay.resetsAtMs ?? Number.POSITIVE_INFINITY;
  return [...accounts].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      resetKey(a) - resetKey(b) ||
      a.email.localeCompare(b.email)
  );
}

/** Age of a reading; under a minute, or ahead of this clock, reads as just now. */
export function formatAge(atMs: number, nowMs: number, locale: string, t: TFunction): string {
  return nowMs - atMs < MINUTE_MS ? t('pool.just_now') : formatRelativeInstant(atMs, nowMs, locale);
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const weekday = (ms: number, locale: string) => {
  let formatter = weekdayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    weekdayFormatters.set(locale, formatter);
  }
  return formatter.format(ms);
};

/** Day axis label, weekday first: `Sun 8`. */
export const formatDayLabel = (ms: number, locale: string) =>
  `${weekday(ms, locale)} ${new Date(ms).getDate()}`;

/** Weekday and the panel's usual `MM/DD HH:mm` instant. */
export const formatDayHour = (ms: number, locale: string) =>
  `${weekday(ms, locale)} ${formatInstantShort(ms)}`;

export const isStale = (observedAtMs: number | null, nowMs: number) =>
  observedAtMs !== null && nowMs - observedAtMs > STALE_AFTER_MS;

/* ---------- chart geometry ---------- */

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 300;

export type ChartScale = {
  startMs: number;
  endMs: number;
  nowMs: number;
  max: number;
  x: (ms: number) => number;
  y: (value: number) => number;
};

/**
 * Time runs over the 7 days before and after the forecast. The value axis runs from 0 to the pool
 * size or the largest value drawn, whichever is larger, rounded up to a whole account.
 */
export function createChartScale(
  forecast: PoolForecast,
  series: ChartSeries,
  showFable: boolean
): ChartScale {
  const nowMs = forecast.generatedAtMs;
  const startMs = nowMs - CHART_SPAN_MS;
  const endMs = nowMs + CHART_SPAN_MS;
  const drawn = [
    series.history,
    ...(series.projection ? Object.values(series.projection) : []),
    ...(showFable ? [series.fable] : []),
  ];
  const largest = Math.max(0, ...drawn.flat().map((point) => point.remaining));
  const max = Math.max(1, forecast.pool.accounts, Math.ceil(largest));
  return {
    startMs,
    endMs,
    nowMs,
    max,
    x: (ms) => ((ms - startMs) / (endMs - startMs)) * CHART_WIDTH,
    y: (value) => CHART_HEIGHT - (Math.max(0, value) / max) * CHART_HEIGHT,
  };
}

type Vertex = [number, number];

/** Hourly points joined by straight lines; a reset restores quota within one hour, a step up. */
function vertices(points: PoolPoint[], scale: ChartScale): Vertex[] {
  return points
    .filter((point) => point.atMs >= scale.startMs && point.atMs <= scale.endMs)
    .map((point): Vertex => [scale.x(point.atMs), scale.y(point.remaining)]);
}

const toPath = (vertices: Vertex[]) =>
  vertices
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

export const linePath = (points: PoolPoint[], scale: ChartScale) => toPath(vertices(points, scale));

/** Closed area between the quiet-day series (upper edge) and the busy-day series (lower edge). */
export function bandPath(upper: PoolPoint[], lower: PoolPoint[], scale: ChartScale): string {
  const top = vertices(upper, scale);
  const bottom = vertices(lower, scale).reverse();
  if (top.length === 0 || bottom.length === 0) return '';
  return `${toPath([...top, ...bottom])} Z`;
}

export type ChartSeries = {
  history: PoolPoint[];
  fable: PoolPoint[];
  projection: { quiet: PoolPoint[]; typical: PoolPoint[]; busy: PoolPoint[] } | null;
};

/** Projections start from the current pool total so the band joins the history line at now. */
export function buildChartSeries(forecast: PoolForecast): ChartSeries {
  const origin: PoolPoint = { atMs: forecast.generatedAtMs, remaining: forecast.pool.remaining };
  const fable = forecast.history.flatMap((point: PoolHistoryPoint) =>
    point.fableRemaining === null ? [] : [{ atMs: point.atMs, remaining: point.fableRemaining }]
  );
  const projection = forecast.projection
    ? {
        quiet: [origin, ...forecast.projection.quiet],
        typical: [origin, ...forecast.projection.typical],
        busy: [origin, ...forecast.projection.busy],
      }
    : null;
  return { history: forecast.history, fable, projection };
}

/** Local midnights inside the chart span, for the day axis. */
export function dayTicks(scale: ChartScale): number[] {
  const first = new Date(scale.startMs);
  first.setHours(24, 0, 0, 0);
  const ticks: number[] = [];
  for (const day = first; day.getTime() < scale.endMs; day.setDate(day.getDate() + 1)) {
    ticks.push(day.getTime());
  }
  return ticks;
}

export type ResetMarker = { atMs: number; email: string };

/** Each account's seven-day reset inside the chart span: the last one before now and the next one. */
export function resetMarkers(forecast: PoolForecast, scale: ChartScale): ResetMarker[] {
  return forecast.accounts
    .flatMap((account) => {
      const next = account.sevenDay.resetsAtMs;
      if (next === null) return [];
      return [next - CHART_SPAN_MS, next].map((atMs) => ({ atMs, email: account.email }));
    })
    .filter((marker) => marker.atMs > scale.startMs && marker.atMs <= scale.endMs)
    .sort((a, b) => a.atMs - b.atMs);
}

/** The whole UTC hour nearest to `ms` inside the chart span; the hub sends points on whole hours. */
export function snapToHour(ms: number, scale: ChartScale): number {
  const first = Math.ceil(scale.startMs / HOUR_MS) * HOUR_MS;
  const last = Math.floor(scale.endMs / HOUR_MS) * HOUR_MS;
  return Math.min(last, Math.max(first, Math.round(ms / HOUR_MS) * HOUR_MS));
}

/** The point nearest to `ms` within half an hour; points are in time order. */
function pointNear(points: PoolPoint[], ms: number): PoolPoint | undefined {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].atMs < ms) low = mid + 1;
    else high = mid;
  }
  const nearest = [points[low - 1], points[low]]
    .filter(Boolean)
    .sort((a, b) => Math.abs(a.atMs - ms) - Math.abs(b.atMs - ms))[0];
  return nearest && Math.abs(nearest.atMs - ms) <= HOUR_MS / 2 ? nearest : undefined;
}

export type ReadoutKey = 'past' | 'fable' | PoolDayKind;

export type ChartReadout = {
  /** Time of the points the readout shows. */
  atMs: number;
  rows: { key: ReadoutKey; value: number }[];
};

/** Values at the hour nearest to `ms`: history before now, the three kinds of day after it. */
export function chartReadout(
  series: ChartSeries,
  scale: ChartScale,
  ms: number,
  showFable: boolean
): ChartReadout {
  const hourMs = snapToHour(ms, scale);
  const { history, fable, projection } = series;
  let sources: [ReadoutKey, PoolPoint[]][] = [];
  if (hourMs <= scale.nowMs) {
    sources = showFable
      ? [
          ['past', history],
          ['fable', fable],
        ]
      : [['past', history]];
  } else if (projection) {
    sources = [
      ['quiet', projection.quiet],
      ['typical', projection.typical],
      ['busy', projection.busy],
    ];
  }
  const found = sources.flatMap(([key, points]) => {
    const point = pointNear(points, hourMs);
    return point ? [{ key, point }] : [];
  });
  return {
    atMs: found[0]?.point.atMs ?? hourMs,
    rows: found.map(({ key, point }) => ({ key, value: point.remaining })),
  };
}
