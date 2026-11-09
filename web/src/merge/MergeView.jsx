import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CircleX, Combine, GripVertical, ListX, Square, Trash2, Upload, X,
} from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser, DRAG_PATHS } from '../components/SourceBrowser.jsx';
import { VerifyBadge } from '../components/StatusBadge.jsx';
import { bytes, dateTime, duration, fileName, relTo } from '../format.js';
import { Help } from '../help/Help.jsx';

const DRAG_PART = 'application/x-hbui-part';

const STATUS = {
  queued: ['queued', 'Waiting'],
  running: ['running', 'Merging'],
  done: ['done', 'Merged'],
  failed: ['failed', 'Failed'],
  cancelled: ['cancelled', 'Cancelled'],
};

function MergeStatus({ m }) {
  let [cls, label] = STATUS[m.status] ?? ['', m.status];
  if (m.status === 'running' && m.phase === 'verifying') label = 'Checking';
  if (m.status === 'running' && m.phase === 'reading') label = 'Reading parts';
  return <span className={`badge ${cls}`}>{label}</span>;
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
            <button className="icon-btn danger" title="Cancel this merge" onClick={() => run(() => api.mergeCancel(m.id))}><Square size={15} /></button>
          ) : (
            <button className="icon-btn" title="Remove from the list (files are not touched)" onClick={() => run(() => api.mergeRemove(m.id))}><Trash2 size={15} /></button>
          )}
        </span>
      </div>
      {m.status === 'running' && (
        <div className={`progress ${m.phase === 'verifying' ? 'checking' : ''}`}><div className="bar" style={{ width: `${(m.progress ?? 0) * 100}%` }} /></div>
      )}
      <div className="job-meta">
        {[
          `${m.parts.length} parts`,
          m.duration ? duration(m.duration) : null,
          m.chapters != null ? `${m.chapters} chapters` : null,
          m.outputSize ? bytes(m.outputSize) : null,
          m.partsRemoved ? 'parts removed' : null,
          m.finishedAt ? dateTime(m.finishedAt) : dateTime(m.createdAt),
        ].filter(Boolean).join(' · ')}
      </div>
      {m.error && <p className="text-bad small">{m.error}</p>}
      {open && (
        <div className="merge-item-body">
          <p className="small"><span className="muted">Output:</span> <code className="path">{relTo(settings?.targetRoot, m.output)}</code></p>
          <ol className="small merge-parts-done">
            {m.parts.map((p) => <li key={p}>{relTo(settings?.targetRoot, p)}</li>)}
          </ol>
          {m.warnings.length > 0 && <ul className="warn-list">{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {m.verify?.checks?.length > 0 && (
            <ul className="checks">
              {m.verify.checks.map((c) => (
                <li key={c.id} className={c.status}>
                  <span className={`dot-status ${c.status}`} />
                  <span><strong>{c.label}</strong> <span className="check-detail">{c.detail}</span></span>
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

  // Read the parts (tracks, length, chapters) whenever the list or options change.
  useEffect(() => {
    if (!paths.length) {
      setInfo(null);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.mergeInspect({ paths, chapterMode, outputName: nameEdited ? name : undefined });
        if (mine !== seq.current) return;
        setInfo(r);
        if (!nameEdited) setName(r.outputName);
        // Folders are expanded into their files, in order.
        const files = r.parts.map((p) => p.path);
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
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, chapterMode, name, nameEdited, changeTick]);

  const addPaths = useCallback((list) => setPaths((p) => [...new Set([...p, ...list])]), [setPaths]);
  const move = (from, to) =>
    setPaths((p) => {
      if (to < 0 || to >= p.length || from === to) return p;
      const next = p.slice();
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });

  async function merge() {
    if (!info?.canMerge) return;
    if (removeParts && !confirm(`After a successful merge, delete the ${info.parts.length} original parts? This cannot be undone.`)) return;
    setStarting(true);
    const r = await run(
      () => api.mergeStart({ paths, outputName: name, chapterMode, removeParts }),
      (x) => `Merging into ${fileName(x.output)}`,
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

  return (
    <main className="panes merge-panes">
      <SourceBrowser
        settings={settings}
        root="target"
        title="Converted files"
        addLabel="Add to merge"
        hint="Drag files, or a folder with the parts, to the merge list. Ctrl/Shift-click to select several."
        help="merge.overview"
        changeTick={changeTick}
        onAdd={addPaths}
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
          <h2>Merge<Help id="merge.overview" /></h2>
          <div className="pane-tools">
            <button className="btn ghost small" disabled={!paths.length} onClick={() => setPaths([])}>
              <ListX size={14} /> Clear list
            </button>
          </div>
        </div>

        <div className="merge-body">
          <h3 className="section-title">Parts, in order<Help id="merge.parts" /></h3>
          {paths.length === 0 ? (
            <div className="drop-hint">
              <Upload size={28} />
              <p>Drag the parts here from Converted files, then put them in order.</p>
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
                              `${d.chapters} chapter${d.chapters === 1 ? '' : 's'}`,
                              d.tracks.filter((t) => t.type === 'audio').map((t) => t.lang).join('+') + ' audio',
                              `${d.tracks.filter((t) => t.type === 'subtitle').length} subs`,
                              d.tracks.find((t) => t.type === 'video')?.size,
                              bytes(d.size),
                            ].filter(Boolean).join(' · ')
                          : loading ? 'reading…' : ''}
                      </span>
                    </span>
                    <span className="job-actions">
                      <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={14} /></button>
                      <button className="icon-btn" title="Move down" disabled={i === paths.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={14} /></button>
                      <button className="icon-btn" title="Take out of the list" onClick={() => setPaths((x) => x.filter((y) => y !== p))}><X size={14} /></button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {info && (errors.length > 0 || warnings.length > 0) && (
            <div className="problems">
              <h3 className="section-title">Can they be joined?<Help id="merge.compat" /></h3>
              <ul>
                {errors.map((p, i) => <li key={`e${i}`} className="text-bad"><CircleX size={14} /> {p.message}</li>)}
                {warnings.map((p, i) => <li key={`w${i}`} className="text-warn"><CircleAlert size={14} /> {p.message}</li>)}
              </ul>
            </div>
          )}

          {paths.length > 0 && (
            <div className="merge-options">
              <h3 className="section-title">Merged file<Help id="merge.options" /></h3>
              <label className="merge-name-field">
                <span className="muted small">Name</span>
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
                In {info?.outputDir ? relTo(settings?.targetRoot, info.outputDir) || 'the target folder' : '…'} (the folder of part 1).
                {info?.outputExists && <span className="text-warn"> A file with this name exists: the merged file gets a number ({name}{settings?.renameSeparator ?? '_'}1.mkv).</span>}
              </p>
              <label className="field-inline">
                Chapters<Help id="merge.chapters" />
                <select value={chapterMode} onChange={(e) => setChapterMode(e.target.value)}>
                  <option value="keep">Keep each part's chapters</option>
                  <option value="perFile">One chapter per part, named after the file</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={removeParts} onChange={(e) => setRemoveParts(e.target.checked)} />
                Delete the parts after a successful merge
              </label>

              {info?.chapters?.length > 0 && (
                <div className="chapter-preview">
                  <button className="link small" onClick={() => setShowChapters((v) => !v)}>
                    {showChapters ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {info.chapters.length} chapters in the merged file
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

          <h3 className="section-title merges-title">Recent merges<Help id="merge.history" /></h3>
          {merges.length === 0 ? (
            <p className="muted small">No merges yet.</p>
          ) : (
            <ul className="merges">{merges.map((m) => <MergeItem key={m.id} m={m} settings={settings} run={run} />)}</ul>
          )}
          {dropActive && <div className="drop-overlay">Drop to add to the merge list</div>}
        </div>

        <div className="rename-foot">
          <span className="muted small">
            {info ? `${parts.length} parts · ${duration(info.duration)} · ${bytes(info.size)}` : `${paths.length} parts`}
            {loading && ' · reading…'}
          </span>
          <span className="spacer" />
          <button className="btn primary" disabled={!info?.canMerge || loading || starting || !name.trim()} onClick={merge}>
            <Combine size={15} /> Merge {parts.length >= 2 ? `${parts.length} files` : ''}
          </button>
        </div>
      </section>
    </main>
  );
}
