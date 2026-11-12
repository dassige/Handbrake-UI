import { Lock, Plus, Trash2 } from 'lucide-react';
import { Card, Check, Field, ListInput, NumberInput } from './fields.jsx';
import { rootLabel } from '../roots.js';
import { rich, t } from '../i18n/index.js';

const LAYOUTS = [
  { value: 'parent', labelKey: 'settings.output.layout.parent', example: 'target/Show.S01/episode.mkv' },
  { value: 'season', labelKey: 'settings.output.layout.season', example: 'target/Show/S01/episode.mkv' },
  { value: 'mirror', labelKey: 'settings.output.layout.mirror', example: 'target/Completed/Show.S01/episode.mkv' },
  { value: 'flat', labelKey: 'settings.output.layout.flat', example: 'target/episode.mkv' },
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
      <Card title={t('settings.folders.sourcesTitle')} help="settings.folders">
        <p className="set-hint">{rich('settings.folders.sourcesHint')}</p>
        <div className="root-list">
          {roots.map((r, i) => (
            <div key={i} className="inline-form root-row">
              <input
                className="root-name"
                value={names[r] ?? ''}
                maxLength={40}
                onChange={(e) => setName(r, e.target.value)}
                placeholder={rootLabel({ sourceNames: {} }, r) || t('common.name')}
                aria-label={t('settings.folders.nameLabel', { number: i + 1 })}
                title={t('settings.folders.nameTitle')}
              />
              <input
                className="root-path"
                value={r}
                onChange={(e) => setPath(i, e.target.value)}
                required
                spellCheck={false}
                aria-label={t('settings.folders.pathLabel', { number: i + 1 })}
                placeholder="/mnt/..."
              />
              <label className={`check protect ${locked.has(r) ? 'on' : ''}`} title={t('settings.folders.protectTitle')}>
                <input type="checkbox" checked={locked.has(r)} onChange={(e) => setLocked(r, e.target.checked)} aria-label={t('settings.folders.protectLabel', { number: i + 1 })} />
                <Lock size={13} /> {t('settings.folders.protect')}
              </label>
              <button
                type="button"
                className="icon-btn danger"
                disabled={roots.length < 2}
                title={roots.length < 2 ? t('settings.folders.removeLast') : t('settings.folders.remove')}
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
            <Plus size={14} /> {t('settings.folders.add')}
          </button>
        </div>
      </Card>
      <Card title={t('settings.folders.targetTitle')}>
        <Field label={t('settings.folders.targetLabel')} hint={t('settings.folders.targetHint')}>
          <input value={draft.targetRoot} onChange={(e) => set('targetRoot', e.target.value)} required spellCheck={false} />
        </Field>
      </Card>
    </>
  );
}

export function AddingSection({ draft, set }) {
  return (
    <Card title={t('settings.adding.title')} help="settings.adding">
      <Check checked={draft.recursive} onChange={(v) => set('recursive', v)}>{t('settings.adding.recursive')}</Check>
      <Check checked={draft.skipConverted} onChange={(v) => set('skipConverted', v)} hint={t('settings.adding.skipConvertedHint')}>
        {t('settings.adding.skipConverted')}
      </Check>
      <Field label={t('settings.adding.extensions')}>
        <ListInput value={draft.videoExtensions} onChange={(v) => set('videoExtensions', v)} />
      </Field>
      <Field label={t('settings.adding.exclude')} hint={t('settings.adding.excludeHint')}>
        <ListInput value={draft.excludePatterns} onChange={(v) => set('excludePatterns', v)} placeholder="sample" />
      </Field>
    </Card>
  );
}

export function OutputSection({ draft, set }) {
  return (
    <Card title={t('settings.output.title')} help="settings.layout">
      <div className="set-radios">
        {LAYOUTS.map((l) => (
          <label key={l.value} className="radio">
            <input type="radio" name="layout" value={l.value} checked={draft.outputLayout === l.value} onChange={() => set('outputLayout', l.value)} />
            <span>
              {t(l.labelKey)}
              <code className="small">{l.example}</code>
            </span>
          </label>
        ))}
      </div>
      <p className="set-hint">{t('settings.output.suffixHint')}</p>
    </Card>
  );
}

const VERIFY_MODES = [
  { value: 'full', labelKey: 'settings.encoding.verify.full', hintKey: 'settings.encoding.verify.fullHint' },
  { value: 'quick', labelKey: 'settings.encoding.verify.quick', hintKey: 'settings.encoding.verify.quickHint' },
  { value: 'off', labelKey: 'settings.encoding.verify.off', hintKey: 'settings.encoding.verify.offHint' },
];

export function EncodingSection({ draft, set }) {
  return (
    <>
      <Card title={t('settings.encoding.title')} help="settings.encoding">
        <Field label={t('settings.encoding.nice')} hint={t('settings.encoding.niceHint')}>
          <NumberInput min="0" max="19" value={draft.niceLevel} onChange={(v) => set('niceLevel', v)} className="narrow" />
        </Field>
      </Card>
      <Card title={t('settings.encoding.checkTitle')} help="verify.overview">
        <div className="set-radios">
          {VERIFY_MODES.map((m) => (
            <label key={m.value} className="radio">
              <input type="radio" name="verify" checked={draft.verifyMode === m.value} onChange={() => set('verifyMode', m.value)} />
              <span>
                {t(m.labelKey)}
                <span className="muted small">{t(m.hintKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </>
  );
}

// Resolution names are the same in every language; only "No check" is translated.
const RESOLUTIONS = [
  { value: 0, labelKey: 'settings.quality.noCheck' },
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
      <Card title={t('settings.quality.title')} help="settings.quality">
        <Field label={t('settings.quality.minHeight')}>
          <select value={q.minHeight} onChange={(e) => setQ('minHeight', Number(e.target.value))}>
            {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.labelKey ? t(r.labelKey) : r.label}</option>)}
          </select>
        </Field>
        <span className="set-label">{t('settings.quality.minKbps')}</span>
        <div className="kbps-grid">
          {KBPS_CLASSES.map((c) => (
            <Field key={c.id} label={c.label}>
              <NumberInput min="0" step="50" value={q.minKbps[c.id]} onChange={(v) => setQ('minKbps', { ...q.minKbps, [c.id]: v })} />
            </Field>
          ))}
        </div>
        <div className="kbps-grid two">
          <Field label={t('settings.quality.efficientCodecs')}>
            <ListInput value={q.efficientCodecs} onChange={(v) => setQ('efficientCodecs', v)} />
          </Field>
          <Field label={t('settings.quality.efficientFactor')}>
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
      <Card title={t('settings.quality.oldTitle')}>
        <Field label={t('settings.quality.badVideoCodecs')}>
          <ListInput value={q.badVideoCodecs} onChange={(v) => setQ('badVideoCodecs', v)} />
        </Field>
        <Field label={t('settings.quality.badAudioCodecs')}>
          <ListInput value={q.badAudioCodecs} onChange={(v) => setQ('badAudioCodecs', v)} />
        </Field>
        <Field label={t('settings.quality.badContainers')}>
          <ListInput value={q.badContainers} onChange={(v) => setQ('badContainers', v)} />
        </Field>
        <Check checked={q.flagInterlaced} onChange={(v) => setQ('flagInterlaced', v)}>{t('settings.quality.flagInterlaced')}</Check>
        <p className="set-hint">{t('settings.quality.applyHint')}</p>
      </Card>
    </>
  );
}

export function RenamingSection({ draft, set, renameRules }) {
  return (
    <Card title={t('settings.renaming.title')} help="settings.renaming">
      <Check
        checked={draft.autoRename}
        onChange={(v) => set('autoRename', v)}
        hint={t('settings.renaming.autoHint')}
      >
        {t('settings.renaming.auto')}
      </Check>
      <Field label={t('settings.renaming.ruleSet')}>
        <select value={draft.autoRenameRuleId ?? ''} onChange={(e) => set('autoRenameRuleId', e.target.value ? Number(e.target.value) : null)} disabled={!draft.autoRename}>
          <option value="">{t('settings.renaming.defaultRuleSet', { name: renameRules[0]?.name ?? t('settings.renaming.firstRuleSet') })}</option>
          {renameRules.slice(1).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label={t('settings.renaming.separator')} hint="name_1.mkv">
        <input value={draft.renameSeparator} maxLength={3} onChange={(e) => set('renameSeparator', e.target.value)} className="narrow" />
      </Field>
    </Card>
  );
}
