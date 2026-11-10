import { Lock, Plus, Trash2 } from 'lucide-react';
import { Card, Check, Field, ListInput, NumberInput } from './fields.jsx';
import { rootLabel } from '../roots.js';

const LAYOUTS = [
  { value: 'parent', label: 'Source folder name', example: 'target/Show.S01/episode.mkv' },
  { value: 'mirror', label: 'Full source path', example: 'target/Completed/Show.S01/episode.mkv' },
  { value: 'flat', label: 'All in the target folder', example: 'target/episode.mkv' },
];

export function FoldersSection({ draft, set }) {
  const roots = draft.sourceRoots;
  const locked = new Set(draft.protectedRoots);
  const names = draft.sourceNames ?? {};
  const setPath = (i, value) => {
    const old = roots[i];
    set('sourceRoots', roots.map((r, j) => (j === i ? value : r)));
    if (locked.has(old)) set('protectedRoots', draft.protectedRoots.map((r) => (r === old ? value : r)));
    if (old in names) {
      const { [old]: name, ...rest } = names;
      set('sourceNames', { ...rest, [value]: name });
    }
  };
  const setName = (path, name) => {
    const { [path]: _, ...rest } = names;
    set('sourceNames', name ? { ...rest, [path]: name } : rest);
  };
  const setLocked = (path, on) =>
    set('protectedRoots', on ? [...draft.protectedRoots, path] : draft.protectedRoots.filter((r) => r !== path));

  return (
    <>
      <Card title="Sources folders" help="settings.folders">
        <p className="set-hint">
          Where the videos to convert are, as paths on the server. A <strong>name</strong> is shown instead of the path in the
          app (e.g. “Downloads”). <strong>Protect</strong> a folder to stop its files being deleted from the app (e.g. while a
          download client is seeding them).
        </p>
        <div className="root-list">
          {roots.map((r, i) => (
            <div key={i} className="inline-form root-row">
              <input
                className="root-name"
                value={names[r] ?? ''}
                maxLength={40}
                onChange={(e) => setName(r, e.target.value)}
                placeholder={rootLabel({ sourceNames: {} }, r) || 'Name'}
                aria-label={`Name of sources folder ${i + 1}`}
                title="Friendly name shown instead of the path"
              />
              <input
                className="root-path"
                value={r}
                onChange={(e) => setPath(i, e.target.value)}
                required
                spellCheck={false}
                aria-label={`Sources folder ${i + 1}`}
                placeholder="/mnt/..."
              />
              <label className={`check protect ${locked.has(r) ? 'on' : ''}`} title="Protect: files and folders in here can't be deleted from the app">
                <input type="checkbox" checked={locked.has(r)} onChange={(e) => setLocked(r, e.target.checked)} aria-label={`Protect sources folder ${i + 1} from deletion`} />
                <Lock size={13} /> Protect
              </label>
              <button
                type="button"
                className="icon-btn danger"
                disabled={roots.length < 2}
                title={roots.length < 2 ? 'At least one sources folder is needed' : 'Remove this folder from the list (nothing is deleted)'}
                onClick={() => {
                  set('sourceRoots', roots.filter((_, j) => j !== i));
                  set('protectedRoots', draft.protectedRoots.filter((p) => p !== r));
                  setName(r, '');
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="btn small add-root" onClick={() => set('sourceRoots', [...roots, ''])}>
            <Plus size={14} /> Add a sources folder
          </button>
        </div>
      </Card>
      <Card title="Target folder">
        <Field label="Converted files are written here" hint="All folders must already exist on the server. The target cannot be inside a sources folder, and a sources folder cannot be inside another one.">
          <input value={draft.targetRoot} onChange={(e) => set('targetRoot', e.target.value)} required spellCheck={false} />
        </Field>
      </Card>
    </>
  );
}

export function AddingSection({ draft, set }) {
  return (
    <Card title="When you add a folder" help="settings.adding">
      <Check checked={draft.recursive} onChange={(v) => set('recursive', v)}>Include sub-folders</Check>
      <Check checked={draft.skipConverted} onChange={(v) => set('skipConverted', v)} hint="Use “Convert again” in the job details to redo one.">
        Skip files that were already converted
      </Check>
      <Field label="Video file extensions">
        <ListInput value={draft.videoExtensions} onChange={(v) => set('videoExtensions', v)} />
      </Field>
      <Field label="Skip files and folders containing these words" hint="Whole words, any case: “sample” skips “Show.S01E01.sample.mkv”.">
        <ListInput value={draft.excludePatterns} onChange={(v) => set('excludePatterns', v)} placeholder="sample" />
      </Field>
    </Card>
  );
}

export function OutputSection({ draft, set }) {
  return (
    <Card title="Output folder layout" help="settings.layout">
      <div className="set-radios">
        {LAYOUTS.map((l) => (
          <label key={l.value} className="radio">
            <input type="radio" name="layout" value={l.value} checked={draft.outputLayout === l.value} onChange={() => set('outputLayout', l.value)} />
            <span>
              {l.label}
              <code className="small">{l.example}</code>
            </span>
          </label>
        ))}
      </div>
      <p className="set-hint">If a file with the same name exists, the new one gets a suffix: “episode (1).mkv”.</p>
    </Card>
  );
}

export function EncodingSection({ draft, set }) {
  return (
    <>
      <Card title="Encoding" help="settings.encoding">
        <Field label="CPU priority (nice)" hint="0–19. Higher is gentler on other services on the server (media server, downloads); encodes take a little longer.">
          <NumberInput min="0" max="19" value={draft.niceLevel} onChange={(v) => set('niceLevel', v)} className="narrow" />
        </Field>
      </Card>
      <Card title="Check after conversion" help="verify.overview">
        <div className="set-radios">
          {[
            ['full', 'Full', 'Lengths, tracks and a complete decode of every frame (about 1–2 min per episode).'],
            ['quick', 'Quick', 'Lengths and tracks, no decode (seconds).'],
            ['off', 'Off', 'Files count as converted as soon as HandBrake finishes.'],
          ].map(([value, label, hint]) => (
            <label key={value} className="radio">
              <input type="radio" name="verify" checked={draft.verifyMode === value} onChange={() => set('verifyMode', value)} />
              <span>
                {label}
                <span className="muted small">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </>
  );
}

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

export function QualitySection({ draft, set }) {
  const q = draft.quality;
  const setQ = (k, v) => set('quality', { ...q, [k]: v });
  return (
    <>
      <Card title="Resolution and bitrate" help="settings.quality">
        <Field label="Lowest acceptable resolution">
          <select value={q.minHeight} onChange={(e) => setQ('minHeight', Number(e.target.value))}>
            {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        <span className="set-label">Lowest acceptable video bitrate (kbps) for H.264-class video; 0 = no check</span>
        <div className="kbps-grid">
          {KBPS_CLASSES.map((c) => (
            <Field key={c.id} label={c.label}>
              <NumberInput min="0" step="50" value={q.minKbps[c.id]} onChange={(v) => setQ('minKbps', { ...q.minKbps, [c.id]: v })} />
            </Field>
          ))}
        </div>
        <div className="kbps-grid two">
          <Field label="Efficient codecs">
            <ListInput value={q.efficientCodecs} onChange={(v) => setQ('efficientCodecs', v)} />
          </Field>
          <Field label="…need this % of the bitrate">
            <NumberInput
              min="10"
              max="100"
              step="5"
              value={q.efficientFactor === '' ? '' : Math.round(q.efficientFactor * 100)}
              onChange={(v) => setQ('efficientFactor', v === '' ? '' : v / 100)}
            />
          </Field>
        </div>
      </Card>
      <Card title="Old formats">
        <Field label="Old video codecs (ffprobe names)">
          <ListInput value={q.badVideoCodecs} onChange={(v) => setQ('badVideoCodecs', v)} />
        </Field>
        <Field label="Old audio codecs">
          <ListInput value={q.badAudioCodecs} onChange={(v) => setQ('badAudioCodecs', v)} />
        </Field>
        <Field label="Old containers (file extensions)">
          <ListInput value={q.badContainers} onChange={(v) => setQ('badContainers', v)} />
        </Field>
        <Check checked={q.flagInterlaced} onChange={(v) => setQ('flagInterlaced', v)}>Flag interlaced video</Check>
        <p className="set-hint">Changes apply to existing results straight away; no new check is needed.</p>
      </Card>
    </>
  );
}

export function RenamingSection({ draft, set, renameRules }) {
  return (
    <Card title="Renaming" help="settings.renaming">
      <Check
        checked={draft.autoRename}
        onChange={(v) => set('autoRename', v)}
        hint="Only files the rules recognise without warnings are renamed; the rest are marked “Needs rename” for the Rename view."
      >
        Rename files automatically after conversion
      </Check>
      <Field label="Rule set for automatic renaming">
        <select value={draft.autoRenameRuleId ?? ''} onChange={(e) => set('autoRenameRuleId', e.target.value ? Number(e.target.value) : null)} disabled={!draft.autoRename}>
          <option value="">{renameRules[0]?.name ?? 'first rule set'} (default)</option>
          {renameRules.slice(1).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Separator before the number when a name is taken" hint="name_1.mkv">
        <input value={draft.renameSeparator} maxLength={3} onChange={(e) => set('renameSeparator', e.target.value)} className="narrow" />
      </Field>
    </Card>
  );
}
