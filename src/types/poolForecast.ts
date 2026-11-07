/**
 * Claude account pool forecast served by the account hub at `/v8/management/observability/pool-forecast`.
 *
 * Usage values are fractions (0 to 1) of one account's weekly quota, so they add up across
 * accounts. Instants are epoch milliseconds, or null when the hub has no value.
 */

export const POOL_ACCOUNT_STATES = [
  'next',
  'eligible',
  'draining',
  'at-limit',
  'no-data',
  'needs-sign-in',
  'disabled',
] as const;

export type PoolAccountState = (typeof POOL_ACCOUNT_STATES)[number];

export type PoolDayKind = 'quiet' | 'typical' | 'busy';

export type PoolDayValues = Record<PoolDayKind, number>;

export type PoolAccount = {
  id: string;
  email: string;
  /** `unknown` holds a state string the contract does not list. */
  state: PoolAccountState | 'unknown';
  sevenDay: {
    used: number | null;
    resetsAtMs: number | null;
    observedAtMs: number | null;
  };
  fableUsed: number | null;
  leftAtReset: PoolDayValues | null;
};

export type PoolPoint = {
  atMs: number;
  remaining: number;
};

export type PoolHistoryPoint = PoolPoint & {
  fableRemaining: number | null;
};

export type PoolForecast = {
  generatedAtMs: number;
  threshold: number | null;
  historyDays: number | null;
  accounts: PoolAccount[];
  pool: {
    accounts: number;
    remaining: number;
    fableRemaining: number | null;
    /** Null while the hub has fewer than 3 full days of history. */
    burnPerDay: PoolDayValues | null;
    burnLast24h: number | null;
    /** A null kind means the pool does not run out within 7 days on that kind of day. */
    runsOutAtMs: Record<PoolDayKind, number | null> | null;
    nextReset: { email: string; atMs: number; restores: number } | null;
  };
  history: PoolHistoryPoint[];
  projection: Record<PoolDayKind, PoolPoint[]> | null;
  accuracy: { forecastAtMs: number; predictedTypical: number; actual: number } | null;
};
