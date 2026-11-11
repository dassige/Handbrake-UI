import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { api } from '../api.js';

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
  const suggested = source === 'builtin' ? (chosenBuiltin ? `${chosenBuiltin.name} (custom)` : '') : chosenMine ? `${chosenMine.name} (copy)` : '';
  const finalName = nameTouched ? name : suggested;
  const canCreate = finalName.trim() && (source === 'builtin' ? !!chosenBuiltin : !!chosenMine) && !busy;

  async function create(e) {
    e?.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    const body = { name: finalName.trim(), category, description, ...(source === 'builtin' ? { builtin } : { fromId: Number(mine) }) };
    const r = await run(() => api.createPreset(body), `Created ${body.name}`);
    setBusy(false);
    if (r) onCreated(r.id);
  }

  return (
    <Modal
      title={<>New preset<Help id="presets.new" /></>}
      ariaLabel="New preset"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!canCreate} onClick={create}>{busy ? 'Creating…' : 'Create and edit'}</button>
        </>
      }
    >
      <form className="new-preset" onSubmit={create}>
        <fieldset className="set-fieldset">
          <span className="set-label">Start from</span>
          <label className="pe-radio">
            <input type="radio" name="np-source" checked={source === 'builtin'} disabled={builtins && !builtins.available} onChange={() => setSource('builtin')} />
            A HandBrake preset
          </label>
          {source === 'builtin' && (
            builtins == null ? (
              <p className="muted small">Asking HandBrake for its presets…</p>
            ) : !builtins.available ? (
              <p className="muted small">HandBrakeCLI isn’t installed on the server, so its built-in presets aren’t available.</p>
            ) : (
              <label className="set-field">
                <select value={builtin} onChange={(e) => setBuiltin(e.target.value)} aria-label="HandBrake preset">
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
            One of your presets
          </label>
          {source === 'mine' && (
            <label className="set-field">
              <select value={mine} onChange={(e) => setMine(Number(e.target.value))} aria-label="Your preset">
                {presets.map((p) => <option key={p.id} value={p.id}>{p.category ? `${p.category} / ` : ''}{p.name}</option>)}
              </select>
            </label>
          )}
        </fieldset>

        <label className="set-field">
          <span className="set-label">Name</span>
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
            <span className="set-label">Category</span>
            <input value={category} list="new-preset-categories" onChange={(e) => setCategory(e.target.value)} placeholder="None" maxLength={80} />
            <datalist id="new-preset-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
        </div>
        <label className="set-field">
          <span className="set-label">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What this preset is for" />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
