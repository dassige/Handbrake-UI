import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, Table2, BarChart3 } from 'lucide-react';
import { api } from '../api.js';
import { bytes, fileName, humanDuration } from '../format.js';
import { Help } from '../help/Help.jsx';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
  { days: 0, label: 'All time' },
];

const nf = new Intl.NumberFormat();
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function bucketLabel(key, bucket, short) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d ?? 1);
  if (bucket === 'month') return date.toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  return date.toLocaleDateString(undefined, short ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
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

  const t = stats?.totals;
  const checks = stats?.checks ?? {};
  const checked = (checks.ok ?? 0) + (checks.warning ?? 0) + (checks.error ?? 0);

  return (
    <main className="page stats-page">
      <section className="page-body">
        <div className="page-content wide">
          <header className="page-head stats-head">
            <h1>Stats<Help id="stats.overview" /></h1>
            <div className="seg" role="group" aria-label="Period">
              {RANGES.map((r) => (
                <button key={r.days} className={days === r.days ? 'active' : ''} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                  {r.label}
                </button>
              ))}
            </div>
          </header>

          {!stats ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="stat-tiles">
                <Tile
                  label="Files converted"
                  value={nf.format(t.done)}
                  sub={[t.failed ? `${t.failed} failed` : null, t.cancelled ? `${t.cancelled} cancelled` : null, stats.watched ? `${stats.watched} from watch folders` : null].filter(Boolean).join(' · ') || 'none failed'}
                />
                <Tile label="Space saved" value={bytes(t.savedBytes)} sub={t.reduction != null ? `${pct(t.reduction)} smaller · ${bytes(t.sourceBytes)} → ${bytes(t.outputBytes)}` : '—'} />
                <Tile label="Video converted" value={humanDuration(t.mediaSeconds)} sub={`in ${humanDuration(t.encodeSeconds)} of work`} />
                <Tile label="Speed" value={t.speed ? `${t.speed.toFixed(2)}×` : '—'} sub={t.avgFps ? `real time · ${Math.round(t.avgFps)} fps on average` : 'real time'} />
              </div>

              <section className="set-card">
                <header className="set-card-head">
                  <h3>Files converted per {stats.bucket}</h3>
                  <button className="btn small ghost" onClick={() => setAsTable((x) => !x)} aria-pressed={asTable}>
                    {asTable ? <><BarChart3 size={14} /> Chart</> : <><Table2 size={14} /> Table</>}
                  </button>
                </header>
                <div className="set-card-body">
                  {t.done + t.failed === 0 ? (
                    <p className="set-hint">Nothing converted in this period.</p>
                  ) : asTable ? (
                    <SeriesTable series={stats.series} bucket={stats.bucket} />
                  ) : (
                    <ColumnChart series={stats.series} bucket={stats.bucket} />
                  )}
                </div>
              </section>

              <div className="stats-grid">
                <section className="set-card">
                  <header className="set-card-head"><h3>Check after conversion<Help id="verify.results" /></h3></header>
                  <div className="set-card-body">
                    {checked === 0 ? (
                      <p className="set-hint">No checked files in this period.</p>
                    ) : (
                      <>
                        <div className="segbar" role="img" aria-label={`${checks.ok ?? 0} passed, ${checks.warning ?? 0} with warnings, ${checks.error ?? 0} failed`}>
                          {['ok', 'warning', 'error'].map((k) => checks[k] ? <span key={k} className={`segbar-part ${k}`} style={{ flexGrow: checks[k] }} /> : null)}
                        </div>
                        <ul className="legend-list">
                          <li><CheckCircle2 size={14} className="text-good" /> Checked <strong>{checks.ok ?? 0}</strong></li>
                          <li><CircleAlert size={14} className="text-warn" /> Warnings <strong>{checks.warning ?? 0}</strong></li>
                          <li><CircleX size={14} className="text-bad" /> Failed <strong>{checks.error ?? 0}</strong></li>
                        </ul>
                        {(checks.off || checks.skipped) && (
                          <p className="set-hint">{(checks.off ?? 0) + (checks.skipped ?? 0)} converted without a check.</p>
                        )}
                      </>
                    )}
                  </div>
                </section>

                <section className="set-card">
                  <header className="set-card-head"><h3>Biggest savings</h3></header>
                  <div className="set-card-body">
                    {stats.top.length === 0 ? (
                      <p className="set-hint">Nothing yet.</p>
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
                <header className="set-card-head"><h3>By preset</h3></header>
                <div className="set-card-body table-scroll">
                  {stats.presets.length === 0 ? (
                    <p className="set-hint">Nothing yet.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Preset</th><th className="num">Converted</th><th className="num">Failed</th><th className="num">Video</th>
                          <th className="num">Work</th><th className="num">Speed</th><th className="num">Avg fps</th><th className="num">Saved</th><th className="num">Smaller</th>
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
                            <td className="num">{p.speed ? `${p.speed.toFixed(2)}×` : '—'}</td>
                            <td className="num">{p.avgFps ? Math.round(p.avgFps) : '—'}</td>
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
                <p className="set-hint">
                  History since {new Date(stats.firstAt).toLocaleDateString()}. Clearing jobs from the queue does not remove them
                  from these figures.
                </p>
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
          <tr><th>{bucket === 'month' ? 'Month' : 'Day'}</th><th className="num">Converted</th><th className="num">Failed</th><th className="num">Saved</th><th className="num">Work</th></tr>
        </thead>
        <tbody>
          {series.filter((s) => s.done || s.failed).map((s) => (
            <tr key={s.key}>
              <td>{bucketLabel(s.key, bucket)}</td>
              <td className="num">{s.done}</td>
              <td className="num">{s.failed || '—'}</td>
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
      <svg width={width} height={height} role="img" aria-label={`Files converted per ${bucket}`}>
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
              aria-label={`${bucketLabel(s.key, bucket)}: ${s.done} converted`}
            />
          </g>
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(h.x + barW / 2, 90), width - 90), top: Math.max(0, y(h.s.done) - 8) }}>
          <strong>{bucketLabel(h.s.key, bucket)}</strong>
          <span>{h.s.done} converted{h.s.failed ? ` · ${h.s.failed} failed` : ''}</span>
          {h.s.done > 0 && <span className="muted">{bytes(h.s.savedBytes)} saved · {humanDuration(h.s.encodeSeconds)} of work</span>}
        </div>
      )}
    </div>
  );
}
