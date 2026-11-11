import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, CopyPlus, Download, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime, humanDuration } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { startDownload } from '../download/useDownload.jsx';
import { has, rich, t } from '../i18n/index.js';
import { audioEncoderLabel, labelOf } from './hbOptions.js';
import { CONTAINERS, MIXDOWNS, PRESET_SECTIONS, formatValue, otherKeys, rawValue } from './presetFields.js';
// Loaded when first needed: the editor is most of the presets code.
const PresetEditor = lazy(() => import('./PresetEditor.jsx').then((m) => ({ default: m.PresetEditor })));
const NewPresetDialog = lazy(() => import('./NewPresetDialog.jsx').then((m) => ({ default: m.NewPresetDialog })));
const loading = () => <div className="page-content"><p className="muted">{t('presets.page.loadingEditor')}</p></div>;

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
    const timer = setTimeout(() => setEditing(false), 5000);
    return () => clearTimeout(timer);
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
        title: t('common.unsavedChanges'),
        message: t('presets.discard.message'),
        confirmLabel: t('presets.discard.confirm'),
        cancelLabel: t('presets.discard.keepEditing'),
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
          (x) => t('presets.page.uploaded', { file: f.name, presets: x.map(uploadResult).join(', ') }),
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
      title: t('presets.page.deleteTitle'),
      message: t('presets.page.deleteMessage', { name: p.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await run(() => api.deletePreset(p.id), t('presets.page.deleted', { name: p.name })))) onSelect(null);
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
      <nav ref={navRef} className="page-nav preset-nav" aria-label={t('presets.page.title')}>
        <h2 className="page-nav-title">{t('presets.page.title')}<Help id="presets" /></h2>
        <div className="preset-nav-actions">
          <button className="btn small" onClick={() => openNew()} title={t('presets.page.newTitle')}>
            <Plus size={14} /> {t('presets.page.new')}
          </button>
          <button className="btn small" onClick={() => input.current?.click()} disabled={busy} title={t('presets.page.importTitle')}>
            <Upload size={14} /> {t('common.import')}
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
                {editing && current?.id === p.id && <Pencil size={13} className="preset-editing" aria-label={t('presets.page.editing')} />}
                {p.isDefault && <Star size={14} className="preset-star" aria-label={t('presets.page.defaultPreset')} />}
              </button>
            ))}
          </div>
        ))}
        <div className={`upload-zone small ${over ? 'over' : ''}`}>
          <Upload size={18} />
          <span className="small">{rich('presets.page.dropHint')}</span>
        </div>
      </nav>

      <section className="page-body">
        {editing && arriving ? (
          <div className="page-content"><p className="muted">{t('presets.page.opening')}</p></div>
        ) : editing && current ? (
          <Suspense fallback={loading()}>
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
                <img className="brand-logo empty-logo" src="/logo.png" alt="" width={120} height={120} />
                <h1>{t('presets.page.emptyTitle')}</h1>
                <p className="muted">{rich('presets.page.emptyText')}</p>
                <div className="set-actions">
                  <button className="btn primary" onClick={() => openNew()}>
                    <Plus size={15} /> {t('presets.page.newPreset')}
                  </button>
                  <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
                    <Upload size={15} /> {t('presets.page.importPreset')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="page-head preset-head-row">
                  <div>
                    <h1>
                      {current.name}
                      {current.isDefault && <span className="badge done">{t('presets.page.defaultBadge')}</span>}
                    </h1>
                    <p className="muted small">
                      {current.category ? `${current.category} · ` : ''}
                      {current.fileName
                        ? t('presets.page.imported', { date: dateTime(current.createdAt), file: current.fileName })
                        : t('presets.page.created', { date: dateTime(current.createdAt) })}
                      {current.updatedAt ? ` · ${t('presets.page.edited', { date: dateTime(current.updatedAt) })}` : ''}
                    </p>
                    {current.description && <p className="preset-desc">“{current.description}”</p>}
                  </div>
                  <div className="page-head-actions">
                    <button className="btn small primary" onClick={() => edit()} title={t('presets.page.editTitle')}>
                      <Pencil size={14} /> {t('common.edit')}
                    </button>
                    <button className="btn small" onClick={() => openNew(current.id)} title={t('presets.page.duplicateTitle')}>
                      <CopyPlus size={14} /> {t('common.duplicate')}
                    </button>
                    {!current.isDefault && (
                      <button className="btn small" onClick={() => run(() => api.setDefaultPreset(current.id), t('presets.page.nowDefault', { name: current.name }))}>
                        <Star size={14} /> {t('presets.page.makeDefault')}
                      </button>
                    )}
                    <button className="btn small" onClick={() => startDownload(api.presetExportUrl(current.id))} title={t('presets.page.downloadTitle')}>
                      <Download size={14} /> {t('common.download')}
                    </button>
                    <button className="btn small danger" onClick={() => remove(current)}>
                      <Trash2 size={14} /> {t('common.delete')}
                    </button>
                  </div>
                </header>

                <div className="preset-facts">
                  <Fact label={t('presets.facts.video')} value={[current.summary.videoEncoder, current.summary.quality].filter(Boolean).join(' · ')} />
                  <Fact label={t('presets.facts.size')} value={current.summary.maxSize ? t('presets.facts.maxSize', { size: current.summary.maxSize }) : t('presets.facts.source')} />
                  <Fact label={t('presets.facts.container')} value={CONTAINERS[current.summary.format] ?? current.summary.format} />
                  <Fact
                    label={t('presets.facts.used')}
                    value={u?.done ? t('common.files.count', { count: u.done }) : t('presets.facts.notYet')}
                    sub={u?.done ? [u.speed ? realTime(u.speed, 1) : null, u.reduction != null ? smaller(u.reduction) : null].filter(Boolean).join(' · ') : null}
                  />
                </div>

                <div className="seg" role="tablist" aria-label={t('presets.page.viewTabs')}>
                  <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>{t('presets.page.settingsTab')}</button>
                  <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>JSON</button>
                </div>

                {!preset ? (
                  <p className="muted">{t('common.loading')}</p>
                ) : tab === 'json' ? (
                  <JsonView json={detail.json} run={run} />
                ) : (
                  <PresetDetails preset={preset} usage={u} />
                )}
                <p className="set-hint preset-foot">{rich('presets.page.foot')}</p>
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

/** One preset in the "imported" toast: "Film added" (the server says what it did: added / updated). */
function uploadResult(p) {
  const key = `presets.page.uploadAction.${p.action}`;
  return has(key) ? t(key, { name: p.name }) : `${p.name} ${p.action}`;
}
const realTime = (speed, digits) => t('presets.facts.realTime', { speed: speed.toFixed(digits) });
const smaller = (reduction) => t('presets.facts.smaller', { percent: Math.round(reduction * 100) });

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
          <header className="set-card-head"><h3>{t(s.titleKey)}</h3></header>
          <div className="set-card-body">
            <dl className="kv">
              {s.fields.filter((f) => f.key in preset && (!f.show || f.show(preset))).map((f) => (
                <div key={f.key} className="kv-row" title={f.key}>
                  <dt>{t(f.labelKey)}</dt>
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
          <header className="set-card-head"><h3>{t('presets.details.results')}</h3></header>
          <div className="set-card-body">
            <dl className="kv">
              <div className="kv-row">
                <dt>{t('presets.details.converted')}</dt>
                <dd>
                  {usage.failed
                    ? t('presets.details.convertedFailed', { files: t('common.files.count', { count: usage.done }), failed: usage.failed })
                    : t('common.files.count', { count: usage.done })}
                </dd>
              </div>
              <div className="kv-row">
                <dt>{t('presets.details.videoConverted')}</dt>
                <dd>{t('presets.details.mediaInTime', { media: humanDuration(usage.mediaSeconds), time: humanDuration(usage.encodeSeconds) })}</dd>
              </div>
              <div className="kv-row"><dt>{t('presets.details.averageSpeed')}</dt><dd>{usage.avgFps ? `${Math.round(usage.avgFps)} fps` : '—'}{usage.speed ? ` · ${realTime(usage.speed, 2)}` : ''}</dd></div>
              <div className="kv-row"><dt>{t('presets.facts.size')}</dt><dd>{bytes(usage.sourceBytes)} → {bytes(usage.outputBytes)}{usage.reduction != null ? ` (${smaller(usage.reduction)})` : ''}</dd></div>
            </dl>
          </div>
        </section>
      )}
      {other.length > 0 && (
        <details className="set-card other-keys">
          <summary className="set-card-head"><h3>{t('presets.details.otherSettings', { count: other.length })}</h3></summary>
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
  if (!tracks.length) return <p className="set-hint">{t('presets.audioTable.none')}</p>;
  return (
    <table className="audio-table">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('presets.audioTable.encoder')}</th>
          <th>{t('presets.audioTable.mixdown')}</th>
          <th>{t('presets.audioTable.bitrate')}</th>
          <th>{t('presets.audioTable.sampleRate')}</th>
          <th>{t('presets.audioTable.drcGain')}</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((a, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{audioEncoderLabel(a.AudioEncoder)}</td>
            <td>{a.AudioEncoder?.startsWith('copy') ? '—' : labelOf(MIXDOWNS, a.AudioMixdown) ?? a.AudioMixdown ?? '—'}</td>
            <td>{a.AudioTrackQualityEnable ? t('presets.audioTable.quality', { value: a.AudioTrackQuality }) : a.AudioBitrate > 0 ? `${a.AudioBitrate} kbps` : '—'}</td>
            <td>{!a.AudioSamplerate || a.AudioSamplerate === 'auto' ? t('presetOptions.auto') : `${a.AudioSamplerate} kHz`}</td>
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
        <button className="btn small" onClick={() => run(() => navigator.clipboard.writeText(text), t('presets.page.copied'))} disabled={!navigator.clipboard}>
          <Copy size={14} /> {t('common.copy')}
        </button>
      </div>
      <pre className="code-block">{text}</pre>
    </div>
  );
}
