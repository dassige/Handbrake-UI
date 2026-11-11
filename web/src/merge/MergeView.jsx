import { useCallback, useEffect, useRef, useState } from 'react';
import { usePaneSwitch } from '../components/PaneSwitch.jsx';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CircleX, Combine, GripVertical, ListX, Square, Trash2, Upload, X,
} from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser, DRAG_PATHS } from '../components/SourceBrowser.jsx';
import { VerifyBadge } from '../components/StatusBadge.jsx';
import { bytes, dateTime, duration, fileName, relTo } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { t } from '../i18n/index.js';
import { checkDetail, checkLabel, mergeProblem } from '../i18n/serverText.js';
import { sortList, useRememberedSort } from '../sort.js';
import { SortControl } from '../components/SortControl.jsx';

const DRAG_PART = 'application/x-hbui-part';

// The parts' order is the merge order: 'manual' keeps the user's own (drag, arrows).
const SORT_KEYS = ['manual', 'name', 'date', 'type', 'size'];
/** The parts' paths in the chosen order. */
const orderParts = (parts, sort) => (sort.key === 'manual'
  ? parts.map((p) => p.path)
  : sortList(parts, sort, (p) => ({ name: fileName(p.path), mtime: p.mtime, size: p.size })).map((p) => p.path));

// Each status is also the badge's class; its label is merge.status.<status> (plus .verifying / .reading).
const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];

function MergeStatus({ m }) {
  if (!STATUSES.includes(m.status)) return <span className="badge">{m.status}</span>;
  let key = m.status;
  if (m.status === 'running' && m.phase === 'verifying') key = 'verifying';
  if (m.status === 'running' && m.phase === 'reading') key = 'reading';
  return <span className={`badge ${m.status}`}>{t(`merge.status.${key}`)}</span>;
}

function MergeItem({ m, settings, run }) {
  const [open, setOpen] = useState(false);
  const active = m.status === 'running' || m.status === 'queued';
  return (
    <li className={`merge-item ${m.status}`}>
      <div className="merge-item-head">
        <button className="step-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <MergeStatus m={m} />
          {m.status === 'done' && <VerifyBadge status={m.verifyStatus} />}
          <span className="merge-name" title={m.output}>{fileName(m.output)}</span>
        </button>
        <span className="job-actions">
          {active ? (
            <button className="icon-btn danger" title={t('merge.item.cancel')} onClick={() => run(() => api.mergeCancel(m.id))}><Square size={15} className="stop-icon" /></button>
          ) : (
            <button className="icon-btn" title={t('merge.item.remove')} onClick={() => run(() => api.mergeRemove(m.id))}><Trash2 size={15} /></button>
          )}
        </span>
      </div>
      {m.status === 'running' && (
        <div className={`progress ${m.phase === 'verifying' ? 'checking' : ''}`}><div className="bar" style={{ width: `${(m.progress ?? 0) * 100}%` }} /></div>
      )}
      <div className="job-meta">
        {[
          t('merge.item.parts', { count: m.parts.length }),
          m.duration ? duration(m.duration) : null,
          m.chapters != null ? t('merge.item.chapters', { count: m.chapters }) : null,
          m.outputSize ? bytes(m.outputSize) : null,
          m.partsRemoved ? t('merge.item.partsRemoved') : null,
          m.finishedAt ? dateTime(m.finishedAt) : dateTime(m.createdAt),
        ].filter(Boolean).join(' · ')}
      </div>
      {m.error && <p className="text-bad small">{m.error}</p>}
      {open && (
        <div className="merge-item-body">
          <p className="small"><span className="muted">{t('merge.item.output')}</span> <code className="path">{relTo(settings?.targetRoot, m.output)}</code></p>
          <ol className="small merge-parts-done">
            {m.parts.map((p) => <li key={p}>{relTo(settings?.targetRoot, p)}</li>)}
          </ol>
          {m.warnings.length > 0 && <ul className="warn-list">{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {m.verify?.checks?.length > 0 && (
            <ul className="checks">
              {m.verify.checks.map((c) => (
                <li key={c.id} className={c.status}>
                  <span className={`dot-status ${c.status}`} />
                  <span><strong>{checkLabel(c)}</strong> <span className="check-detail">{checkDetail(c)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function MergeView({ settings, merges, paths, setPaths, changeTick, run, onError }) {
  const dialogs = useDialogs();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chapterMode, setChapterMode] = useState('keep');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [removeParts, setRemoveParts] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [starting, setStarting] = useState(false);
  const seq = useRef(0);
  const [sort, setSort] = useRememberedSort('mergeParts', SORT_KEYS, { key: 'manual', dir: 1 });
  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Read the parts (tracks, length, chapters) whenever the list or options change.
  useEffect(() => {
    if (!paths.length) {
      setInfo(null);
      return undefined;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.mergeInspect({ paths, chapterMode, outputName: nameEdited ? name : undefined });
        if (mine !== seq.current) return;
        setInfo(r);
        if (!nameEdited) setName(r.outputName);
        // Folders are expanded into their files, in order; then the chosen sort applies.
        const files = orderParts(r.parts, sortRef.current);
        if (files.join('\n') !== paths.join('\n')) setPaths(files);
      } catch (e) {
        if (mine === seq.current) {
          onError(e);
          setInfo(null);
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, chapterMode, name, nameEdited, changeTick]);

  const addPaths = useCallback((list) => setPaths((p) => [...new Set([...p, ...list])]), [setPaths]);
  const move = (from, to) => {
    // Your own order from now on.
    if (sort.key !== 'manual') setSort({ key: 'manual', dir: sort.dir });
    setPaths((p) => {
      if (to < 0 || to >= p.length || from === to) return p;
      const next = p.slice();
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  };

  function chooseSort(next) {
    setSort(next);
    const known = info?.parts ?? [];
    // Parts not read yet are sorted when they are (the list changes, so they are read again).
    if (next.key !== 'manual' && paths.every((p) => known.some((k) => k.path === p))) {
      const ordered = orderParts(known.filter((k) => paths.includes(k.path)), next);
      if (ordered.join('\n') !== paths.join('\n')) setPaths(ordered);
    }
  }

  async function merge() {
    if (!info?.canMerge) return;
    if (removeParts && !(await dialogs.confirm({
      title: t('merge.view.deleteTitle'),
      message: t('merge.view.deleteMessage', { count: info.parts.length }),
      confirmLabel: t('merge.view.deleteConfirm'),
      danger: true,
    }))) return;
    setStarting(true);
    const r = await run(
      () => api.mergeStart({ paths, outputName: name, chapterMode, removeParts }),
      (x) => t('merge.view.started', { name: fileName(x.output) }),
    );
    setStarting(false);
    if (r) {
      setPaths([]);
      setName('');
      setNameEdited(false);
      setRemoveParts(false);
    }
  }

  const errors = info?.problems.filter((p) => p.level === 'error') ?? [];
  const warnings = info?.problems.filter((p) => p.level === 'warning') ?? [];
  const parts = info?.parts ?? [];

  const [paneClass, paneSwitch, showPane] = usePaneSwitch([t('merge.view.convertedFiles'), paths.length ? t('merge.view.partsPaneCount', { count: paths.length }) : t('merge.view.partsPane')]);

  return (
    <main className={`panes merge-panes ${paneClass}`}>
      {paneSwitch}
      <SourceBrowser
        settings={settings}
        root="target"
        sortId="merge"
        title={t('merge.view.convertedFiles')}
        addLabel={t('merge.view.addLabel')}
        addTitle={t('merge.view.addTitle')}
        hint={t('merge.view.browserHint')}
        help="merge.overview"
        changeTick={changeTick}
        onAdd={(list) => {
          addPaths(list);
          showPane(1);
        }}
        onError={onError}
      />

      <section
        className={`pane merge ${dropActive ? 'drop-active' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_PATHS)) {
            e.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropActive(false)}
        onDrop={(e) => {
          setDropActive(false);
          const raw = e.dataTransfer.getData(DRAG_PATHS);
          if (raw) {
            e.preventDefault();
            addPaths(JSON.parse(raw));
          }
        }}
      >
        <div className="pane-head">
          <h2>{t('merge.view.title')}<Help id="merge.overview" /></h2>
          <div className="pane-tools">
            <SortControl sort={sort} onChange={chooseSort} options={SORT_KEYS} />
            <button className="btn ghost small" disabled={!paths.length} onClick={() => setPaths([])}>
              <ListX size={14} /> {t('merge.view.clearList')}
            </button>
          </div>
        </div>

        <div className="merge-body">
          <h3 className="section-title">{t('merge.view.partsTitle')}<Help id="merge.parts" /></h3>
          {paths.length === 0 ? (
            <div className="drop-hint">
              <Upload size={28} />
              <p>{t('merge.view.empty')}</p>
            </div>
          ) : (
            <ol className="parts">
              {paths.map((p, i) => {
                const d = parts.find((x) => x.path === p);
                return (
                  <li
                    key={p}
                    className={`part ${dropIndex === i ? 'drop-before' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_PART, String(i));
                      setDragIndex(i);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onDragOver={(e) => {
                      if (dragIndex == null) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropIndex(i);
                    }}
                    onDrop={(e) => {
                      if (dragIndex == null) return;
                      e.preventDefault();
                      e.stopPropagation();
                      move(dragIndex, dragIndex < i ? i - 1 : i);
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                  >
                    <GripVertical size={15} className="muted grip" />
                    <span className="part-num">{i + 1}</span>
                    <span className="part-main">
                      <span className="part-name" title={p}>{fileName(p)}</span>
                      <span className="job-meta">
                        {d
                          ? [
                              duration(d.duration),
                              t('merge.view.partChapters', { count: d.chapters }),
                              t('merge.view.audio', { langs: d.tracks.filter((tr) => tr.type === 'audio').map((tr) => tr.lang).join('+') }),
                              t('merge.view.subs', { count: d.tracks.filter((tr) => tr.type === 'subtitle').length }),
                              d.tracks.find((tr) => tr.type === 'video')?.size,
                              bytes(d.size),
                            ].filter(Boolean).join(' · ')
                          : loading ? t('merge.view.reading') : ''}
                      </span>
                    </span>
                    <span className="job-actions">
                      <button className="icon-btn" title={t('merge.view.moveUp')} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={14} /></button>
                      <button className="icon-btn" title={t('merge.view.moveDown')} disabled={i === paths.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={14} /></button>
                      <button className="icon-btn" title={t('merge.view.takeOut')} onClick={() => setPaths((x) => x.filter((y) => y !== p))}><X size={14} /></button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {info && (errors.length > 0 || warnings.length > 0) && (
            <div className="problems">
              <h3 className="section-title">{t('merge.view.compatTitle')}<Help id="merge.compat" /></h3>
              <ul>
                {errors.map((p, i) => <li key={`e${i}`} className="text-bad"><CircleX size={14} /> {mergeProblem(p)}</li>)}
                {warnings.map((p, i) => <li key={`w${i}`} className="text-warn"><CircleAlert size={14} /> {mergeProblem(p)}</li>)}
              </ul>
            </div>
          )}

          {paths.length > 0 && (
            <div className="merge-options">
              <h3 className="section-title">{t('merge.view.mergedFile')}<Help id="merge.options" /></h3>
              <label className="merge-name-field">
                <span className="muted small">{t('common.name')}</span>
                <span className="name-with-ext">
                  <input
                    value={name}
                    spellCheck={false}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameEdited(true);
                    }}
                  />
                  <span className="muted">.mkv</span>
                </span>
              </label>
              <p className="muted small">
                {t('merge.view.folder', { folder: info?.outputDir ? relTo(settings?.targetRoot, info.outputDir) || t('merge.view.targetFolder') : '…' })}
                {info?.outputExists && <span className="text-warn"> {t('merge.view.exists', { example: `${name}${settings?.renameSeparator ?? '_'}1.mkv` })}</span>}
              </p>
              <label className="field-inline">
                {t('merge.view.chapters')}<Help id="merge.chapters" />
                <select value={chapterMode} onChange={(e) => setChapterMode(e.target.value)}>
                  <option value="keep">{t('merge.view.chaptersKeep')}</option>
                  <option value="perFile">{t('merge.view.chaptersPerFile')}</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={removeParts} onChange={(e) => setRemoveParts(e.target.checked)} />
                {t('merge.view.deleteParts')}
              </label>

              {info?.chapters?.length > 0 && (
                <div className="chapter-preview">
                  <button className="link small" onClick={() => setShowChapters((v) => !v)}>
                    {showChapters ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {t('merge.view.chapterPreview', { count: info.chapters.length })}
                  </button>
                  {showChapters && (
                    <ol>
                      {info.chapters.map((c, i) => (
                        <li key={i}><code>{duration(c.start)}</code> {c.title}</li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}

          <h3 className="section-title merges-title">{t('merge.view.recent')}<Help id="merge.history" /></h3>
          {merges.length === 0 ? (
            <p className="muted small">{t('merge.view.noMerges')}</p>
          ) : (
            <ul className="merges">{merges.map((m) => <MergeItem key={m.id} m={m} settings={settings} run={run} />)}</ul>
          )}
          {dropActive && <div className="drop-overlay">{t('merge.view.dropHere')}</div>}
        </div>

        <div className="rename-foot">
          <span className="muted small">
            {info
              ? `${t('merge.item.parts', { count: parts.length })} · ${duration(info.duration)} · ${bytes(info.size)}`
              : t('merge.item.parts', { count: paths.length })}
            {loading && ` · ${t('merge.view.reading')}`}
          </span>
          <span className="spacer" />
          <button className="btn primary" disabled={!info?.canMerge || loading || starting || !name.trim()} onClick={merge}>
            <Combine size={15} /> {parts.length >= 2 ? t('merge.view.mergeFiles', { count: parts.length }) : t('merge.view.merge')}
          </button>
        </div>
      </section>
    </main>
  );
}
