/**
 * Account hub pool forecast.
 *
 * Served by the account hub fork (anoutsider/CLIProxyAPI) under the v8 observability group.
 */

import { apiClient } from './client';
import {
  POOL_ACCOUNT_STATES,
  type PoolAccount,
  type PoolAccountState,
  type PoolDayKind,
  type PoolDayValues,
  type PoolForecast,
  type PoolHistoryPoint,
  type PoolPoint,
} from '@/types/poolForecast';
import { isRecord } from '@/utils/helpers';

export const POOL_FORECAST_PATH = '/observability/pool-forecast';

const DAY_KINDS: PoolDayKind[] = ['quiet', 'typical', 'busy'];

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const instant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** All three kinds, or null when any of them is missing. */
const dayValues = (value: unknown): PoolDayValues | null => {
  if (!isRecord(value)) return null;
  const quiet = finite(value.quiet);
  const typical = finite(value.typical);
  const busy = finite(value.busy);
  return quiet === null || typical === null || busy === null ? null : { quiet, typical, busy };
};

const accountState = (value: unknown): PoolAccount['state'] =>
  POOL_ACCOUNT_STATES.includes(value as PoolAccountState) ? (value as PoolAccountState) : 'unknown';

const normalizeAccount = (value: unknown): PoolAccount | null => {
  if (!isRecord(value)) return null;
  const sevenDay = isRecord(value.sevenDay) ? value.sevenDay : {};
  const models = Array.isArray(value.models) ? value.models : [];
  const fable = models.find(
    (model) => isRecord(model) && text(model.name).toLowerCase() === 'fable'
  );
  return {
    id: text(value.id),
    email: text(value.email) || text(value.id),
    state: accountState(value.state),
    sevenDay: {
      used: finite(sevenDay.used),
      resetsAtMs: instant(sevenDay.resetsAt),
      observedAtMs: instant(sevenDay.observedAt),
    },
    fableUsed: isRecord(fable) ? finite(fable.used) : null,
    leftAtReset: dayValues(value.leftAtReset),
  };
};

const normalizePoints = (value: unknown): PoolPoint[] | null => {
  if (!Array.isArray(value)) return null;
  return value.flatMap((point) => {
    if (!isRecord(point)) return [];
    const atMs = instant(point.at);
    const remaining = finite(point.remaining);
    return atMs === null || remaining === null ? [] : [{ atMs, remaining }];
  });
};

const normalizeHistory = (value: unknown): PoolHistoryPoint[] =>
  Array.isArray(value)
    ? value.flatMap((point) => {
        if (!isRecord(point)) return [];
        const atMs = instant(point.at);
        const remaining = finite(point.remaining);
        if (atMs === null || remaining === null) return [];
        return [{ atMs, remaining, fableRemaining: finite(point.fableRemaining) }];
      })
    : [];

const normalizeProjection = (value: unknown): PoolForecast['projection'] => {
  if (!isRecord(value)) return null;
  const quiet = normalizePoints(value.quiet);
  const typical = normalizePoints(value.typical);
  const busy = normalizePoints(value.busy);
  return quiet && typical && busy ? { quiet, typical, busy } : null;
};

const normalizeRunsOut = (value: unknown): PoolForecast['pool']['runsOutAtMs'] => {
  if (!isRecord(value)) return null;
  return Object.fromEntries(DAY_KINDS.map((kind) => [kind, instant(value[kind])])) as Record<
    PoolDayKind,
    number | null
  >;
};

const normalizeNextReset = (value: unknown): PoolForecast['pool']['nextReset'] => {
  if (!isRecord(value)) return null;
  const atMs = instant(value.at);
  const restores = finite(value.restores);
  const email = text(value.email);
  return atMs === null || restores === null || !email ? null : { email, atMs, restores };
};

const normalizeAccuracy = (value: unknown): PoolForecast['accuracy'] => {
  if (!isRecord(value)) return null;
  const forecastAtMs = instant(value.forecastAt);
  const predictedTypical = finite(value.predictedTypical);
  const actual = finite(value.actual);
  return forecastAtMs === null || predictedTypical === null || actual === null
    ? null
    : { forecastAtMs, predictedTypical, actual };
};

export class PoolForecastShapeError extends Error {
  constructor() {
    super('The hub returned a pool forecast without generatedAt or pool totals');
    this.name = 'PoolForecastShapeError';
  }
}

/** Reads the hub response into epoch-millisecond fields; throws when the core totals are missing. */
export function normalizePoolForecast(value: unknown): PoolForecast {
  if (!isRecord(value) || !isRecord(value.pool)) throw new PoolForecastShapeError();
  const generatedAtMs = instant(value.generatedAt);
  const accountCount = finite(value.pool.accounts);
  const remaining = finite(value.pool.remaining);
  if (generatedAtMs === null || accountCount === null || remaining === null) {
    throw new PoolForecastShapeError();
  }
  const accounts = Array.isArray(value.accounts)
    ? value.accounts.flatMap((account) => normalizeAccount(account) ?? [])
    : [];
  const burn = isRecord(value.pool.burnPerDay) ? value.pool.burnPerDay : {};
  return {
    generatedAtMs,
    threshold: finite(value.threshold),
    historyDays: finite(value.historyDays),
    accounts,
    pool: {
      accounts: accountCount,
      remaining,
      fableRemaining: finite(value.pool.fableRemaining),
      burnPerDay: dayValues(burn),
      burnLast24h: finite(burn.last24h),
      runsOutAtMs: normalizeRunsOut(value.pool.runsOutAt),
      nextReset: normalizeNextReset(value.pool.nextReset),
    },
    history: normalizeHistory(value.history),
    projection: normalizeProjection(value.projection),
    accuracy: normalizeAccuracy(value.accuracy),
  };
}

export const poolForecastApi = {
  /** GET the hub's pool forecast with the current management key. */
  async fetch(): Promise<PoolForecast> {
    const raw = await apiClient.get<unknown>(POOL_FORECAST_PATH);
    return normalizePoolForecast(raw);
  },
};
