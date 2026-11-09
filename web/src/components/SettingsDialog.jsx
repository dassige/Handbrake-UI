import { useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modal.jsx';

const LAYOUTS = [
  { value: 'parent', label: 'Source folder name', example: 'target/Show.S01/episode.mkv' },
  { value: 'mirror', label: 'Full source path', example: 'target/Completed/Show.S01/episode.mkv' },
  { value: 'flat', label: 'All in the target folder', example: 'target/episode.mkv' },
];

const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function SettingsDialog({ settings, info, renameRules = [], run, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({
    ...settings,
    videoExtensions: settings.videoExtensions.join(', '),
    excludePatterns: settings.excludePatterns.join(', '),
  }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const r = await run(
      () =>
        api.saveSettings({
          sourceRoot: form.sourceRoot.trim(),
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
          <legend>Folders (paths on the server)</legend>
          <label>
            Sources folder
            <input value={form.sourceRoot} onChange={set('sourceRoot')} required spellCheck={false} />
          </label>
          <label>
            Target folder
            <input value={form.targetRoot} onChange={set('targetRoot')} required spellCheck={false} />
          </label>
          <p className="muted small">Both must already exist. The target cannot be inside the sources folder.</p>
        </fieldset>

        <fieldset>
          <legend>Output folder layout</legend>
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
          <legend>Adding folders</legend>
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
          <legend>Encoding</legend>
          <label>
            CPU priority (nice 0–19, higher = gentler on other services)
            <input type="number" min="0" max="19" value={form.niceLevel} onChange={set('niceLevel')} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Renaming</legend>
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
