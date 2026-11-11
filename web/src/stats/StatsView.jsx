import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, Table2, BarChart3 } from 'lucide-react';
import { api } from '../api.js';
import { bytes, fileName, humanDuration } from '../format.js';
import { Help } from '../help/Help.jsx';
import { intlLocale, t } from '../i18n/index.js';

const RANGES = [
  { days: 7, labelKey: 'stats.ranges.days7' },
  { days: 30, labelKey: 'stats.ranges.days30' },
  { days: 90, labelKey: 'stats.ranges.days90' },
  { days: 365, labelKey: 'stats.ranges.months12' },
  { days: 0, labelKey: 'stats.ranges.allTime' },
];

// Number formats for the current language (made when first used, then kept).
const formats = new Map();
function numberFormat(options = {}) {
  const id = `${intlLocale()} ${JSON.stringify(options)}`;
  if (!formats.has(id)) formats.set(id, new Intl.NumberFormat(intlLocale(), options));
  return formats.get(id);
}
const nf = { format: (n) => numberFormat().format(n) };
const pct = (x) => (x == null ? '—' : numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(x));
const speedText = (x) => `${numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x)}×`;

function bucketLabel(key, bucket, short) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d ?? 1);
  if (bucket === 'month') return date.toLocaleDateString(intlLocale(), short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  return date.toLocaleDateString(intlLocale(), short ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
}

/** What the server converted: totals, per day/month, per preset. */
export function StatsView({ changeTick, onError }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    let live = true;
    api.stats(days).then((s) => live && setStats(s), (e) => live && onError(e));
    return () => {
      live = false;
    };
  }, [days, changeTick, onError]);

  const tot = stats?.totals;
  const checks = stats?.checks ?? {};
  const checked = (checks.ok ?? 0) + (checks.warning ?? 0) + (checks.error ?? 0);

  return (
    <main className="page stats-page">
      <section className="page-body">
        <div className="page-content wide">
          <header className="page-head stats-head">
            <h1>{t('stats.title')}<Help id="stats.overview" /></h1>
            <div className="seg" role="group" aria-label={t('stats.period')}>
              {RANGES.map((r) => (
                <button key={r.days} className={days === r.days ? 'active' : ''} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                  {t(r.labelKey)}
                </button>
              ))}
            </div>
          </header>

          {!stats ? (
            <p className="muted">{t('common.loading')}</p>
          ) : (
            <>
              <div className="stat-tiles">
                <Tile
                  label={t('stats.tiles.filesConverted')}
                  value={nf.format(tot.done)}
                  sub={[
                    tot.failed ? t('stats.tiles.failed', { count: tot.failed }) : null,
                    tot.cancelled ? t('stats.tiles.cancelled', { count: tot.cancelled }) : null,
                    stats.watched ? t('stats.tiles.watched', { count: stats.watched }) : null,
                  ].filter(Boolean).join(' · ') || t('stats.tiles.noneFailed')}
                />
                <Tile
                  label={t('stats.tiles.spaceSaved')}
                  value={bytes(tot.savedBytes)}
                  sub={tot.reduction != null ? t('stats.tiles.smaller', { percent: pct(tot.reduction), source: bytes(tot.sourceBytes), output: bytes(tot.outputBytes) }) : '—'}
                />
                <Tile label={t('stats.tiles.videoConverted')} value={humanDuration(tot.mediaSeconds)} sub={t('stats.tiles.ofWork', { time: humanDuration(tot.encodeSeconds) })} />
                <Tile
                  label={t('stats.tiles.speed')}
                  value={tot.speed ? speedText(tot.speed) : '—'}
                  sub={tot.avgFps ? t('stats.tiles.realTimeFps', { fps: nf.format(Math.round(tot.avgFps)) }) : t('stats.tiles.realTime')}
                />
              </div>

              <section className="set-card">
                <header className="set-card-head">
                  <h3>{t(`stats.perBucket.${stats.bucket}`)}</h3>
                  <button className="btn small ghost" onClick={() => setAsTable((x) => !x)} aria-pressed={asTable}>
                    {asTable ? <><BarChart3 size={14} /> {t('stats.chart')}</> : <><Table2 size={14} /> {t('stats.table')}</>}
                  </button>
                </header>
                <div className="set-card-body">
                  {tot.done + tot.failed === 0 ? (
                    <p className="set-hint">{t('stats.nothingConverted')}</p>
                  ) : asTable ? (
                    <SeriesTable series={stats.series} bucket={stats.bucket} />
                  ) : (
                    <ColumnChart series={stats.series} bucket={stats.bucket} />
                  )}
                </div>
              </section>

              <div className="stats-grid">
                <section className="set-card">
                  <header className="set-card-head"><h3>{t('stats.checks.title')}<Help id="verify.results" /></h3></header>
                  <div className="set-card-body">
                    {checked === 0 ? (
                      <p className="set-hint">{t('stats.checks.none')}</p>
                    ) : (
                      <>
                        <div className="segbar" role="img" aria-label={t('stats.checks.summary', { ok: checks.ok ?? 0, warning: checks.warning ?? 0, error: checks.error ?? 0 })}>
                          {['ok', 'warning', 'error'].map((k) => checks[k] ? <span key={k} className={`segbar-part ${k}`} style={{ flexGrow: checks[k] }} /> : null)}
                        </div>
                        <ul className="legend-list">
                          <li><CheckCircle2 size={14} className="text-good" /> {t('stats.checks.ok')} <strong>{checks.ok ?? 0}</strong></li>
                          <li><CircleAlert size={14} className="text-warn" /> {t('stats.checks.warning')} <strong>{checks.warning ?? 0}</strong></li>
                          <li><CircleX size={14} className="text-bad" /> {t('stats.checks.error')} <strong>{checks.error ?? 0}</strong></li>
                        </ul>
                        {(checks.off || checks.skipped) && (
                          <p className="set-hint">{t('stats.checks.unchecked', { count: (checks.off ?? 0) + (checks.skipped ?? 0) })}</p>
                        )}
                      </>
                    )}
                  </div>
                </section>

                <section className="set-card">
                  <header className="set-card-head"><h3>{t('stats.biggestSavings')}</h3></header>
                  <div className="set-card-body">
                    {stats.top.length === 0 ? (
                      <p className="set-hint">{t('stats.nothingYet')}</p>
                    ) : (
                      <ol className="top-list">
                        {stats.top.map((x) => (
                          <li key={x.path + x.saved} title={x.path}>
                            <span className="file-name">{fileName(x.path)}</span>
                            <span className="muted small">{bytes(x.sourceSize)} → {bytes(x.outputSize)}</span>
                            <strong className="small">−{bytes(x.saved)}</strong>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </section>
              </div>

              <section className="set-card">
                <header className="set-card-head"><h3>{t('stats.byPreset')}</h3></header>
                <div className="set-card-body table-scroll">
                  {stats.presets.length === 0 ? (
                    <p className="set-hint">{t('stats.nothingYet')}</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('stats.columns.preset')}</th>
                          <th className="num">{t('stats.columns.converted')}</th>
                          <th className="num">{t('stats.columns.failed')}</th>
                          <th className="num">{t('stats.columns.video')}</th>
                          <th className="num">{t('stats.columns.work')}</th>
                          <th className="num">{t('stats.columns.speed')}</th>
                          <th className="num">{t('stats.columns.avgFps')}</th>
                          <th className="num">{t('stats.columns.saved')}</th>
                          <th className="num">{t('stats.columns.smaller')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.presets.map((p) => (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td className="num">{nf.format(p.done)}</td>
                            <td className="num">{p.failed ? nf.format(p.failed) : '—'}</td>
                            <td className="num">{humanDuration(p.mediaSeconds)}</td>
                            <td className="num">{humanDuration(p.encodeSeconds)}</td>
                            <td className="num">{p.speed ? speedText(p.speed) : '—'}</td>
                            <td className="num">{p.avgFps ? nf.format(Math.round(p.avgFps)) : '—'}</td>
                            <td className="num">{bytes(p.savedBytes)}</td>
                            <td className="num">{pct(p.reduction)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
              {stats.firstAt && (
                <p className="set-hint">{t('stats.historySince', { date: new Date(stats.firstAt).toLocaleDateString(intlLocale()) })}</p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function SeriesTable({ series, bucket }) {
  return (
    <div className="table-scroll short">
      <table className="data-table">
        <thead>
          <tr>
            <th>{bucket === 'month' ? t('stats.columns.month') : t('stats.columns.day')}</th>
            <th className="num">{t('stats.columns.converted')}</th>
            <th className="num">{t('stats.columns.failed')}</th>
            <th className="num">{t('stats.columns.saved')}</th>
            <th className="num">{t('stats.columns.work')}</th>
          </tr>
        </thead>
        <tbody>
          {series.filter((s) => s.done || s.failed).map((s) => (
            <tr key={s.key}>
              <td>{bucketLabel(s.key, bucket)}</td>
              <td className="num">{nf.format(s.done)}</td>
              <td className="num">{s.failed ? nf.format(s.failed) : '—'}</td>
              <td className="num">{bytes(s.savedBytes)}</td>
              <td className="num">{humanDuration(s.encodeSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Clean tick step for a max value: 1, 2, 5 × 10^n. */
function niceStep(max, count = 4) {
  const raw = Math.max(1, max) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

/** One series of columns with a hover tooltip; inline SVG, sized to its container. */
function ColumnChart({ series, bucket }) {
  const box = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 36 };
  const max = Math.max(1, ...series.map((s) => s.done));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const band = plotW / series.length;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  // About one label per 70px.
  const every = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(plotW / 70))));

  const columns = useMemo(() => series.map((s, i) => {
    const x = pad.left + i * band + (band - barW) / 2;
    const h = (s.done / top) * plotH;
    const r = Math.min(4, barW / 2, h);
    const y0 = pad.top + plotH;
    // Rounded at the data end, square at the baseline.
    const d = h <= 0 ? null : `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`;
    return { s, i, x, d };
  }), [series, band, barW, top, plotH, pad.left, pad.top]);

  const h = hover != null ? columns[hover] : null;
  return (
    <div className="chart" ref={box} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={t(`stats.perBucket.${bucket}`)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={pad.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="chart-tick">{nf.format(v)}</text>
          </g>
        ))}
        {columns.map(({ s, i, x, d }) => (
          <g key={s.key}>
            {d && <path d={d} className={`chart-col ${hover != null && hover !== i ? 'dim' : ''}`} />}
            {i % every === 0 && (
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="chart-tick">{bucketLabel(s.key, bucket, true)}</text>
            )}
            <rect
              x={pad.left + i * band}
              y={pad.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={s.done || s.failed ? 0 : -1}
              aria-label={t('stats.tip.column', { date: bucketLabel(s.key, bucket), count: s.done })}
            />
          </g>
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(h.x + barW / 2, 90), width - 90), top: Math.max(0, y(h.s.done) - 8) }}>
          <strong>{bucketLabel(h.s.key, bucket)}</strong>
          <span>{h.s.failed ? t('stats.tip.convertedFailed', { count: h.s.done, failed: h.s.failed }) : t('stats.tip.converted', { count: h.s.done })}</span>
          {h.s.done > 0 && <span className="muted">{t('stats.tip.savedWork', { saved: bytes(h.s.savedBytes), time: humanDuration(h.s.encodeSeconds) })}</span>}
        </div>
      )}
    </div>
  );
}
