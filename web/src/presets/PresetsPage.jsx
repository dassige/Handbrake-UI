import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, CopyPlus, Download, FileJson, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime, humanDuration } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { startDownload } from '../download/useDownload.jsx';
import { AUDIO_ENCODERS, CONTAINERS, MIXDOWNS, PRESET_SECTIONS, formatValue, otherKeys, rawValue } from './presetFields.js';
// Loaded when first needed: the editor is most of the presets code.
const PresetEditor = lazy(() => import('./PresetEditor.jsx').then((m) => ({ default: m.PresetEditor })));
const NewPresetDialog = lazy(() => import('./NewPresetDialog.jsx').then((m) => ({ default: m.NewPresetDialog })));
const loading = <div className="page-content"><p className="muted">Loading the editor…</p></div>;

/**
 * Presets as a page: the list on the left, everything about the chosen one on the right.
 * "Edit" turns the right side into the preset editor (PresetEditor.jsx).
 */
export function PresetsPage({ presets, selectedId, onSelect, run, onError, onDirtyChange }) {
  const dialogs = useDialogs();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('settings');
  const [usage, setUsage] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState('summary');
  const [newDialog, setNewDialog] = useState(null); // { fromId } while "New preset" is open
  const editorDirty = useRef(false);

  const current = presets.find((p) => p.id === selectedId) ?? presets.find((p) => p.isDefault) ?? presets[0] ?? null;
  // A preset just created here: the list is refreshed a moment later (server event).
  const arriving = selectedId != null && !presets.some((p) => p.id === selectedId);

  useEffect(() => {
    if (!current) {
      setDetail(null);
      return;
    }
    let live = true;
    api.preset(current.id).then((d) => live && setDetail(d), (e) => live && onError(e));
    return () => {
      live = false;
    };
    // createdAt changes when the preset is imported again, updatedAt when it is saved in the editor.
  }, [current?.id, current?.createdAt, current?.updatedAt, onError]);

  useEffect(() => {
    api.stats(0).then((s) => setUsage(Object.fromEntries(s.presets.map((p) => [p.name, p]))), () => {});
  }, [presets]);

  // The preset being edited was deleted (here or in another tab).
  useEffect(() => {
    if (editing && !current && !arriving) setEditing(false);
    if (!editing || !arriving) return undefined;
    // Deleted in another tab rather than just created: stop waiting.
    const t = setTimeout(() => setEditing(false), 5000);
    return () => clearTimeout(t);
  }, [editing, current, arriving]);

  // On a phone the section list is a horizontal strip: keep the chosen one in view.
  const navRef = useRef(null);
  useEffect(() => {
    navRef.current?.querySelector('.page-nav-item.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current?.id]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const p of presets) {
      const k = p.category ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return [...m.entries()];
  }, [presets]);
  const categories = useMemo(() => [...new Set(presets.map((p) => p.category).filter(Boolean))].sort(), [presets]);

  const setDirty = useCallback(
    (d) => {
      editorDirty.current = d;
      onDirtyChange?.(d);
    },
    [onDirtyChange],
  );

  /** Leaving the editor with unsaved changes asks first. */
  async function leaveEditor() {
    if (!editing) return true;
    if (editorDirty.current) {
      const ok = await dialogs.confirm({
        title: 'Unsaved changes',
        message: 'Discard your changes to this preset?',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!ok) return false;
    }
    setDirty(false);
    setEditing(false);
    return true;
  }

  async function select(id) {
    if (id === current?.id) return;
    if (await leaveEditor()) onSelect(id);
  }

  function edit(id = current?.id) {
    setEditTab('summary');
    setEditing(true);
    if (id !== current?.id) onSelect(id);
  }

  async function upload(files) {
    setBusy(true);
    try {
      for (const f of files) {
        const content = await f.text();
        const r = await run(
          () => api.uploadPreset(f.name, content),
          (x) => `${f.name}: ${x.map((p) => `${p.name} ${p.action}`).join(', ')}`,
        );
        if (r?.[0] && !editing) onSelect(r[0].id);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(p) {
    const ok = await dialogs.confirm({
      title: 'Delete preset',
      message: `Delete preset "${p.name}"? Jobs already in the queue keep their own copy.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.deletePreset(p.id), `Deleted ${p.name}`))) onSelect(null);
  }

  async function openNew(fromId = null) {
    if (await leaveEditor()) setNewDialog({ fromId });
  }

  const dropProps = {
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        setOver(true);
      }
    },
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setOver(false);
      upload([...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.json')));
    },
  };

  const preset = detail?.json?.PresetList?.[0];
  const u = current && usage?.[current.name];

  return (
    <main className={`page presets-page ${over ? 'drop-active' : ''}`} {...dropProps}>
      <nav ref={navRef} className="page-nav preset-nav" aria-label="Presets">
        <h2 className="page-nav-title">Presets<Help id="presets" /></h2>
        <div className="preset-nav-actions">
          <button className="btn small" onClick={() => openNew()} title="Make a new preset from a HandBrake preset or one of yours">
            <Plus size={14} /> New
          </button>
          <button className="btn small" onClick={() => input.current?.click()} disabled={busy} title="Import presets exported from HandBrake">
            <Upload size={14} /> Import
          </button>
        </div>
        <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={(e) => upload([...e.target.files])} />
        {groups.map(([category, list]) => (
          <div key={category} className="page-nav-group">
            {category && <span className="page-nav-label">{category}</span>}
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`page-nav-item preset-item ${current?.id === p.id ? 'active' : ''}`}
                aria-current={current?.id === p.id ? 'page' : undefined}
                onClick={() => select(p.id)}
              >
                <span className="preset-item-text">
                  <span className="preset-item-name">{p.name}</span>
                  <span className="muted small">
                    {[p.summary.videoEncoder, p.summary.quality, p.summary.maxSize].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {editing && current?.id === p.id && <Pencil size={13} className="preset-editing" aria-label="Editing" />}
                {p.isDefault && <Star size={14} className="preset-star" aria-label="Default preset" />}
              </button>
            ))}
          </div>
        ))}
        <div className={`upload-zone small ${over ? 'over' : ''}`}>
          <Upload size={18} />
          <span className="small">
            Drop <code>.json</code> files exported from HandBrake anywhere on this page.
          </span>
        </div>
      </nav>

      <section className="page-body">
        {editing && arriving ? (
          <div className="page-content"><p className="muted">Opening the new preset…</p></div>
        ) : editing && current ? (
          <Suspense fallback={loading}>
            <PresetEditor
              key={current.id}
              presetId={current.id}
              categories={categories}
              tab={editTab}
              onTab={setEditTab}
              run={run}
              onError={onError}
              onDirtyChange={setDirty}
              onClose={() => {
                setDirty(false);
                setEditing(false);
              }}
              onSaved={(id) => {
                setDirty(false);
                setEditing(false);
                onSelect(id);
              }}
            />
          </Suspense>
        ) : (
          <div className="page-content">
            {!current ? (
              <div className="empty-page">
                <FileJson size={40} className="muted" />
                <h1>No presets yet</h1>
                <p className="muted">
                  Start from one of HandBrake’s own presets with <strong>New</strong>, or import yours: in the HandBrake
                  desktop app, <strong>Presets</strong> → select your preset → <strong>Export</strong>, then drop the file here
                  or press <strong>Import</strong>.
                </p>
                <div className="set-actions">
                  <button className="btn primary" onClick={() => openNew()}>
                    <Plus size={15} /> New preset
                  </button>
                  <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
                    <Upload size={15} /> Import a preset
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="page-head preset-head-row">
                  <div>
                    <h1>
                      {current.name}
                      {current.isDefault && <span className="badge done">default</span>}
                    </h1>
                    <p className="muted small">
                      {current.category ? `${current.category} · ` : ''}
                      {current.fileName ? `Imported ${dateTime(current.createdAt)} from ${current.fileName}` : `Created ${dateTime(current.createdAt)}`}
                      {current.updatedAt ? ` · edited ${dateTime(current.updatedAt)}` : ''}
                    </p>
                    {current.description && <p className="preset-desc">“{current.description}”</p>}
                  </div>
                  <div className="page-head-actions">
                    <button className="btn small primary" onClick={() => edit()} title="Change this preset's settings">
                      <Pencil size={14} /> Edit
                    </button>
                    <button className="btn small" onClick={() => openNew(current.id)} title="Make a new preset with these settings">
                      <CopyPlus size={14} /> Duplicate
                    </button>
                    {!current.isDefault && (
                      <button className="btn small" onClick={() => run(() => api.setDefaultPreset(current.id), `${current.name} is now the default`)}>
                        <Star size={14} /> Make default
                      </button>
                    )}
                    <button className="btn small" onClick={() => startDownload(api.presetExportUrl(current.id))} title="Download as a file HandBrake can import">
                      <Download size={14} /> Download
                    </button>
                    <button className="btn small danger" onClick={() => remove(current)}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </header>

                <div className="preset-facts">
                  <Fact label="Video" value={[current.summary.videoEncoder, current.summary.quality].filter(Boolean).join(' · ')} />
                  <Fact label="Size" value={current.summary.maxSize ? `max ${current.summary.maxSize}` : 'source'} />
                  <Fact label="Container" value={CONTAINERS[current.summary.format] ?? current.summary.format} />
                  <Fact
                    label="Used"
                    value={u?.done ? `${u.done} file${u.done === 1 ? '' : 's'}` : 'not yet'}
                    sub={u?.done ? [u.speed ? `${u.speed.toFixed(1)}× real time` : null, u.reduction != null ? `${Math.round(u.reduction * 100)}% smaller` : null].filter(Boolean).join(' · ') : null}
                  />
                </div>

                <div className="seg" role="tablist" aria-label="Preset view">
                  <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
                  <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>JSON</button>
                </div>

                {!preset ? (
                  <p className="muted">Loading…</p>
                ) : tab === 'json' ? (
                  <JsonView json={detail.json} run={run} />
                ) : (
                  <PresetDetails preset={preset} usage={u} />
                )}
                <p className="set-hint preset-foot">
                  Press <strong>Edit</strong> to change this preset, or edit it in HandBrake and import it again: a preset with the
                  same name replaces this one. Jobs already in the queue keep the settings they were added with.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {newDialog && (
        <Suspense fallback={null}>
          <NewPresetDialog
            presets={presets}
            fromId={newDialog.fromId}
            categories={categories}
            run={run}
            onClose={() => setNewDialog(null)}
            onCreated={(id) => {
              setNewDialog(null);
              edit(id);
            }}
          />
        </Suspense>
      )}
    </main>
  );
}

function Fact({ label, value, sub }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value || '—'}</span>
      {sub && <span className="fact-sub">{sub}</span>}
    </div>
  );
}

function PresetDetails({ preset, usage }) {
  const other = otherKeys(preset);
  return (
    <div className="preset-sections">
      {PRESET_SECTIONS.map((s) => (
        <section key={s.id} className="set-card">
          <header className="set-card-head"><h3>{s.title}</h3></header>
          <div className="set-card-body">
            <dl className="kv">
              {s.fields.filter((f) => f.key in preset && (!f.show || f.show(preset))).map((f) => (
                <div key={f.key} className="kv-row" title={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{formatValue(f, preset)}</dd>
                </div>
              ))}
            </dl>
            {s.lists?.includes('AudioList') && <AudioTable tracks={preset.AudioList ?? []} />}
          </div>
        </section>
      ))}
      {usage?.done > 0 && (
        <section className="set-card">
          <header className="set-card-head"><h3>Results with this preset</h3></header>
          <div className="set-card-body">
            <dl className="kv">
              <div className="kv-row"><dt>Converted</dt><dd>{usage.done} files{usage.failed ? `, ${usage.failed} failed` : ''}</dd></div>
              <div className="kv-row"><dt>Video converted</dt><dd>{humanDuration(usage.mediaSeconds)} in {humanDuration(usage.encodeSeconds)}</dd></div>
              <div className="kv-row"><dt>Average speed</dt><dd>{usage.avgFps ? `${Math.round(usage.avgFps)} fps` : '—'}{usage.speed ? ` · ${usage.speed.toFixed(2)}× real time` : ''}</dd></div>
              <div className="kv-row"><dt>Size</dt><dd>{bytes(usage.sourceBytes)} → {bytes(usage.outputBytes)}{usage.reduction != null ? ` (${Math.round(usage.reduction * 100)}% smaller)` : ''}</dd></div>
            </dl>
          </div>
        </section>
      )}
      {other.length > 0 && (
        <details className="set-card other-keys">
          <summary className="set-card-head"><h3>Other settings ({other.length})</h3></summary>
          <div className="set-card-body">
            <dl className="kv mono-keys">
              {other.map((k) => (
                <div key={k} className="kv-row">
                  <dt><code>{k}</code></dt>
                  <dd>{rawValue(preset[k])}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      )}
    </div>
  );
}

function AudioTable({ tracks }) {
  if (!tracks.length) return <p className="set-hint">No audio encoders.</p>;
  return (
    <table className="audio-table">
      <thead>
        <tr><th>#</th><th>Encoder</th><th>Mixdown</th><th>Bitrate</th><th>Sample rate</th><th>DRC / gain</th></tr>
      </thead>
      <tbody>
        {tracks.map((a, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{AUDIO_ENCODERS[a.AudioEncoder] ?? a.AudioEncoder}</td>
            <td>{a.AudioEncoder?.startsWith('copy') ? '—' : MIXDOWNS[a.AudioMixdown] ?? a.AudioMixdown ?? '—'}</td>
            <td>{a.AudioTrackQualityEnable ? `quality ${a.AudioTrackQuality}` : a.AudioBitrate > 0 ? `${a.AudioBitrate} kbps` : '—'}</td>
            <td>{!a.AudioSamplerate || a.AudioSamplerate === 'auto' ? 'Auto' : `${a.AudioSamplerate} kHz`}</td>
            <td>{a.AudioTrackDRCSlider ?? 0} / {a.AudioTrackGainSlider ?? 0} dB</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JsonView({ json, run }) {
  const text = useMemo(() => JSON.stringify(json, null, 2), [json]);
  return (
    <div className="json-view">
      <div className="json-tools">
        <button className="btn small" onClick={() => run(() => navigator.clipboard.writeText(text), 'Copied')} disabled={!navigator.clipboard}>
          <Copy size={14} /> Copy
        </button>
      </div>
      <pre className="code-block">{text}</pre>
    </div>
  );
}
