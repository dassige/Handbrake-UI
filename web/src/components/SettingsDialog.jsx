import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from './Modal.jsx';
import { Help } from '../help/Help.jsx';

const LAYOUTS = [
  { value: 'parent', label: 'Source folder name', example: 'target/Show.S01/episode.mkv' },
  { value: 'mirror', label: 'Full source path', example: 'target/Completed/Show.S01/episode.mkv' },
  { value: 'flat', label: 'All in the target folder', example: 'target/episode.mkv' },
];

const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

const RESOLUTIONS = [
  { value: 0, label: 'No check' },
  { value: 480, label: '480p (DVD NTSC)' },
  { value: 576, label: '576p (DVD PAL)' },
  { value: 720, label: '720p (HD)' },
  { value: 1080, label: '1080p (Full HD)' },
  { value: 2160, label: '2160p (4K)' },
];
const KBPS_CLASSES = [
  { id: 'sd', label: 'SD' },
  { id: 'hd', label: '720p' },
  { id: 'fhd', label: '1080p' },
  { id: 'uhd', label: '4K' },
];

export function SettingsDialog({ settings, info, renameRules = [], run, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({
    ...settings,
    videoExtensions: settings.videoExtensions.join(', '),
    excludePatterns: settings.excludePatterns.join(', '),
  }));
  const [roots, setRoots] = useState(() => [...settings.sourceRoots]);
  const [quality, setQuality] = useState(() => ({
    ...settings.quality,
    badVideoCodecs: settings.quality.badVideoCodecs.join(', '),
    badAudioCodecs: settings.quality.badAudioCodecs.join(', '),
    badContainers: settings.quality.badContainers.join(', '),
    efficientCodecs: settings.quality.efficientCodecs.join(', '),
    efficientPercent: Math.round(settings.quality.efficientFactor * 100),
    minKbps: { ...settings.quality.minKbps },
  }));
  const setQ = (k) => (e) => setQuality((q) => ({ ...q, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const r = await run(
      () =>
        api.saveSettings({
          sourceRoots: roots.map((r) => r.trim()).filter(Boolean),
          targetRoot: form.targetRoot.trim(),
          outputLayout: form.outputLayout,
          recursive: form.recursive,
          skipConverted: form.skipConverted,
          videoExtensions: toList(form.videoExtensions),
          excludePatterns: toList(form.excludePatterns),
          niceLevel: Number(form.niceLevel),
          autoRename: form.autoRename,
          autoRenameRuleId: form.autoRenameRuleId ? Number(form.autoRenameRuleId) : null,
          renameSeparator: form.renameSeparator,
          verifyMode: form.verifyMode,
          quality: {
            badVideoCodecs: toList(quality.badVideoCodecs),
            badAudioCodecs: toList(quality.badAudioCodecs),
            badContainers: toList(quality.badContainers),
            minHeight: Number(quality.minHeight),
            minKbps: Object.fromEntries(KBPS_CLASSES.map((c) => [c.id, Number(quality.minKbps[c.id]) || 0])),
            efficientCodecs: toList(quality.efficientCodecs),
            efficientFactor: Number(quality.efficientPercent) / 100,
            flagInterlaced: quality.flagInterlaced,
          },
        }),
      'Settings saved',
    );
    setSaving(false);
    if (r) {
      onSaved(r);
      onClose();
    }
  }

  const hb = info?.handbrake;

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="settings-form" disabled={saving}>Save</button>
        </>
      }
    >
      <form id="settings-form" className="settings" onSubmit={save}>
        <fieldset>
          <legend>Folders (paths on the server)<Help id="settings.folders" /></legend>
          <div className="root-list">
            <span className="muted small">Sources folders (where videos to convert are)</span>
            {roots.map((r, i) => (
              <div key={i} className="inline-form">
                <input
                  value={r}
                  onChange={(e) => setRoots((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                  required
                  spellCheck={false}
                  aria-label={`Sources folder ${i + 1}`}
                  placeholder="/mnt/..."
                />
                <button
                  type="button"
                  className="icon-btn danger"
                  disabled={roots.length < 2}
                  title={roots.length < 2 ? 'At least one sources folder is needed' : 'Remove this folder from the list (nothing is deleted)'}
                  onClick={() => setRoots((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button type="button" className="btn small add-root" onClick={() => setRoots((list) => [...list, ''])}>
              <Plus size={14} /> Add a sources folder
            </button>
          </div>
          <label>
            Target folder
            <input value={form.targetRoot} onChange={set('targetRoot')} required spellCheck={false} />
          </label>
          <p className="muted small">
            All must already exist on the server. The target cannot be inside a sources folder, and a sources folder cannot be
            inside another one.
          </p>
        </fieldset>

        <fieldset>
          <legend>Output folder layout<Help id="settings.layout" /></legend>
          {LAYOUTS.map((l) => (
            <label key={l.value} className="radio">
              <input type="radio" name="layout" value={l.value} checked={form.outputLayout === l.value} onChange={set('outputLayout')} />
              <span>
                {l.label}
                <code className="small">{l.example}</code>
              </span>
            </label>
          ))}
          <p className="muted small">If a file with the same name exists, the new one gets a suffix: “episode (1).mkv”.</p>
        </fieldset>

        <fieldset>
          <legend>Adding folders<Help id="settings.adding" /></legend>
          <label className="check">
            <input type="checkbox" checked={form.recursive} onChange={set('recursive')} />
            Include sub-folders
          </label>
          <label className="check">
            <input type="checkbox" checked={form.skipConverted} onChange={set('skipConverted')} />
            Skip files that were already converted (use “Convert again” to redo one)
          </label>
          <label>
            Video file extensions
            <input value={form.videoExtensions} onChange={set('videoExtensions')} spellCheck={false} />
          </label>
          <label>
            Skip files and folders containing these words
            <input value={form.excludePatterns} onChange={set('excludePatterns')} spellCheck={false} placeholder="sample" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Encoding<Help id="settings.encoding" /></legend>
          <label>
            CPU priority (nice 0–19, higher = gentler on other services)
            <input type="number" min="0" max="19" value={form.niceLevel} onChange={set('niceLevel')} />
          </label>
          <label>
            <span>Check after conversion<Help id="verify.overview" /></span>
            <select value={form.verifyMode} onChange={set('verifyMode')}>
              <option value="full">Full: lengths, tracks and a complete decode (about 1–2 min per episode)</option>
              <option value="quick">Quick: lengths and tracks, no decode (seconds)</option>
              <option value="off">Off</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Quality check<Help id="settings.quality" /></legend>
          <label>
            Lowest acceptable resolution
            <select value={quality.minHeight} onChange={setQ('minHeight')}>
              {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <span className="muted small">Lowest acceptable video bitrate (kbps) for H.264-class video; 0 = no check</span>
          <div className="kbps-grid">
            {KBPS_CLASSES.map((c) => (
              <label key={c.id}>
                {c.label}
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={quality.minKbps[c.id]}
                  onChange={(e) => setQuality((q) => ({ ...q, minKbps: { ...q.minKbps, [c.id]: e.target.value } }))}
                />
              </label>
            ))}
          </div>
          <div className="kbps-grid two">
            <label>
              Efficient codecs
              <input value={quality.efficientCodecs} onChange={setQ('efficientCodecs')} spellCheck={false} />
            </label>
            <label>
              …need this % of the bitrate
              <input type="number" min="10" max="100" step="5" value={quality.efficientPercent} onChange={setQ('efficientPercent')} />
            </label>
          </div>
          <label>
            Old video codecs (ffprobe names)
            <input value={quality.badVideoCodecs} onChange={setQ('badVideoCodecs')} spellCheck={false} />
          </label>
          <label>
            Old audio codecs
            <input value={quality.badAudioCodecs} onChange={setQ('badAudioCodecs')} spellCheck={false} />
          </label>
          <label>
            Old containers (file extensions)
            <input value={quality.badContainers} onChange={setQ('badContainers')} spellCheck={false} />
          </label>
          <label className="check">
            <input type="checkbox" checked={quality.flagInterlaced} onChange={setQ('flagInterlaced')} />
            Flag interlaced video
          </label>
          <p className="muted small">
            Changes apply to existing results straight away; no new check is needed.
          </p>
        </fieldset>

        <fieldset>
          <legend>Renaming<Help id="settings.renaming" /></legend>
          <label className="check">
            <input type="checkbox" checked={form.autoRename} onChange={set('autoRename')} />
            Rename files automatically after conversion
          </label>
          <label>
            Rule set for automatic renaming
            <select value={form.autoRenameRuleId ?? ''} onChange={set('autoRenameRuleId')} disabled={!form.autoRename}>
              <option value="">{renameRules[0]?.name ?? 'first rule set'} (default)</option>
              {renameRules.slice(1).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <p className="muted small">
            A file is renamed automatically only if the rules recognise it without warnings; otherwise the job is
            marked “Needs rename” and you finish it in the Rename view.
          </p>
          <label>
            Separator before the number when a name is taken (name_1.mkv)
            <input value={form.renameSeparator} maxLength={3} onChange={set('renameSeparator')} style={{ width: 80 }} />
          </label>
        </fieldset>

        <fieldset>
          <legend>About</legend>
          <p className="small">
            HandBrake Queue {info?.app} ·{' '}
            {hb?.error ? <span className="text-bad">{hb.error}</span> : <>HandBrakeCLI {hb?.version ?? '…'}</>}
          </p>
          {hb?.encoders?.length > 0 && <p className="muted small">Video encoders: {hb.encoders.join(', ')}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
