import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { PoolView } from '../src/features/pool/PoolView';
import {
  CHART_HEIGHT,
  buildChartSeries,
  chartReadout,
  createChartScale,
} from '../src/features/pool/logic';
import { normalizePoolForecast } from '../src/services/api/poolForecast';
import allFull from './fixtures/pool-forecast-all-full.json';
import allNeedSignIn from './fixtures/pool-forecast-all-need-sign-in.json';
import normal from './fixtures/pool-forecast-normal.json';
import shortHistory from './fixtures/pool-forecast-short-history.json';

// The fixtures are BuildPoolForecast responses written by the hub's TestPoolForecastFixtures.
const FIXTURES = {
  normal,
  'short history': shortHistory,
  'all full': allFull,
  'all need sign-in': allNeedSignIn,
} as const;

const nowMs = Date.parse(normal.generatedAt);

const render = (value: unknown) =>
  renderToStaticMarkup(
    createElement(PoolView, { forecast: normalizePoolForecast(value), nowMs })
  ).replace(/&#x27;/g, "'");

const verdictOf = (html: string) =>
  html.match(/<p[^>]*data-verdict="[^"]*"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';

const accountOrder = (html: string) =>
  [...html.matchAll(/data-account="([^"]+)"/g)].map((match) => match[1]);

const rowOf = (html: string, email: string) =>
  html.match(new RegExp(`<tr[^>]*data-account="${email}"[^>]*>(.*?)</tr>`))?.[1] ?? '';

const initialLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('Pool page verdict', () => {
  test.each([
    [
      'normal',
      'Runs out in 132 hours on a busy day, and not within 7 days on a quiet day. ' +
        'Next reset in 8 hours: ana@example.com, +76%.',
    ],
    ['short history', 'Not enough history yet: the forecast needs 3 full days.'],
    [
      'all full',
      'The Claude quota is used up now. Next reset in 8 hours: ana@example.com, +100%.',
    ],
    ['all need sign-in', 'No account can serve: sign in or enable an account.'],
  ] as const)('%s', (name, sentence) => {
    expect(verdictOf(render(FIXTURES[name]))).toBe(sentence);
  });

  test('gives a range when the quiet day also runs out', () => {
    const ranged = {
      ...normal,
      pool: {
        ...normal.pool,
        runsOutAt: { ...normal.pool.runsOutAt, quiet: '2026-11-14T08:00:00Z' },
      },
    };
    expect(verdictOf(render(ranged))).toBe(
      'Runs out in 132 to 155 hours. Next reset in 8 hours: ana@example.com, +76%.'
    );
  });
});

describe('Pool page table', () => {
  test.each([
    [
      'normal',
      [
        'ana@example.com',
        'ben@example.com',
        'cal@example.com',
        'dee@example.com',
        'fay@example.com',
        'eli@example.com',
        'gus@example.com',
      ],
    ],
    [
      'short history',
      [
        'ana@example.com',
        'ben@example.com',
        'cal@example.com',
        'dee@example.com',
        'fay@example.com',
        'eli@example.com',
        'gus@example.com',
      ],
    ],
    ['all full', ['ana@example.com', 'ben@example.com', 'cal@example.com', 'dee@example.com']],
    [
      'all need sign-in',
      [
        'ana@example.com',
        'ben@example.com',
        'fay@example.com',
        'eli@example.com',
        'cal@example.com',
        'dee@example.com',
        'gus@example.com',
      ],
    ],
  ] as const)('%s lists accounts in routing order', (name, emails) => {
    expect(accountOrder(render(FIXTURES[name]))).toEqual([...emails]);
  });

  test('shows states and yesterday accuracy', () => {
    const html = render(normal);
    expect(html).toContain('Needs sign-in');
    expect(html).toContain('Draining');
    expect(html).toContain("Yesterday's typical-day forecast: 53% of an account. Actual: 70%.");
  });

  test('an account at 99.5% does not show as 100%', () => {
    const nearlyFull = {
      ...normal,
      accounts: normal.accounts.map((account) =>
        account.email === 'ana@example.com' && account.sevenDay
          ? { ...account, sevenDay: { ...account.sevenDay, used: 0.995 } }
          : account
      ),
    };
    const row = rowOf(render(nearlyFull), 'ana@example.com');
    expect(row).toContain('>99%<');
    expect(row).not.toContain('>100%<');
    expect(rowOf(render(allFull), 'ana@example.com')).toContain('>100%<');
  });

  test('without 3 full days of history it drops the forecast parts', () => {
    const html = render(shortHistory);
    expect(html).not.toContain('Yesterday');
    expect(html).not.toContain('Typical day uses');
    expect(html).not.toContain('Busy day to quiet day');
    expect(html).toContain('Last 24 hours used');
  });
});

describe('Pool chart', () => {
  test.each([
    ['normal', 4, 5],
    ['short history', 4, 5],
    ['all full', 4, 4],
    ['all need sign-in', 6, 7],
  ] as const)('%s: the value axis holds every value drawn', (name, max, maxWithFable) => {
    const forecast = normalizePoolForecast(FIXTURES[name]);
    const series = buildChartSeries(forecast);
    for (const [showFable, expected] of [
      [false, max],
      [true, maxWithFable],
    ] as const) {
      const scale = createChartScale(forecast, series, showFable);
      expect(scale.max).toBe(expected);
      const drawn = [
        series.history,
        ...(series.projection ? Object.values(series.projection) : []),
        ...(showFable ? [series.fable] : []),
      ].flat();
      for (const point of drawn) {
        expect(scale.y(point.remaining)).toBeGreaterThanOrEqual(0);
        expect(scale.y(point.remaining)).toBeLessThanOrEqual(CHART_HEIGHT);
      }
    }
  });

  test('the readout shows the time of the point it reads', () => {
    const forecast = normalizePoolForecast(normal);
    const series = buildChartSeries(forecast);
    const scale = createChartScale(forecast, series, false);
    const minute = 60_000;

    const ahead = chartReadout(series, scale, nowMs + 50 * minute, false);
    expect(new Date(ahead.atMs).toISOString()).toBe('2026-11-07T21:00:00.000Z');
    const typical = normal.projection.typical.find((point) => point.at === '2026-11-07T21:00:00Z');
    expect(ahead.rows.find((row) => row.key === 'typical')?.value).toBe(typical?.remaining);

    const behind = chartReadout(series, scale, nowMs - 10 * minute, false);
    expect(new Date(behind.atMs).toISOString()).toBe('2026-11-07T20:00:00.000Z');
    expect(behind.rows).toEqual([{ key: 'past', value: normal.history.at(-1)?.remaining ?? -1 }]);
  });
});

describe('Pool strings', () => {
  const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];
  const PLURAL = /_(one|other)$/;

  const lookup = (resource: unknown, path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        resource
      );

  const tokens = (value: unknown) =>
    (typeof value === 'string' ? (value.match(/\{\{[^}]+\}\}/g) ?? []) : []).sort().join('|');

  test.each(LOCALES)('%s has every Pool string with the English placeholders', async (locale) => {
    const english = await Bun.file('src/i18n/locales/en.json').json();
    const resource = await Bun.file(`src/i18n/locales/${locale}.json`).json();
    const stems = new Set(
      ['nav.pool', 'nav_meta.pool', ...Object.keys(english.pool).map((key) => `pool.${key}`)].map(
        (key) => key.replace(PLURAL, '')
      )
    );
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const problems = [...stems].flatMap((stem) => {
      const plural = lookup(english, `${stem}_other`) !== undefined;
      const englishTokens = tokens(lookup(english, plural ? `${stem}_other` : stem));
      // A plural string is either one plain key or one key per plural form of the language.
      const keys =
        plural && lookup(resource, stem) === undefined
          ? categories.map((category) => `${stem}_${category}`)
          : [stem];
      return keys.flatMap((key) => {
        const value = lookup(resource, key);
        if (typeof value !== 'string') return [`${key}: missing`];
        return tokens(value) === englishTokens ? [] : [`${key}: placeholders`];
      });
    });
    expect(problems).toEqual([]);
  });
});
