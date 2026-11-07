import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { PoolForecast } from '@/types/poolForecast';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  bandPath,
  buildChartSeries,
  chartReadout,
  createChartScale,
  dayTicks,
  formatDayHour,
  formatDayLabel,
  resetMarkers,
  linePath,
  snapToHour,
  type ReadoutKey,
} from '../logic';
import styles from './PoolChart.module.scss';

type PoolChartProps = {
  forecast: PoolForecast;
  locale: string;
  /** Accessible summary of the chart, normally the verdict sentence. */
  summary: string;
};

const formatAccounts = (value: number) => value.toFixed(1);

export function PoolChart({ forecast, locale, summary }: PoolChartProps) {
  const { t } = useTranslation();
  const [showFable, setShowFable] = useState(false);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const series = useMemo(() => buildChartSeries(forecast), [forecast]);
  const scale = useMemo(
    () => createChartScale(forecast, series, showFable),
    [forecast, series, showFable]
  );
  const ticks = useMemo(() => dayTicks(scale), [scale]);
  const markers = useMemo(() => resetMarkers(forecast, scale), [forecast, scale]);
  const yTicks = Array.from({ length: Math.floor(scale.max) + 1 }, (_, index) => index);
  const percentX = (ms: number) => `${(scale.x(ms) / CHART_WIDTH) * 100}%`;
  const percentY = (value: number) => `${(scale.y(value) / CHART_HEIGHT) * 100}%`;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    setHoverMs(snapToHour(scale.startMs + fraction * (scale.endMs - scale.startMs), scale));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DAY_MS : HOUR_MS;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const base = hoverMs ?? scale.nowMs;
      setHoverMs(snapToHour(base + (event.key === 'ArrowLeft' ? -step : step), scale));
    } else if (event.key === 'Escape') {
      setHoverMs(null);
    }
  };

  const rowStyle: Record<ReadoutKey, { label: string; swatch: string }> = {
    past: { label: t('pool.legend_past'), swatch: styles.swatchPast },
    fable: { label: t('pool.legend_fable'), swatch: styles.swatchFable },
    quiet: { label: t('pool.day_quiet'), swatch: styles.swatchBand },
    typical: { label: t('pool.day_typical'), swatch: styles.swatchTypical },
    busy: { label: t('pool.day_busy'), swatch: styles.swatchBand },
  };
  const readout = hoverMs === null ? null : chartReadout(series, scale, hoverMs, showFable);

  return (
    <section className={styles.card} aria-labelledby="pool-chart-title">
      <div className={styles.head}>
        <h2 id="pool-chart-title" className={styles.title}>
          {t('pool.chart_title')}
        </h2>
        <ToggleSwitch
          checked={showFable}
          onChange={setShowFable}
          label={t('pool.show_fable')}
          labelPosition="left"
        />
      </div>

      <ul className={styles.legend}>
        <li>
          <span className={`${styles.key} ${styles.swatchPast}`} aria-hidden="true" />
          {t('pool.legend_past')}
        </li>
        {series.projection ? (
          <>
            <li>
              <span className={`${styles.key} ${styles.swatchTypical}`} aria-hidden="true" />
              {t('pool.legend_typical')}
            </li>
            <li>
              <span className={`${styles.keyBox} ${styles.swatchBand}`} aria-hidden="true" />
              {t('pool.legend_band')}
            </li>
          </>
        ) : null}
        {showFable ? (
          <li>
            <span className={`${styles.key} ${styles.swatchFable}`} aria-hidden="true" />
            {t('pool.legend_fable')}
          </li>
        ) : null}
      </ul>

      <div className={styles.frame}>
        <div className={styles.yAxis} aria-hidden="true">
          {yTicks.map((value) => (
            <span key={value} style={{ top: percentY(value) }}>
              {value}
            </span>
          ))}
        </div>
        <div
          className={styles.plot}
          role="img"
          aria-label={`${t('pool.chart_label')} ${summary}`}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverMs(null)}
          onKeyDown={handleKeyDown}
          onBlur={() => setHoverMs(null)}
        >
          <svg
            className={styles.svg}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {yTicks.map((value) => (
              <line
                key={value}
                className={styles.grid}
                x1={0}
                x2={CHART_WIDTH}
                y1={scale.y(value)}
                y2={scale.y(value)}
              />
            ))}
            {series.projection ? (
              <>
                <path
                  className={styles.band}
                  d={bandPath(series.projection.quiet, series.projection.busy, scale)}
                />
                <path className={styles.typical} d={linePath(series.projection.typical, scale)} />
              </>
            ) : null}
            <path className={styles.past} d={linePath(series.history, scale)} />
            {showFable ? <path className={styles.fable} d={linePath(series.fable, scale)} /> : null}
            <line
              className={styles.now}
              x1={scale.x(scale.nowMs)}
              x2={scale.x(scale.nowMs)}
              y1={0}
              y2={CHART_HEIGHT}
            />
            {readout ? (
              <line
                className={styles.crosshair}
                x1={scale.x(readout.atMs)}
                x2={scale.x(readout.atMs)}
                y1={0}
                y2={CHART_HEIGHT}
              />
            ) : null}
          </svg>

          <span className={styles.nowLabel} style={{ left: percentX(scale.nowMs) }}>
            {t('pool.now')}
          </span>

          {markers.map((marker) => (
            <span
              key={`${marker.email}-${marker.atMs}`}
              className={styles.marker}
              style={{ left: percentX(marker.atMs) }}
              title={t('pool.reset_marker', {
                email: marker.email,
                when: formatDayHour(marker.atMs, locale),
              })}
            />
          ))}

          {readout ? (
            <div
              className={styles.tooltip}
              data-side={scale.x(readout.atMs) > CHART_WIDTH * 0.6 ? 'left' : 'right'}
              style={{ left: percentX(readout.atMs) }}
              role="status"
            >
              <div className={styles.tooltipTime}>{formatDayHour(readout.atMs, locale)}</div>
              {readout.rows.length === 0 ? (
                <div className={styles.tooltipEmpty}>{t('pool.no_point')}</div>
              ) : (
                readout.rows.map((row) => (
                  <div key={row.key} className={styles.tooltipRow}>
                    <span
                      className={`${styles.key} ${rowStyle[row.key].swatch}`}
                      aria-hidden="true"
                    />
                    <strong>{formatAccounts(row.value)}</strong>
                    <span>{rowStyle[row.key].label}</span>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              data-odd={index % 2 === 1 ? 'true' : undefined}
              style={{ left: percentX(tick) }}
            >
              {formatDayLabel(tick, locale)}
            </span>
          ))}
        </div>
      </div>
      <p className={styles.caption}>{t('pool.chart_caption')}</p>
    </section>
  );
}
