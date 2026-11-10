import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FileJson, Star, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime, humanDuration } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { startDownload } from '../download/useDownload.jsx';
import { AUDIO_ENCODERS, CONTAINERS, MIXDOWNS, PRESET_SECTIONS, formatValue, otherKeys, rawValue } from './presetFields.js';

/** Presets as a page: the list on the left, everything about the chosen one on the right. */
export function PresetsPage({ presets, selectedId, onSelect, run, onError }) {
  const dialogs = useDialogs();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('settings');
  const [usage, setUsage] = useState(null);

  const current = presets.find((p) => p.id === selectedId) ?? presets.find((p) => p.isDefault) ?? presets[0] ?? null;

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
    // createdAt changes when the preset is imported again.
  }, [current?.id, current?.createdAt, onError]);

  useEffect(() => {
    api.stats(0).then((s) => setUsage(Object.fromEntries(s.presets.map((p) => [p.name, p]))), () => {});
  }, [presets]);

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

  async function upload(files) {
    setBusy(true);
    try {
      for (const f of files) {
        const content = await f.text();
        const r = await run(
          () => api.uploadPreset(f.name, content),
          (x) => `${f.name}: ${x.map((p) => `${p.name} ${p.action}`).join(', ')}`,
        );
        if (r?.[0]) onSelect(r[0].id);
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
        <div className="page-nav-title-row">
          <h2 className="page-nav-title">Presets<Help id="presets" /></h2>
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
                onClick={() => onSelect(p.id)}
              >
                <span className="preset-item-text">
                  <span className="preset-item-name">{p.name}</span>
                  <span className="muted small">
                    {[p.summary.videoEncoder, p.summary.quality, p.summary.maxSize].filter(Boolean).join(' · ')}
                  </span>
                </span>
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
        <div className="page-content">
          {!current ? (
            <div className="empty-page">
              <FileJson size={40} className="muted" />
              <h1>No presets yet</h1>
              <p className="muted">
                In the HandBrake desktop app: <strong>Presets</strong> → select your preset → <strong>Export</strong>. Then drop the
                file here or press <strong>Import</strong>.
              </p>
              <button className="btn primary" onClick={() => input.current?.click()} disabled={busy}>
                <Upload size={15} /> Import a preset
              </button>
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
                    {current.category ? `${current.category} · ` : ''}Imported {dateTime(current.createdAt)}
                    {current.fileName ? ` from ${current.fileName}` : ''}
                  </p>
                  {current.description && <p className="preset-desc">“{current.description}”</p>}
                </div>
                <div className="page-head-actions">
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
                To change a preset, edit it in HandBrake and import it again: a preset with the same name replaces this one. Jobs
                already in the queue keep the settings they were added with.
              </p>
            </>
          )}
        </div>
      </section>
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
            <td>{MIXDOWNS[a.AudioMixdown] ?? a.AudioMixdown ?? '—'}</td>
            <td>{a.AudioBitrate ? `${a.AudioBitrate} kbps` : '—'}</td>
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
