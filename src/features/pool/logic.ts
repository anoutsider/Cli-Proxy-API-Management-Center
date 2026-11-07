import type { TFunction } from 'i18next';
import type { PoolAccount, PoolForecast, PoolHistoryPoint, PoolPoint } from '@/types/poolForecast';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

export const POOL_REFRESH_MS = 60_000;
export const STALE_AFTER_MS = 30 * MINUTE_MS;
export const CHART_SPAN_MS = 7 * DAY_MS;

export type PoolVerdict =
  | { kind: 'no-history' }
  | { kind: 'enough' }
  | { kind: 'out-now' }
  | {
      kind: 'runs-out';
      soonHours: number;
      /** Null when a quiet day does not run out within 7 days. */
      lateHours: number | null;
      nextReset: { hours: number; email: string; percent: number } | null;
    };

/** Whole hours left, truncated like the panel countdowns so the verdict never claims extra time. */
const hoursUntil = (atMs: number, nowMs: number) => Math.floor((atMs - nowMs) / HOUR_MS);

export const toPercent = (fraction: number) => Math.round(fraction * 100);

/** One-sentence outlook from the run-out times; the busy day sets the soonest bound. */
export function buildVerdict(forecast: PoolForecast, nowMs: number): PoolVerdict {
  const { burnPerDay, runsOutAtMs, nextReset } = forecast.pool;
  if (burnPerDay === null || runsOutAtMs === null) return { kind: 'no-history' };
  const times = [runsOutAtMs.busy, runsOutAtMs.typical, runsOutAtMs.quiet].filter(
    (value): value is number => value !== null
  );
  if (times.length === 0) return { kind: 'enough' };
  const soonest = Math.min(...times);
  if (soonest <= nowMs) return { kind: 'out-now' };
  const soonHours = Math.max(1, hoursUntil(soonest, nowMs));
  return {
    kind: 'runs-out',
    soonHours,
    lateHours:
      runsOutAtMs.quiet === null ? null : Math.max(1, hoursUntil(Math.max(...times), nowMs)),
    nextReset:
      nextReset && nextReset.atMs > nowMs
        ? {
            hours: Math.max(1, hoursUntil(nextReset.atMs, nowMs)),
            email: nextReset.email,
            percent: toPercent(nextReset.restores),
          }
        : null,
  };
}

/** The verdict as one or two sentences in the current language. */
export function verdictText(verdict: PoolVerdict, t: TFunction): string {
  switch (verdict.kind) {
    case 'no-history':
      return t('pool.verdict_no_history');
    case 'enough':
      return t('pool.verdict_enough');
    case 'out-now':
      return t('pool.verdict_out_now');
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
      if (!verdict.nextReset) return outlook;
      const reset = t('pool.verdict_next_reset', {
        count: verdict.nextReset.hours,
        email: verdict.nextReset.email,
        percent: verdict.nextReset.percent,
      });
      return `${outlook} ${reset}`;
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

export function createChartScale(forecast: PoolForecast): ChartScale {
  const nowMs = forecast.generatedAtMs;
  const startMs = nowMs - CHART_SPAN_MS;
  const endMs = nowMs + CHART_SPAN_MS;
  const max = Math.max(1, forecast.pool.accounts);
  const clamp = (value: number) => Math.min(max, Math.max(0, value));
  return {
    startMs,
    endMs,
    nowMs,
    max,
    x: (ms) => ((ms - startMs) / (endMs - startMs)) * CHART_WIDTH,
    y: (value) => CHART_HEIGHT - (clamp(value) / max) * CHART_HEIGHT,
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
