import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { PoolView } from '../src/features/pool/PoolView';
import { normalizePoolForecast } from '../src/services/api/poolForecast';
import fixture from './fixtures/pool-forecast.json';

const forecast = normalizePoolForecast(fixture);
const nowMs = Date.parse(fixture.generatedAt);

const render = (value: unknown) =>
  renderToStaticMarkup(
    createElement(PoolView, { forecast: normalizePoolForecast(value), nowMs })
  ).replace(/&#x27;/g, "'");

const verdictOf = (html: string) =>
  html.match(/<p[^>]*data-verdict="[^"]*"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';

const accountOrder = (html: string) =>
  [...html.matchAll(/data-account="([^"]+)"/g)].map((match) => match[1]);

/** The fixture as the hub sends it with fewer than 3 full days of history. */
const withoutHistory = () => ({
  ...fixture,
  historyDays: 2,
  history: fixture.history.slice(-48),
  accounts: fixture.accounts.map((account) => ({ ...account, leftAtReset: null })),
  pool: {
    ...fixture.pool,
    burnPerDay: { quiet: null, typical: null, busy: null, last24h: 1.72 },
    runsOutAt: null,
  },
  projection: null,
  accuracy: null,
});

const initialLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('Pool page', () => {
  test('states when the pool runs out and the next reset', () => {
    expect(verdictOf(render(fixture))).toBe(
      'Runs out in 61 hours on a busy day, and not within 7 days on a quiet day. ' +
        'Next reset in 15 hours: bea@example.com, +100%.'
    );

    const ranged = {
      ...fixture,
      pool: {
        ...fixture.pool,
        runsOutAt: { ...fixture.pool.runsOutAt, quiet: '2026-11-14T08:00:00Z' },
      },
    };
    expect(verdictOf(render(ranged))).toBe(
      'Runs out in 61 to 156 hours. Next reset in 15 hours: bea@example.com, +100%.'
    );
  });

  test('lists accounts in routing order', () => {
    const html = render(fixture);
    // The fixture lists bea (at limit) first; routing order puts the next account first.
    expect(forecast.accounts.map((account) => account.email)[0]).toBe('bea@example.com');
    expect(accountOrder(html)).toEqual([
      'ana@example.com',
      'cam@example.com',
      'dev@example.com',
      'bea@example.com',
      'fay@example.com',
      'eli@example.com',
      'gus@example.com',
    ]);
    expect(html).toContain('Needs sign-in');
    expect(html).toContain('Stale');
    expect(html).toContain("Yesterday's typical-day forecast: 152% of an account. Actual: 171%.");
  });

  test('without 3 full days of history it says so and drops the forecast parts', () => {
    const html = render(withoutHistory());
    expect(verdictOf(html)).toBe('Not enough history yet: the forecast needs 3 full days.');
    expect(accountOrder(html)).toHaveLength(7);
    expect(html).not.toContain('Yesterday');
    expect(html).not.toContain('Typical day uses');
    expect(html).not.toContain('Busy day to quiet day');
    expect(html).toContain('Last 24 hours used');
  });
});
