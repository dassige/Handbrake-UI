import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { Card } from '../settings/fields.jsx';
import { Text } from './editorFields.jsx';
import { DimensionsTab, FiltersTab, SummaryTab, VideoTab } from './EditorTabs.jsx';
import { AudioTab, SubtitlesTab } from './AudioSubtitleTabs.jsx';
import { AUDIO_ENCODERS, VIDEO_ENCODERS, audioMuxers, muxer, qualityLimits, videoMuxers } from './hbOptions.js';

// The same tabs as the HandBrake desktop app, plus the raw JSON.
const TABS = [
  { id: 'summary', label: 'Summary', Body: SummaryTab },
  { id: 'dimensions', label: 'Dimensions', Body: DimensionsTab },
  { id: 'filters', label: 'Filters', Body: FiltersTab },
  { id: 'video', label: 'Video', Body: VideoTab },
  { id: 'audio', label: 'Audio', Body: AudioTab },
  { id: 'subtitles', label: 'Subtitles', Body: SubtitlesTab },
  { id: 'json', label: 'JSON' },
];
const MUXER_NAME = { mp4: 'MP4', mkv: 'MKV', webm: 'WebM', mov: 'MOV' };

let capsCache = null;
/** The server's HandBrakeCLI options, asked once per page load (the first time takes a few seconds). */
export function loadPresetOptions() {
  capsCache ??= api.presetOptions().catch((e) => {
    capsCache = null;
    throw e;
  });
  return capsCache;
}

/**
 * Problems that would make the preset fail or behave unexpectedly. `block` ones stop saving
 * (HandBrake would refuse the combination); the others are warnings. Each has the tab to fix it in.
 */
export function presetProblems(p, caps) {
  const out = [];
  const mux = muxer(p.FileFormat);
  if (!videoMuxers(p.VideoEncoder).includes(mux)) {
    out.push({ block: true, tab: 'summary', text: `${VIDEO_ENCODERS[p.VideoEncoder] ?? p.VideoEncoder} video can’t be written to ${MUXER_NAME[mux]}: choose another container or video encoder.` });
  }
  (p.AudioList ?? []).forEach((a, i) => {
    if (!audioMuxers(a.AudioEncoder).includes(mux)) {
      out.push({ block: true, tab: 'audio', text: `Audio encoder ${i + 1} (${AUDIO_ENCODERS[a.AudioEncoder] ?? a.AudioEncoder}) can’t be written to ${MUXER_NAME[mux]}.` });
    }
  });
  if (p.VideoQualityType === 2 && !qualityLimits(p.VideoEncoder)) {
    out.push({ block: true, tab: 'video', text: 'This encoder has no constant quality mode: choose an average bitrate.' });
  }
  if (caps.source === 'handbrake') {
    if (!caps.videoEncoders.some((e) => e.name === p.VideoEncoder)) {
      out.push({ tab: 'video', text: `This server’s HandBrake has no ${VIDEO_ENCODERS[p.VideoEncoder] ?? p.VideoEncoder} encoder: conversions with this preset will fail here.` });
    }
    const missing = (p.AudioList ?? []).filter((a) => !caps.audioEncoders.includes(a.AudioEncoder)).map((a) => AUDIO_ENCODERS[a.AudioEncoder] ?? a.AudioEncoder);
    if (missing.length) out.push({ tab: 'audio', text: `This server’s HandBrake has no ${[...new Set(missing)].join(', ')} audio encoder.` });
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Edits one preset like the HandBrake desktop app: properties at the top, the settings in
 * tabs, and a bar to save, save as a new preset or cancel. The settings are a copy normalised
 * by the server's HandBrakeCLI, so every setting is there in the current format.
 */
export function PresetEditor({ presetId, categories, tab, onTab, run, onError, onClose, onSaved, onDirtyChange }) {
  const dialogs = useDialogs();
  const [base, setBase] = useState(null); // { name, category, description, preset, version }
  const [draft, setDraft] = useState(null);
  const [caps, setCaps] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.editablePreset(presetId), loadPresetOptions()]).then(
      ([e, c]) => {
        if (!live) return;
        const b = { name: e.name, category: e.category ?? '', description: e.description ?? '', preset: e.preset, version: e.version };
        setBase(b);
        setDraft(b);
        setCaps(c);
      },
      (err) => {
        if (!live) return;
        onError(err);
        onClose();
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  const dirty = !!draft && !same(draft, base);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const problems = useMemo(() => (draft && caps ? presetProblems(draft.preset, caps) : []), [draft, caps]);
  const blocked = problems.some((x) => x.block) || !draft?.name.trim();

  if (!draft || !caps) {
    return (
      <div className="page-content">
        <p className="muted pe-loading">
          <Loader2 size={16} className="spin" /> Reading the preset and this server’s HandBrake options…
        </p>
      </div>
    );
  }

  const p = draft.preset;
  const set = (key, value) => setDraft((d) => ({ ...d, preset: { ...d.preset, [key]: value } }));
  const setMany = (patch) => setDraft((d) => ({ ...d, preset: { ...d.preset, ...patch } }));
  const setProp = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const body = { preset: draft.preset, version: draft.version, name: draft.name, category: draft.category, description: draft.description };

  async function save() {
    setSaving(true);
    const r = await run(() => api.updatePreset(presetId, body), `Saved ${draft.name.trim()}`);
    setSaving(false);
    if (r) {
      dirtyRef.current = false;
      onSaved(presetId);
    }
  }

  async function saveAsNew() {
    const name = await dialogs.prompt({
      title: 'Save as a new preset',
      message: 'The new preset gets these settings; this one stays as it was saved.',
      label: 'Name of the new preset',
      value: `${draft.name.trim()} (copy)`,
      confirmLabel: 'Save new preset',
    });
    if (!name) return;
    setSaving(true);
    const r = await run(() => api.createPreset({ ...body, name }), `Saved ${name}`);
    setSaving(false);
    if (r) {
      dirtyRef.current = false;
      onSaved(r.id);
    }
  }

  async function cancel() {
    if (dirty && !(await dialogs.confirm({ title: 'Unsaved changes', message: 'Discard your changes to this preset?', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }))) return;
    onClose();
  }

  return (
    <>
      <div className="page-content preset-editor">
        <header className="page-head">
          <h1>Edit preset<Help id="presets.editor" /></h1>
          <span className="muted">{base.name}</span>
        </header>
        <Card title="Preset">
          <div className="pe-grid pe-props">
            <Text label="Name" value={draft.name} onChange={(v) => setProp('name', v)} maxLength={120} />
            <label className="set-field">
              <span className="set-label">Category</span>
              <input value={draft.category} list="preset-categories" onChange={(e) => setProp('category', e.target.value)} placeholder="None" maxLength={80} />
              <datalist id="preset-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>
          <Text label="Description" value={draft.description} onChange={(v) => setProp('description', v)} maxLength={300} placeholder="What this preset is for" />
        </Card>

        <div className="seg pe-tabs" role="tablist" aria-label="Preset settings">
          {TABS.map((t) => {
            const flagged = problems.some((x) => x.tab === t.id);
            return (
              <button key={t.id} type="button" role="tab" aria-selected={current.id === t.id} className={current.id === t.id ? 'active' : ''} onClick={() => onTab(t.id)}>
                {t.label}
                {flagged && <span className="pe-tab-flag" aria-label="has a problem" />}
              </button>
            );
          })}
        </div>

        {problems.length > 0 && (
          <ul className="pe-problems">
            {problems.map((x) => (
              <li key={x.text} className={x.block ? 'bad' : 'warn'}>
                <AlertTriangle size={15} />
                <span>{x.text}</span>
                {x.tab !== current.id && <button type="button" className="link" onClick={() => onTab(x.tab)}>Show</button>}
              </li>
            ))}
          </ul>
        )}

        {current.Body ? (
          <current.Body p={p} set={set} setMany={setMany} caps={caps} />
        ) : (
          <JsonEditor preset={p} onApply={(obj) => setDraft((d) => ({ ...d, preset: obj }))} />
        )}
      </div>
      <div className="save-bar" role="region" aria-label="Preset editor actions">
        <span className="small muted">
          {dirty ? 'Unsaved changes' : 'No changes'}
          {caps.source !== 'handbrake' && ' · HandBrakeCLI not found: options are a generic list'}
        </span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={cancel} disabled={saving}>{dirty ? 'Cancel' : 'Close'}</button>
        <button type="button" className="btn" onClick={saveAsNew} disabled={saving || blocked}>Save as new…</button>
        <button type="button" className="btn primary" onClick={save} disabled={saving || blocked || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </>
  );
}

/** The draft as JSON; valid edits can be applied back to the form. */
function JsonEditor({ preset, onApply }) {
  const text = useMemo(() => JSON.stringify(preset, null, 2), [preset]);
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  let error = null;
  let parsed = null;
  try {
    parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error = 'The preset must be a JSON object ({ … }).';
  } catch (e) {
    error = e.message;
  }
  return (
    <Card title="JSON" help="presets.editor">
      <p className="set-hint">
        Every setting of the preset, as HandBrake stores it. Settings the tabs don’t show can be changed here. The name and
        description always come from the fields above.
      </p>
      <textarea className="code-block pe-json" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} rows={24} aria-label="Preset JSON" />
      <div className="set-actions">
        <button type="button" className="btn" disabled={value === text} onClick={() => setValue(text)}>Undo JSON edits</button>
        <button type="button" className="btn primary" disabled={!!error || value === text} onClick={() => onApply(parsed)}>Apply to the form</button>
        {error && value !== text && <span className="text-bad small">{error}</span>}
      </div>
    </Card>
  );
}
