import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Gauge, ListPlus, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser, browserRoots } from '../components/SourceBrowser.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { bytes, dateTime, dirName, duration, fileName, relTo } from '../format.js';
import { Help } from '../help/Help.jsx';

const KINDS = [
  { id: 'format', label: 'Old format' },
  { id: 'resolution', label: 'Low resolution' },
  { id: 'bitrate', label: 'Low bitrate' },
  { id: 'interlaced', label: 'Interlaced' },
  { id: 'error', label: 'Unreadable' },
];

const SORTS = {
  name: (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }),
  height: (a, b) => (a.video?.height ?? 0) - (b.video?.height ?? 0),
  kbps: (a, b) => (a.video?.kbps ?? 0) - (b.video?.kbps ?? 0),
  size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  issues: (a, b) => a.issues.length - b.issues.length,
};

const PAGE = 500;

function videoText(f) {
  if (f.error) return '—';
  if (!f.video) return 'no video';
  return `${f.video.codec} · ${f.video.width}×${f.video.height}${f.video.fps ? ` · ${f.video.fps} fps` : ''}`;
}

function csv(rows, roots) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Path', 'Folder', 'Container', 'Video codec', 'Width', 'Height', 'Video kbps', 'Audio', 'Length', 'Size bytes', 'Issues'];
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
    f.issues.map((i) => i.text).join('; '),
  ].map(q).join(','));
  return [head.map(q).join(','), ...lines].join('\r\n');
}

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
      title: 'Delete result',
      message: 'Delete this quality check result? The files are not touched.',
      confirmLabel: 'Delete',
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

  return (
    <main className="panes quality-panes">
      <SourceBrowser
        settings={settings}
        changeTick={changeTick}
        onAdd={start}
        onError={onError}
        root="any"
        title="Folders"
        addLabel="Check quality"
        help="quality.folders"
        hint="Select folders or files and press Check quality; sub-folders are included."
      />
      <section className="pane quality">
        <div className="pane-head">
          <h2>Quality check<Help id="quality.overview" /></h2>
          <div className="pane-tools">
            {scans.length > 0 && (
              <label className="field-inline">
                Result
                <select value={effectiveId ?? ''} onChange={(e) => setScanId(Number(e.target.value))}>
                  {scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {dateTime(s.createdAt)} · {s.paths.map((p) => fileName(p) || p).join(', ').slice(0, 60)}
                      {s.status === 'running' ? ' (running)' : s.status !== 'done' ? ` (${s.status})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {meta && !running && (
              <button className="icon-btn danger" title="Delete this result" onClick={remove}>
                <Trash2 size={16} />
              </button>
            )}
            <button className="btn ghost small" onClick={onOpenSettings} title="Change what counts as low quality">
              <Gauge size={14} /> Criteria
            </button>
          </div>
        </div>

        {!meta && (
          <div className="drop-hint">
            <Gauge size={28} />
            <p>Choose folders on the left and press <strong>Check quality</strong>.</p>
            <p className="small">
              Every video inside them (sub-folders included) is read with ffprobe and compared with the criteria in Settings.
            </p>
          </div>
        )}

        {meta && (
          <>
            <div className="quality-summary">
              <div className="small">
                <span className="muted">Checked: </span>
                {meta.paths.map((p) => <code key={p} className="path">{p}</code>)}
              </div>
              {running && (
                <>
                  <div className="progress big">
                    <div className="bar" style={{ width: `${meta.total ? (meta.scanned / meta.total) * 100 : 0}%` }} />
                    <span>{meta.total == null ? 'Listing files…' : `${meta.scanned} of ${meta.total} files`}</span>
                  </div>
                  <div className="quality-current small muted">
                    <span className="file-name">{meta.current ?? ''}</span>
                    <button className="btn small danger" onClick={() => run(() => api.cancelQualityScan(meta.id))}>
                      <Square size={13} /> Stop
                    </button>
                  </div>
                </>
              )}
              {!running && (
                <p className="small">
                  {meta.status === 'failed' && <span className="text-bad">Failed: {meta.error}. </span>}
                  {meta.status === 'cancelled' && <span className="warn-text">Stopped{meta.error ? ` (${meta.error})` : ''}; showing the files checked so far. </span>}
                  {scan && (
                    <>
                      <strong>{counts.flagged}</strong> of {counts.all} files need attention · checked {dateTime(meta.finishedAt)}
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="filters">
              {[{ id: 'flagged', label: 'Need attention' }, { id: 'all', label: 'All' }, ...KINDS].map((k) => (
                (k.id === 'all' || k.id === 'flagged' || counts[k.id] > 0) && (
                  <button key={k.id} className={`chip ${filter === k.id ? 'active' : ''}`} onClick={() => setFilter(k.id)}>
                    {k.label} <span className="chip-count">{counts[k.id] ?? 0}</span>
                  </button>
                )
              ))}
              <span className="spacer" />
              <input className="quality-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name" />
            </div>

            <div className="rename-list">
              {rows.length === 0 && (
                <p className="empty">{!scan ? 'Loading…' : results.length ? 'No files match this filter.' : running ? 'No files checked yet.' : 'No video files found.'}</p>
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
                          aria-label="Select all"
                        />
                      </th>
                      <th>{sortHead('name', 'File')}</th>
                      <th>{sortHead('height', 'Video')}</th>
                      <th className="num">{sortHead('kbps', 'kbps')}</th>
                      <th className="num">{sortHead('size', 'Size')}</th>
                      <th>{sortHead('issues', 'Issues')}<Help id="quality.issues" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((f) => {
                      const root = rootOf(f.path);
                      return (
                        <tr key={f.path} className={selected.has(f.path) ? 'ticked' : ''} onClick={() => toggle(f.path)}>
                          <td>
                            <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${fileName(f.path)}`} />
                          </td>
                          <td className="names">
                            <div className="q-name" title={f.path}>
                              {fileName(f.path)}
                              {f.job && <StatusBadge status={f.job} />}
                            </div>
                            <div className="old-name" title={f.path}>
                              {dirName(f.path) === root ? root : <>{relTo(root, dirName(f.path))} <span className="muted">· {root}</span></>}
                            </div>
                          </td>
                          <td className="small nowrap">
                            {videoText(f)}
                            {f.audio?.length > 0 && <div className="muted">{f.audio.map((a) => a.codec).join(', ')}{f.duration ? ` · ${duration(f.duration)}` : ''}</div>}
                          </td>
                          <td className="num small">
                            {f.video?.kbps ?? '—'}
                            {f.video?.kbpsEstimated && <span className="muted" title="Estimated from the file size"> ~</span>}
                          </td>
                          <td className="num small nowrap">{bytes(f.size)}</td>
                          <td>
                            <div className="q-issues">
                              {f.issues.length === 0 && <span className="badge done">OK</span>}
                              {f.issues.map((i) => (
                                <span key={i.text} className={`badge q-${i.kind}`}>{i.text}</span>
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
                  Showing {shown} of {rows.length}.{' '}
                  <button className="link" onClick={() => setShown((n) => n + PAGE)}>Show more</button>
                </p>
              )}
            </div>

            <div className="rename-foot">
              <span className="muted small">{selected.size ? `${selectedRows.length} selected` : `${rows.length} file${rows.length === 1 ? '' : 's'}`}</span>
              <span className="spacer" />
              <button className="btn small" disabled={!rows.length} onClick={exportCsv} title="Download the selected files (or all those listed) as a spreadsheet">
                <Download size={14} /> Export CSV
              </button>
              <button
                className="btn primary small"
                disabled={!queueable.length}
                title={selectedRows.length && !queueable.length ? 'Only files in a sources folder can be converted' : 'Convert the selected files with the chosen preset'}
                onClick={() => onAddToQueue(queueable.map((f) => f.path))}
              >
                <ListPlus size={14} /> Add to queue{queueable.length ? ` (${queueable.length})` : ''}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
