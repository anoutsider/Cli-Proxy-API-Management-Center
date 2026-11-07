/**
 * Pool page: when the Claude account pool runs out, and which account routing uses next.
 *
 * Reads the hub forecast once on open, then every minute while the tab is visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { poolForecastApi } from '@/services/api/poolForecast';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ApiError } from '@/types/api';
import type { PoolForecast } from '@/types/poolForecast';
import { getErrorMessage } from '@/utils/helpers';
import { POOL_REFRESH_MS } from './logic';
import { PoolView } from './PoolView';
import styles from './PoolPage.module.scss';

type LoadError = { status: number | undefined; message: string };

export function PoolPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const nowMs = useNow();

  const [forecast, setForecast] = useState<PoolForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const requestRef = useRef(0);
  const lastLoadRef = useRef(0);

  const connected = connectionStatus === 'connected';

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const isCurrent = () => requestId === requestRef.current;
    if (!connected) {
      setLoading(false);
      return;
    }
    lastLoadRef.current = Date.now();
    setLoading(true);
    try {
      const next = await poolForecastApi.fetch();
      if (!isCurrent()) return;
      setForecast(next);
      setError(null);
    } catch (err) {
      if (!isCurrent()) return;
      setError({ status: (err as ApiError).status, message: getErrorMessage(err) });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    setForecast(null);
    void load();
    return () => {
      // Late responses from this connection must not land on a later one.
      requestRef.current += 1;
    };
  }, [load, apiBase]);

  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    // A tab that comes back after a minute or more reloads at once instead of waiting a tick.
    const reloadIfDue = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastLoadRef.current >= POOL_REFRESH_MS) void load();
    };
    const id = window.setInterval(tick, POOL_REFRESH_MS);
    document.addEventListener('visibilitychange', reloadIfDue);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', reloadIfDue);
    };
  }, [connected, load]);

  useHeaderRefresh(load);

  const renderBody = () => {
    if (forecast) {
      return (
        <>
          {error ? (
            <p className={styles.refreshError} role="status">
              {t('pool.refresh_failed', { message: error.message || t('common.unknown_error') })}
            </p>
          ) : null}
          <PoolView forecast={forecast} nowMs={nowMs} />
        </>
      );
    }
    if (loading) {
      return (
        <div className={styles.skeletons} aria-busy="true" aria-label={t('pool.loading')}>
          <Skeleton height={56} />
          <Skeleton height={320} />
          <Skeleton height={240} />
        </div>
      );
    }
    if (error) {
      return (
        <EmptyState
          title={
            error.status === 404
              ? t('pool.not_served')
              : t('pool.load_failed', { message: error.message || t('common.unknown_error') })
          }
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('pool.retry')}
            </Button>
          }
        />
      );
    }
    return null;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('pool.title')}</h1>
      </header>
      {renderBody()}
    </div>
  );
}
