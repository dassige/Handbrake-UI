import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { api } from '../api.js';
import { t } from '../i18n/index.js';

/**
 * "New preset": a copy of a HandBrake built-in preset or of one of yours, under a new name.
 * It is saved straight away and opened in the editor, like HandBrake's "Save New Preset".
 */
export function NewPresetDialog({ presets, fromId, categories, run, onClose, onCreated }) {
  const [builtins, setBuiltins] = useState(null); // { available, presets }
  // Duplicate starts from the given preset; New from a HandBrake preset (or yours, without HandBrakeCLI).
  const [source, setSource] = useState(fromId != null ? 'mine' : 'builtin');
  const [builtin, setBuiltin] = useState('');
  const [mine, setMine] = useState(fromId ?? presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? '');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [category, setCategory] = useState(() => presets.find((p) => p.id === fromId)?.category ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.builtinPresets().then(
      (b) => {
        setBuiltins(b);
        const first = b.presets.find((p) => p.name === 'Fast 1080p30') ?? b.presets[0];
        if (first) setBuiltin(first.name);
        if (!b.available && fromId == null && presets.length) setSource('mine');
      },
      () => setBuiltins({ available: false, presets: [] }),
    );
  }, [fromId, presets.length]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const p of builtins?.presets ?? []) {
      if (!m.has(p.category)) m.set(p.category, []);
      m.get(p.category).push(p);
    }
    return [...m.entries()];
  }, [builtins]);

  const chosenBuiltin = builtins?.presets.find((p) => p.name === builtin);
  const chosenMine = presets.find((p) => p.id === Number(mine));
  const suggested = source === 'builtin'
    ? (chosenBuiltin ? t('presets.newDialog.customName', { name: chosenBuiltin.name }) : '')
    : chosenMine ? t('presets.editor.copyName', { name: chosenMine.name }) : '';
  const finalName = nameTouched ? name : suggested;
  const canCreate = finalName.trim() && (source === 'builtin' ? !!chosenBuiltin : !!chosenMine) && !busy;

  async function create(e) {
    e?.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    const body = { name: finalName.trim(), category, description, ...(source === 'builtin' ? { builtin } : { fromId: Number(mine) }) };
    const r = await run(() => api.createPreset(body), t('presets.newDialog.created', { name: body.name }));
    setBusy(false);
    if (r) onCreated(r.id);
  }

  return (
    <Modal
      title={<>{t('presets.page.newPreset')}<Help id="presets.new" /></>}
      ariaLabel={t('presets.page.newPreset')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn primary" disabled={!canCreate} onClick={create}>{busy ? t('presets.newDialog.creating') : t('presets.newDialog.create')}</button>
        </>
      }
    >
      <form className="new-preset" onSubmit={create}>
        <fieldset className="set-fieldset">
          <span className="set-label">{t('presets.newDialog.startFrom')}</span>
          <label className="pe-radio">
            <input type="radio" name="np-source" checked={source === 'builtin'} disabled={builtins && !builtins.available} onChange={() => setSource('builtin')} />
            {t('presets.newDialog.builtin')}
          </label>
          {source === 'builtin' && (
            builtins == null ? (
              <p className="muted small">{t('presets.newDialog.asking')}</p>
            ) : !builtins.available ? (
              <p className="muted small">{t('presets.newDialog.noCli')}</p>
            ) : (
              <label className="set-field">
                <select value={builtin} onChange={(e) => setBuiltin(e.target.value)} aria-label={t('presets.newDialog.builtinLabel')}>
                  {groups.map(([cat, list]) => (
                    <optgroup key={cat} label={cat}>
                      {list.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                {chosenBuiltin?.description && <span className="set-hint">{chosenBuiltin.description}</span>}
              </label>
            )
          )}
          <label className="pe-radio">
            <input type="radio" name="np-source" checked={source === 'mine'} disabled={!presets.length} onChange={() => setSource('mine')} />
            {t('presets.newDialog.mine')}
          </label>
          {source === 'mine' && (
            <label className="set-field">
              <select value={mine} onChange={(e) => setMine(Number(e.target.value))} aria-label={t('presets.newDialog.mineLabel')}>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.category ? `${p.category} / ` : ''}{p.name}</option>)}
              </select>
            </label>
          )}
        </fieldset>

        <label className="set-field">
          <span className="set-label">{t('common.name')}</span>
          <input
            value={finalName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            maxLength={120}
            required
            autoFocus
          />
        </label>
        <div className="pe-grid">
          <label className="set-field">
            <span className="set-label">{t('presets.editor.category')}</span>
            <input value={category} list="new-preset-categories" onChange={(e) => setCategory(e.target.value)} placeholder={t('common.none')} maxLength={80} />
            <datalist id="new-preset-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
        <label className="set-field">
          <span className="set-label">{t('presets.editor.description')}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder={t('presets.editor.descriptionPlaceholder')} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
