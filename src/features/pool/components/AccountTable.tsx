import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table/Table';
import type { PoolAccount } from '@/types/poolForecast';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { formatAge, isStale, orderAccounts, toPercent } from '../logic';
import styles from './AccountTable.module.scss';

type AccountTableProps = {
  accounts: PoolAccount[];
  threshold: number | null;
  nowMs: number;
  locale: string;
};

const STATE_KEYS: Record<PoolAccount['state'], string> = {
  next: 'pool.state_next',
  eligible: 'pool.state_eligible',
  draining: 'pool.state_draining',
  'at-limit': 'pool.state_at_limit',
  'no-data': 'pool.state_no_data',
  'needs-sign-in': 'pool.state_needs_sign_in',
  disabled: 'pool.state_disabled',
  unknown: 'pool.state_unknown',
};

/** Bar level: below the threshold, between the threshold and the limit, and at the limit. */
const usageLevel = (used: number, threshold: number | null) => {
  if (used >= 1) return 'full';
  if (threshold !== null && used >= threshold) return 'high';
  return 'normal';
};

export function AccountTable({ accounts, threshold, nowMs, locale }: AccountTableProps) {
  const { t } = useTranslation();
  const ordered = orderAccounts(accounts);
  const none = t('pool.none');

  return (
    <section className={styles.section} aria-labelledby="pool-accounts-title">
      <h2 id="pool-accounts-title" className={styles.title}>
        {t('pool.accounts_title')}
      </h2>
      <Table className={styles.table}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pool.col_account')}</TableHead>
            <TableHead>{t('pool.col_seven_day')}</TableHead>
            <TableHead alignRight>{t('pool.col_fable')}</TableHead>
            <TableHead>{t('pool.col_resets')}</TableHead>
            <TableHead alignRight>{t('pool.col_left_at_reset')}</TableHead>
            <TableHead>{t('pool.col_state')}</TableHead>
            <TableHead>{t('pool.col_observed')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((account) => {
            const { used, resetsAtMs, observedAtMs } = account.sevenDay;
            const stale = isStale(observedAtMs, nowMs);
            return (
              <TableRow key={account.id || account.email} data-account={account.email}>
                <TableCell className={styles.email}>{account.email}</TableCell>
                <TableCell data-label={t('pool.col_seven_day')}>
                  {used === null ? (
                    <span className={styles.muted}>{none}</span>
                  ) : (
                    <div className={styles.usage}>
                      <div
                        className={styles.track}
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={toPercent(used)}
                        aria-label={t('pool.col_seven_day')}
                      >
                        <span
                          className={styles.fill}
                          data-level={usageLevel(used, threshold)}
                          style={{ width: `${Math.min(100, toPercent(used))}%` }}
                        />
                        {threshold !== null ? (
                          <span
                            className={styles.threshold}
                            style={{ left: `${toPercent(threshold)}%` }}
                            title={t('pool.threshold_marker', { percent: toPercent(threshold) })}
                          />
                        ) : null}
                      </div>
                      <span className={styles.value}>{toPercent(used)}%</span>
                    </div>
                  )}
                </TableCell>
                <TableCell alignRight data-label={t('pool.col_fable')}>
                  {account.fableUsed === null ? (
                    <span className={styles.muted}>{none}</span>
                  ) : (
                    <span className={styles.value}>{toPercent(account.fableUsed)}%</span>
                  )}
                </TableCell>
                <TableCell data-label={t('pool.col_resets')}>
                  {resetsAtMs === null ? (
                    <span className={styles.muted}>{none}</span>
                  ) : (
                    <span className={styles.stack}>
                      <span>{formatRelativeInstant(resetsAtMs, nowMs, locale)}</span>
                      <span className={styles.muted}>{formatInstantShort(resetsAtMs)}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell alignRight data-label={t('pool.col_left_at_reset')}>
                  {account.leftAtReset === null ? (
                    <span className={styles.muted}>{none}</span>
                  ) : (
                    <span
                      className={styles.leftAtReset}
                      tabIndex={0}
                      title={t('pool.left_at_reset_detail', {
                        quiet: toPercent(account.leftAtReset.quiet),
                        busy: toPercent(account.leftAtReset.busy),
                      })}
                    >
                      {toPercent(account.leftAtReset.typical)}%
                    </span>
                  )}
                </TableCell>
                <TableCell data-label={t('pool.col_state')}>
                  <span className={styles.badge} data-state={account.state}>
                    {t(STATE_KEYS[account.state])}
                  </span>
                </TableCell>
                <TableCell data-label={t('pool.col_observed')}>
                  {observedAtMs === null ? (
                    <span className={styles.muted}>{t('pool.no_reading')}</span>
                  ) : (
                    <span className={styles.observed} data-stale={stale ? 'true' : undefined}>
                      {formatAge(observedAtMs, nowMs, locale, t)}
                      {stale ? <span className={styles.staleTag}>{t('pool.stale')}</span> : null}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
