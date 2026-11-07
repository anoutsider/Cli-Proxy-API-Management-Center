import { useTranslation } from 'react-i18next';
import type { PoolForecast } from '@/types/poolForecast';
import { AccountTable } from './components/AccountTable';
import { PoolChart } from './components/PoolChart';
import { buildVerdict, formatAge, toPercent, verdictText } from './logic';
import styles from './PoolPage.module.scss';

type PoolViewProps = {
  forecast: PoolForecast;
  nowMs: number;
};

const formatAccounts = (value: number) => value.toFixed(2);

/** The Pool page body for one forecast; `nowMs` drives every relative time on it. */
export function PoolView({ forecast, nowMs }: PoolViewProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const verdict = buildVerdict(forecast, nowMs);
  const sentence = verdictText(verdict, t);
  const { pool, accuracy } = forecast;

  return (
    <div className={styles.body}>
      <section className={styles.summary} aria-live="polite">
        <p className={styles.verdict} data-verdict={verdict.kind}>
          {sentence}
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>{t('pool.fact_left')}</dt>
            <dd>
              {t('pool.fact_left_value', {
                remaining: formatAccounts(pool.remaining),
                accounts: pool.accounts,
              })}
            </dd>
          </div>
          {pool.burnPerDay ? (
            <div>
              <dt>{t('pool.fact_typical')}</dt>
              <dd>
                {t('pool.fact_burn_value', { value: formatAccounts(pool.burnPerDay.typical) })}
              </dd>
            </div>
          ) : null}
          {pool.burnLast24h !== null ? (
            <div>
              <dt>{t('pool.fact_last24h')}</dt>
              <dd>{t('pool.fact_burn_value', { value: formatAccounts(pool.burnLast24h) })}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('pool.fact_generated')}</dt>
            <dd>{formatAge(forecast.generatedAtMs, nowMs, locale, t)}</dd>
          </div>
        </dl>
      </section>

      <PoolChart forecast={forecast} locale={locale} summary={sentence} />

      <AccountTable
        accounts={forecast.accounts}
        threshold={forecast.threshold}
        nowMs={nowMs}
        locale={locale}
      />

      {accuracy ? (
        <p className={styles.accuracy}>
          {t('pool.accuracy', {
            predicted: toPercent(accuracy.predictedTypical),
            actual: toPercent(accuracy.actual),
          })}
        </p>
      ) : null}
    </div>
  );
}
