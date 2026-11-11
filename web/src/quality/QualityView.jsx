import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePaneSwitch } from '../components/PaneSwitch.jsx';
import { ArrowDown, ArrowUp, Download, Gauge, ListPlus, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser, browserRoots } from '../components/SourceBrowser.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { bytes, dateTime, dirName, duration, fileName, relTo } from '../format.js';
import { Help } from '../help/Help.jsx';
import { intlLocale, rich, t } from '../i18n/index.js';
import { qualityIssue } from '../i18n/serverText.js';
import { rootLabel } from '../roots.js';

const KINDS = [
  { id: 'format', labelKey: 'quality.kinds.format' },
  { id: 'resolution', labelKey: 'quality.kinds.resolution' },
  { id: 'bitrate', labelKey: 'quality.kinds.bitrate' },
  { id: 'interlaced', labelKey: 'quality.kinds.interlaced' },
  { id: 'error', labelKey: 'quality.kinds.error' },
];

const SORTS = {
  name: (a, b) => a.path.localeCompare(b.path, intlLocale(), { numeric: true, sensitivity: 'base' }),
  height: (a, b) => (a.video?.height ?? 0) - (b.video?.height ?? 0),
  kbps: (a, b) => (a.video?.kbps ?? 0) - (b.video?.kbps ?? 0),
  size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  issues: (a, b) => a.issues.length - b.issues.length,
};

const PAGE = 500;

function videoText(f) {
  if (f.error) return '—';
  if (!f.video) return t('quality.noVideo');
  return `${f.video.codec} · ${f.video.width}×${f.video.height}${f.video.fps ? ` · ${f.video.fps} fps` : ''}`;
}

function csv(rows, roots) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['path', 'folder', 'container', 'videoCodec', 'width', 'height', 'videoKbps', 'audio', 'length', 'sizeBytes', 'issues']
    .map((k) => t(`quality.csv.${k}`));
  const lines = rows.map((f) => [
    f.path,
    roots.find((r) => f.path.startsWith(r)) ?? '',
    f.container,
    f.video?.codec,
    f.video?.width,
    f.video?.height,
    f.video?.kbps,
    (f.audio ?? []).map((a) => `${a.codec}${a.channels ? ` ${a.channels}ch` : ''}`).join(' + '),
    f.duration ? duration(f.duration) : '',
    f.size,
    f.issues.map(qualityIssue).join('; '),
  ].map(q).join(','));
  return [head.map(q).join(','), ...lines].join('\r\n');
}

/** A scan's error: the server's own English one for a restart is shown translated. */
const scanError = (e) => (e === 'Interrupted by a restart' ? t('quality.interrupted') : e);

/** Finds old formats, low resolutions and low bitrates in the chosen folders. */
export function QualityView({ settings, scans, tick, changeTick, run, onError, onAddToQueue, onOpenSettings }) {
  const dialogs = useDialogs();
  const [scanId, setScanId] = useState(null);
  const [scan, setScan] = useState(null);
  const [filter, setFilter] = useState('flagged');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState(() => new Set());
  const [shown, setShown] = useState(PAGE);
  const roots = browserRoots(settings, 'any');

  const effectiveId = scanId ?? scans[0]?.id ?? null;
  const meta = scans.find((s) => s.id === effectiveId) ?? null;
  const running = meta?.status === 'running';
  const criteriaKey = JSON.stringify(settings?.quality ?? null);

  const load = useCallback(async () => {
    if (effectiveId == null) {
      setScan(null);
      return;
    }
    try {
      setScan(await api.qualityScan(effectiveId));
    } catch (e) {
      onError(e);
    }
  }, [effectiveId, onError]);

  // Reload when another scan is chosen, a scan finishes, the criteria change or job badges change.
  useEffect(() => {
    load();
  }, [load, tick, criteriaKey, changeTick]);
  // Partial results while it runs.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    setSelected(new Set());
    setShown(PAGE);
  }, [effectiveId, filter, search]);

  async function start(paths) {
    const r = await run(() => api.startQualityScan(paths));
    if (r) {
      setScanId(r.id);
      setFilter('flagged');
    }
  }

  async function remove() {
    if (!meta) return;
    const ok = await dialogs.confirm({
      title: t('quality.deleteTitle'),
      message: t('quality.deleteMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await run(() => api.removeQualityScan(meta.id)))) setScanId(null);
  }

  const results = scan?.results ?? [];
  const counts = useMemo(() => {
    const c = { all: results.length, flagged: 0 };
    for (const k of KINDS) c[k.id] = 0;
    for (const f of results) {
      if (f.issues.length) c.flagged++;
      for (const k of new Set(f.issues.map((i) => i.kind))) c[k]++;
    }
    return c;
  }, [results]);

  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const list = results.filter((f) => {
      if (filter === 'flagged' && !f.issues.length) return false;
      if (KINDS.some((k) => k.id === filter) && !f.issues.some((i) => i.kind === filter)) return false;
      const name = f.path.toLowerCase();
      return words.every((w) => name.includes(w));
    });
    return list.sort((a, b) => SORTS[sort.key](a, b) * sort.dir || SORTS.name(a, b));
  }, [results, filter, search, sort]);

  const selectedRows = rows.filter((f) => selected.has(f.path));
  const queueable = selectedRows.filter((f) => f.inSource);
  const allTicked = rows.length > 0 && rows.every((f) => selected.has(f.path));

  const toggle = (p) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });

  function exportCsv() {
    const blob = new Blob([`﻿${csv(selectedRows.length ? selectedRows : rows, roots)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quality-check-${meta?.id ?? ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const sortHead = (key, label) => (
    <button className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
      {label}
      {sort.key === key && (sort.dir > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
  const rootOf = (p) => roots.filter((r) => p === r || p.startsWith(`${r}/`) || p.startsWith(`${r}\\`)).sort((a, b) => b.length - a.length)[0];

  const [paneClass, paneSwitch, showPane] = usePaneSwitch([t('quality.folders'), t('quality.results')]);

  return (
    <main className={`panes quality-panes ${paneClass}`}>
      {paneSwitch}
      <SourceBrowser
        settings={settings}
        changeTick={changeTick}
        onAdd={(list) => {
          start(list);
          showPane(1);
        }}
        onError={onError}
        root="any"
        title={t('quality.folders')}
        addLabel={t('quality.checkQuality')}
        addTitle={t('quality.checkQualityTitle')}
        help="quality.folders"
        hint={t('quality.browserHint')}
      />
      <section className="pane quality">
        <div className="pane-head">
          <h2>{t('quality.title')}<Help id="quality.overview" /></h2>
          <div className="pane-tools">
            {scans.length > 0 && (
              <label className="field-inline">
                {t('quality.result')}
                <select value={effectiveId ?? ''} onChange={(e) => setScanId(Number(e.target.value))}>
                  {scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {dateTime(s.createdAt)} · {s.paths.map((p) => fileName(p) || p).join(', ').slice(0, 60)}
                      {s.status !== 'done' ? ` (${t(`quality.scanStatus.${s.status}`)})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {meta && !running && (
              <button className="icon-btn danger" title={t('quality.deleteResult')} onClick={remove}>
                <Trash2 size={16} />
              </button>
            )}
            <button className="btn ghost small" onClick={onOpenSettings} title={t('quality.criteriaTitle')}>
              <Gauge size={14} /> {t('quality.criteria')}
            </button>
          </div>
        </div>

        {!meta && (
          <div className="drop-hint">
            <Gauge size={28} />
            <p>{rich('quality.emptyHint')}</p>
            <p className="small">{t('quality.emptyDetail')}</p>
          </div>
        )}

        {meta && (
          <>
            <div className="quality-summary">
              <div className="small">
                <span className="muted">{t('quality.checked')} </span>
                {meta.paths.map((p) => <code key={p} className="path">{p}</code>)}
              </div>
              {running && (
                <>
                  <div className="progress big">
                    <div className="bar" style={{ width: `${meta.total ? (meta.scanned / meta.total) * 100 : 0}%` }} />
                    <span>{meta.total == null ? t('quality.listing') : t('quality.progress', { scanned: meta.scanned, count: meta.total })}</span>
                  </div>
                  <div className="quality-current small muted">
                    {/* While listing, the server's "current" is its own English "Listing files…": the bar says it already. */}
                    <span className="file-name">{meta.total == null ? '' : meta.current ?? ''}</span>
                    <button className="btn small danger" onClick={() => run(() => api.cancelQualityScan(meta.id))}>
                      <Square size={13} /> {t('common.stop')}
                    </button>
                  </div>
                </>
              )}
              {!running && (
                <p className="small">
                  {meta.status === 'failed' && <span className="text-bad">{t('quality.failed', { error: scanError(meta.error) })} </span>}
                  {meta.status === 'cancelled' && (
                    <span className="warn-text">
                      {meta.error ? t('quality.stoppedWhy', { reason: scanError(meta.error) }) : t('quality.stopped')}{' '}
                    </span>
                  )}
                  {scan && rich('quality.summary', { flagged: counts.flagged, count: counts.all, date: dateTime(meta.finishedAt) })}
                </p>
              )}
            </div>

            <div className="filters">
              {[{ id: 'flagged', labelKey: 'quality.needAttention' }, { id: 'all', labelKey: 'quality.all' }, ...KINDS].map((k) => (
                (k.id === 'all' || k.id === 'flagged' || counts[k.id] > 0) && (
                  <button key={k.id} className={`chip ${filter === k.id ? 'active' : ''}`} onClick={() => setFilter(k.id)}>
                    {t(k.labelKey)} <span className="chip-count">{counts[k.id] ?? 0}</span>
                  </button>
                )
              ))}
              <span className="spacer" />
              <input className="quality-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('quality.filterPlaceholder')} />
            </div>

            <div className="rename-list">
              {rows.length === 0 && (
                <p className="empty">
                  {!scan ? t('common.loading') : results.length ? t('quality.noMatch') : running ? t('quality.noneChecked') : t('quality.noVideos')}
                </p>
              )}
              {rows.length > 0 && (
                <table className="rename-table quality-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allTicked}
                          onChange={() => setSelected(allTicked ? new Set() : new Set(rows.map((f) => f.path)))}
                          aria-label={t('common.selectAll')}
                        />
                      </th>
                      <th>{sortHead('name', t('quality.columns.file'))}</th>
                      <th>{sortHead('height', t('quality.columns.video'))}</th>
                      <th className="num">{sortHead('kbps', 'kbps')}</th>
                      <th className="num">{sortHead('size', t('quality.columns.size'))}</th>
                      <th>{sortHead('issues', t('quality.columns.issues'))}<Help id="quality.issues" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((f) => {
                      const root = rootOf(f.path);
                      return (
                        <tr key={f.path} className={selected.has(f.path) ? 'ticked' : ''} onClick={() => toggle(f.path)}>
                          <td>
                            <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} onClick={(e) => e.stopPropagation()} aria-label={t('quality.selectFile', { name: fileName(f.path) })} />
                          </td>
                          <td className="names">
                            <div className="q-name" title={f.path}>
                              {fileName(f.path)}
                              {f.job && <StatusBadge status={f.job} />}
                            </div>
                            <div className="old-name" title={f.path}>
                              {dirName(f.path) === root ? rootLabel(settings, root) : <>{relTo(root, dirName(f.path))} <span className="muted" title={root}>· {rootLabel(settings, root)}</span></>}
                            </div>
                          </td>
                          <td className="small nowrap">
                            {videoText(f)}
                            {f.audio?.length > 0 && <div className="muted">{f.audio.map((a) => a.codec).join(', ')}{f.duration ? ` · ${duration(f.duration)}` : ''}</div>}
                          </td>
                          <td className="num small">
                            {f.video?.kbps ?? '—'}
                            {f.video?.kbpsEstimated && <span className="muted" title={t('quality.estimated')}> ~</span>}
                          </td>
                          <td className="num small nowrap">{bytes(f.size)}</td>
                          <td>
                            <div className="q-issues">
                              {f.issues.length === 0 && <span className="badge done">{t('common.ok')}</span>}
                              {f.issues.map((i) => (
                                <span key={i.text} className={`badge q-${i.kind}`}>{qualityIssue(i)}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {rows.length > shown && (
                <p className="empty">
                  {t('quality.showing', { shown, count: rows.length })}{' '}
                  <button className="link" onClick={() => setShown((n) => n + PAGE)}>{t('quality.showMore')}</button>
                </p>
              )}
            </div>

            <div className="rename-foot">
              <span className="muted small">{selected.size ? t('quality.selected', { count: selectedRows.length }) : t('common.files.count', { count: rows.length })}</span>
              <span className="spacer" />
              <button className="btn small" disabled={!rows.length} onClick={exportCsv} title={t('quality.exportTitle')}>
                <Download size={14} /> {t('quality.exportCsv')}
              </button>
              <button
                className="btn primary small"
                disabled={!queueable.length}
                title={selectedRows.length && !queueable.length ? t('quality.onlySources') : t('quality.convertSelected')}
                onClick={() => onAddToQueue(queueable.map((f) => f.path))}
              >
                <ListPlus size={14} /> {queueable.length ? t('quality.addToQueueCount', { count: queueable.length }) : t('quality.addToQueue')}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
