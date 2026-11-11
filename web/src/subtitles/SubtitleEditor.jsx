import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { t } from '../i18n/index.js';
import { CODESETS, cueTime, FPS_VALUES } from './modes.js';

const SHOW = 400;
const EMPTY = { offsetMs: 0, fps: null, codeset: null, cleanup: {} };
const CLEANUP = [
  { key: 'hi', labelKey: 'subtitles.editor.cleanHi', hintKey: 'subtitles.editor.cleanHiHint' },
  { key: 'tags', labelKey: 'subtitles.editor.cleanTags', hintKey: 'subtitles.editor.cleanTagsHint' },
  { key: 'ads', labelKey: 'subtitles.editor.cleanAds', hintKey: 'subtitles.editor.cleanAdsHint' },
  { key: 'overlaps', labelKey: 'subtitles.editor.cleanOverlaps', hintKey: 'subtitles.editor.cleanOverlapsHint' },
];

const fromFile = (e) => ({ ...EMPTY, ...e, cleanup: { ...(e?.cleanup ?? {}) } });

/**
 * Edits one sidecar of a job: timing, frame rate, codeset and clean-up, with a live preview.
 * The source file is never changed: the edits are kept with the job and applied to the copies
 * HandBrake gets and to the files written to the target folder.
 */
export function SubtitleEditor({ job, file, readOnly, run, onClose, onSaved }) {
  const [edits, setEdits] = useState(() => fromFile(file.edits));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Preview, a moment after the last change.
  const key = JSON.stringify(edits);
  useEffect(() => {
    let stop = false;
    const timer = setTimeout(() => {
      api.previewJobSubtitle(job.id, file.path, edits).then(
        (r) => {
          if (stop) return;
          setPreview(r);
          setError(null);
        },
        (e) => !stop && setError(e.message),
      );
    }, 250);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job.id, file.path, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setEdits((e) => ({ ...e, ...patch }));
  const setCleanup = (k, v) => setEdits((e) => ({ ...e, cleanup: { ...e.cleanup, [k]: v } }));
  const nudge = (ms) => set({ offsetMs: (Number(edits.offsetMs) || 0) + ms });

  const cues = (showOriginal ? preview?.original : preview?.edited) ?? [];
  const byIndex = useMemo(() => new Map((preview?.original ?? []).map((c) => [c.src, c])), [preview]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? cues.filter((c) => c.text.toLowerCase().includes(q)) : cues;
  }, [cues, search]);
  const first = preview?.edited?.[0];
  const firstBefore = first && byIndex.get(first.src);

  async function save() {
    setSaving(true);
    const r = await run(() => api.updateJobSubtitles(job.id, { files: [{ path: file.path, edits }] }), t('subtitles.editor.saved'));
    setSaving(false);
    if (r) onSaved(r);
  }

  return (
    <Modal
      title={<>{t('subtitles.editor.title', { name: file.name })}<Help id="subtitles.editor" /></>}
      ariaLabel={t('subtitles.editor.title', { name: file.name })}
      onClose={onClose}
      wide
      className="sub-editor"
      footer={
        <>
          {!readOnly && (
            <button className="btn" onClick={() => setEdits({ ...EMPTY })} title={t('subtitles.editor.resetTitle')}>
              <RotateCcw size={14} /> {t('subtitles.editor.reset')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{readOnly ? t('common.close') : t('common.cancel')}</button>
          {!readOnly && <button className="btn primary" onClick={save} disabled={saving}>{t('common.save')}</button>}
        </>
      }
    >
      {readOnly && <p className="muted small">{t('subtitles.editor.readOnly')}</p>}
      <p className="muted small">{t('subtitles.editor.sourceKept')}</p>
      <fieldset className="sub-edit-grid" disabled={readOnly}>
        <div className="set-field">
          <span className="set-label">{t('subtitles.editor.offset')}</span>
          <span className="row-inline">
            <button type="button" className="btn small" onClick={() => nudge(-1000)}>−1 s</button>
            <button type="button" className="btn small" onClick={() => nudge(-100)}>−0.1 s</button>
            <input
              type="number"
              step="100"
              className="narrow"
              value={edits.offsetMs ?? 0}
              onChange={(e) => set({ offsetMs: e.target.value === '' ? 0 : Number(e.target.value) })}
              aria-label={t('subtitles.editor.offsetMs')}
            />
            <span className="muted small">ms</span>
            <button type="button" className="btn small" onClick={() => nudge(100)}>+0.1 s</button>
            <button type="button" className="btn small" onClick={() => nudge(1000)}>+1 s</button>
          </span>
          <span className="set-hint">{t('subtitles.editor.offsetHint')}</span>
        </div>

        <div className="set-field">
          <span className="set-label">{t('subtitles.editor.fps')}</span>
          <span className="row-inline">
            <select value={edits.fps?.from ?? ''} onChange={(e) => set({ fps: e.target.value ? { from: Number(e.target.value), to: edits.fps?.to ?? 25 } : null })} aria-label={t('subtitles.editor.fpsFrom')}>
              <option value="">{t('subtitles.editor.fpsNone')}</option>
              {FPS_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <span>→</span>
            <select value={edits.fps?.to ?? ''} disabled={!edits.fps} onChange={(e) => set({ fps: { ...edits.fps, to: Number(e.target.value) } })} aria-label={t('subtitles.editor.fpsTo')}>
              {!edits.fps && <option value="">—</option>}
              {FPS_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {job.sourceInfo?.fps && <span className="muted small">{t('subtitles.editor.videoFps', { fps: job.sourceInfo.fps })}</span>}
          </span>
          <span className="set-hint">{t('subtitles.editor.fpsHint')}</span>
        </div>

        <div className="set-field">
          <span className="set-label">{t('subtitles.editor.codeset')}</span>
          <select value={edits.codeset ?? ''} onChange={(e) => set({ codeset: e.target.value || null })}>
            <option value="">
              {preview?.autoCodeset && preview.codeset ? t('subtitles.editor.codesetAutoFound', { codeset: preview.codeset }) : t('subtitles.editor.codesetAuto')}
            </option>
            {CODESETS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="set-hint">{t('subtitles.editor.codesetHint')}</span>
        </div>

        <div className="set-field">
          <span className="set-label">{t('subtitles.editor.cleanup')}</span>
          {CLEANUP.map((c) => (
            <label key={c.key} className="set-check">
              <input type="checkbox" checked={!!edits.cleanup?.[c.key]} onChange={(e) => setCleanup(c.key, e.target.checked)} />
              <span>
                {t(c.labelKey)}
                <span className="set-hint">{t(c.hintKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sub-preview">
        <div className="sub-preview-head">
          <strong>{t('subtitles.editor.preview')}</strong>
          {preview && !preview.image && (
            <span className="muted small">
              {t('subtitles.editor.count', { count: preview.edited.length })}
              {preview.removed > 0 && ` · ${t('subtitles.editor.removed', { count: preview.removed })}`}
              {first && firstBefore && first.start !== firstBefore.start && ` · ${t('subtitles.editor.firstMoved', { from: cueTime(firstBefore.start), to: cueTime(first.start) })}`}
            </span>
          )}
          <span className="spacer" />
          <label className="check small">
            <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
            {t('subtitles.editor.showOriginal')}
          </label>
          <span className="search-box">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('subtitles.editor.search')} aria-label={t('subtitles.editor.search')} />
          </span>
        </div>
        {error && <p className="text-bad">{error}</p>}
        {!preview && !error && <p className="muted">{t('common.loading')}</p>}
        {preview && (
          <ol className="cue-list">
            {visible.slice(0, SHOW).map((c, i) => (
              <li key={`${c.src}-${i}`}>
                <span className="cue-time">{cueTime(c.start)} → {cueTime(c.end)}</span>
                <span className="cue-text">{c.text}</span>
              </li>
            ))}
            {visible.length > SHOW && <li className="muted">{t('subtitles.editor.more', { count: visible.length - SHOW })}</li>}
            {!visible.length && <li className="muted">{search ? t('subtitles.editor.noMatch') : t('subtitles.editor.empty')}</li>}
          </ol>
        )}
      </div>
    </Modal>
  );
}
