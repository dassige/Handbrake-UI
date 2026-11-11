import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { Card } from '../settings/fields.jsx';
import { t } from '../i18n/index.js';
import { Text } from './editorFields.jsx';
import { DimensionsTab, FiltersTab, SummaryTab, VideoTab } from './EditorTabs.jsx';
import { AudioTab, SubtitlesTab } from './AudioSubtitleTabs.jsx';
import { VIDEO_ENCODERS, audioEncoderLabel, audioMuxers, muxer, qualityLimits, videoMuxers } from './hbOptions.js';

// The same tabs as the HandBrake desktop app, plus the raw JSON ("JSON" is not translated).
const TABS = [
  { id: 'summary', labelKey: 'presets.tabs.summary', Body: SummaryTab },
  { id: 'dimensions', labelKey: 'presets.tabs.dimensions', Body: DimensionsTab },
  { id: 'filters', labelKey: 'presets.tabs.filters', Body: FiltersTab },
  { id: 'video', labelKey: 'presets.tabs.video', Body: VideoTab },
  { id: 'audio', labelKey: 'presets.tabs.audio', Body: AudioTab },
  { id: 'subtitles', labelKey: 'presets.tabs.subtitles', Body: SubtitlesTab },
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
 * The text is in the current language: call it when rendering, don't keep the result.
 */
export function presetProblems(p, caps) {
  const out = [];
  const mux = muxer(p.FileFormat);
  if (!videoMuxers(p.VideoEncoder).includes(mux)) {
    out.push({ block: true, tab: 'summary', text: t('presets.editor.problems.videoMuxer', { encoder: VIDEO_ENCODERS[p.VideoEncoder] ?? p.VideoEncoder, container: MUXER_NAME[mux] }) });
  }
  (p.AudioList ?? []).forEach((a, i) => {
    if (!audioMuxers(a.AudioEncoder).includes(mux)) {
      out.push({ block: true, tab: 'audio', text: t('presets.editor.problems.audioMuxer', { number: i + 1, encoder: audioEncoderLabel(a.AudioEncoder), container: MUXER_NAME[mux] }) });
    }
  });
  if (p.VideoQualityType === 2 && !qualityLimits(p.VideoEncoder)) {
    out.push({ block: true, tab: 'video', text: t('presets.editor.problems.noQualityMode') });
  }
  if (caps.source === 'handbrake') {
    if (!caps.videoEncoders.some((e) => e.name === p.VideoEncoder)) {
      out.push({ tab: 'video', text: t('presets.editor.problems.missingVideoEncoder', { encoder: VIDEO_ENCODERS[p.VideoEncoder] ?? p.VideoEncoder }) });
    }
    const missing = (p.AudioList ?? []).filter((a) => !caps.audioEncoders.includes(a.AudioEncoder)).map((a) => audioEncoderLabel(a.AudioEncoder));
    if (missing.length) out.push({ tab: 'audio', text: t('presets.editor.problems.missingAudioEncoder', { encoders: [...new Set(missing)].join(', ') }) });
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

  // Not memoised: the texts follow the UI language.
  const problems = draft && caps ? presetProblems(draft.preset, caps) : [];
  const blocked = problems.some((x) => x.block) || !draft?.name.trim();

  if (!draft || !caps) {
    return (
      <div className="page-content">
        <p className="muted pe-loading">
          <Loader2 size={16} className="spin" /> {t('presets.editor.loading')}
        </p>
      </div>
    );
  }

  const p = draft.preset;
  const set = (key, value) => setDraft((d) => ({ ...d, preset: { ...d.preset, [key]: value } }));
  const setMany = (patch) => setDraft((d) => ({ ...d, preset: { ...d.preset, ...patch } }));
  const setProp = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const current = TABS.find((x) => x.id === tab) ?? TABS[0];
  const body = { preset: draft.preset, version: draft.version, name: draft.name, category: draft.category, description: draft.description };

  async function save() {
    setSaving(true);
    const r = await run(() => api.updatePreset(presetId, body), t('presets.editor.saved', { name: draft.name.trim() }));
    setSaving(false);
    if (r) {
      dirtyRef.current = false;
      onSaved(presetId);
    }
  }

  async function saveAsNew() {
    const name = await dialogs.prompt({
      title: t('presets.editor.saveAsNewTitle'),
      message: t('presets.editor.saveAsNewMessage'),
      label: t('presets.editor.saveAsNewLabel'),
      value: t('presets.editor.copyName', { name: draft.name.trim() }),
      confirmLabel: t('presets.editor.saveNewPreset'),
    });
    if (!name) return;
    setSaving(true);
    const r = await run(() => api.createPreset({ ...body, name }), t('presets.editor.saved', { name }));
    setSaving(false);
    if (r) {
      dirtyRef.current = false;
      onSaved(r.id);
    }
  }

  async function cancel() {
    if (dirty && !(await dialogs.confirm({ title: t('common.unsavedChanges'), message: t('presets.discard.message'), confirmLabel: t('presets.discard.confirm'), cancelLabel: t('presets.discard.keepEditing'), danger: true }))) return;
    onClose();
  }

  return (
    <>
      <div className="page-content preset-editor">
        <header className="page-head">
          <h1>{t('presets.editor.title')}<Help id="presets.editor" /></h1>
          <span className="muted">{base.name}</span>
        </header>
        <Card title={t('presets.editor.presetCard')}>
          <div className="pe-grid pe-props">
            <Text label={t('common.name')} value={draft.name} onChange={(v) => setProp('name', v)} maxLength={120} />
            <label className="set-field">
              <span className="set-label">{t('presets.editor.category')}</span>
              <input value={draft.category} list="preset-categories" onChange={(e) => setProp('category', e.target.value)} placeholder={t('common.none')} maxLength={80} />
              <datalist id="preset-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>
          <Text label={t('presets.editor.description')} value={draft.description} onChange={(v) => setProp('description', v)} maxLength={300} placeholder={t('presets.editor.descriptionPlaceholder')} />
        </Card>

        <div className="seg pe-tabs" role="tablist" aria-label={t('presets.editor.tabsLabel')}>
          {TABS.map((tb) => {
            const flagged = problems.some((x) => x.tab === tb.id);
            return (
              <button key={tb.id} type="button" role="tab" aria-selected={current.id === tb.id} className={current.id === tb.id ? 'active' : ''} onClick={() => onTab(tb.id)}>
                {tb.labelKey ? t(tb.labelKey) : tb.label}
                {flagged && <span className="pe-tab-flag" aria-label={t('presets.editor.hasProblem')} />}
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
                {x.tab !== current.id && <button type="button" className="link" onClick={() => onTab(x.tab)}>{t('presets.editor.show')}</button>}
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
      <div className="save-bar" role="region" aria-label={t('presets.editor.actionsLabel')}>
        <span className="small muted">
          {dirty ? t('common.unsavedChanges') : t('presets.editor.noChanges')}
          {caps.source !== 'handbrake' && ` · ${t('presets.editor.noHandBrake')}`}
        </span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={cancel} disabled={saving}>{dirty ? t('common.cancel') : t('common.close')}</button>
        <button type="button" className="btn" onClick={saveAsNew} disabled={saving || blocked}>{t('presets.editor.saveAsNew')}</button>
        <button type="button" className="btn primary" onClick={save} disabled={saving || blocked || !dirty}>{saving ? t('common.saving') : t('common.save')}</button>
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error = t('presets.editor.json.notObject');
  } catch (e) {
    error = e.message;
  }
  return (
    <Card title="JSON" help="presets.editor">
      <p className="set-hint">{t('presets.editor.json.hint')}</p>
      <textarea className="code-block pe-json" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} rows={24} aria-label={t('presets.editor.json.label')} />
      <div className="set-actions">
        <button type="button" className="btn" disabled={value === text} onClick={() => setValue(text)}>{t('presets.editor.json.undo')}</button>
        <button type="button" className="btn primary" disabled={!!error || value === text} onClick={() => onApply(parsed)}>{t('presets.editor.json.apply')}</button>
        {error && value !== text && <span className="text-bad small">{error}</span>}
      </div>
    </Card>
  );
}
