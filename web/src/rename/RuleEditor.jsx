import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { api, readTextFile } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { STEP_DEFS, newStep } from './stepDefs.js';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { rich, t } from '../i18n/index.js';
import { renameWarning } from '../i18n/serverText.js';

const SAMPLE_NAMES = [
  'The.Rookie.6x01.La.Maledizione.Dell.Ultimo.Turno.ITA.ENG.1080p.NFRip.AAC.x265-Pir8.mkv',
  '12.Monkeys.S04E01.The.End.1080p.AMZN.WEB-DL.ITA.ENG.DDP5.1.H.264-G66.mkv',
  'Mani pulite (2004) WEBRip 1080p x264 EAC3 ITA - Lullozzo.mkv',
  'L.Enfant.Du.Desert.2026.1080p.ITA-FRE.BluRay.x265.AAC-V3SP4EV3R.mkv',
];

function StepFields({ step, onChange, readOnly }) {
  const def = STEP_DEFS[step.type];
  const set = (k, v) => onChange({ ...step, [k]: v });
  return (
    <div className="step-fields">
      {def.helpKey && <p className="muted small">{t(def.helpKey)}{step.type === 'smart' && <Help id="rename.smart" />}</p>}
      <label className="step-field wide">
        <span>{t('rename.rules.note')}</span>
        <input value={step.description} onChange={(e) => set('description', e.target.value)} disabled={readOnly} placeholder={t('rename.rules.notePlaceholder')} />
      </label>
      {def.fields.map((fd) => {
        const v = step[fd.k];
        if (fd.type === 'bool') {
          return (
            <label key={fd.k} className="check step-field">
              <input type="checkbox" checked={!!v} onChange={(e) => set(fd.k, e.target.checked)} disabled={readOnly} />
              {t(fd.labelKey, fd.labelVars)}
            </label>
          );
        }
        return (
          <label key={fd.k} className={`step-field ${fd.type === 'text' || fd.type === 'list' ? 'wide' : ''}`}>
            <span>{t(fd.labelKey, fd.labelVars)}</span>
            {fd.type === 'select' ? (
              <select value={v} onChange={(e) => set(fd.k, e.target.value)} disabled={readOnly}>
                {fd.options.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
              </select>
            ) : fd.type === 'number' ? (
              <input type="number" value={v} onChange={(e) => set(fd.k, Number(e.target.value))} disabled={readOnly} />
            ) : fd.type === 'list' ? (
              <input
                value={Array.isArray(v) ? v.join(', ') : v}
                onChange={(e) => set(fd.k, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
                disabled={readOnly}
                spellCheck={false}
              />
            ) : (
              <input className="mono" value={v} onChange={(e) => set(fd.k, e.target.value)} disabled={readOnly} spellCheck={false} />
            )}
          </label>
        );
      })}
    </div>
  );
}

export function RuleEditor({ rules, initialId, sampleNames, run, onClose, onPick }) {
  const dialogs = useDialogs();
  const [selectedId, setSelectedId] = useState(initialId ?? rules[0]?.id ?? null);
  const selected = rules.find((r) => r.id === selectedId) ?? null;
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [samples, setSamples] = useState(() => (sampleNames?.length ? sampleNames.slice(0, 30) : SAMPLE_NAMES).join('\n'));
  const [showName, setShowName] = useState('');
  const [results, setResults] = useState([]);
  const [testError, setTestError] = useState(null);
  const fileInput = useRef(null);

  // Load the selected rule set into an editable draft.
  useEffect(() => {
    if (!selected) return setDraft(null);
    setDraft({ name: selected.name, description: selected.description ?? '', steps: structuredClone(selected.steps) });
    setOpen(new Set(selected.steps.length <= 3 ? selected.steps.map((_, i) => i) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.updatedAt]);

  const readOnly = !!selected?.builtin;
  const dirty = useMemo(
    () => !!(draft && selected && JSON.stringify(draft) !== JSON.stringify({ name: selected.name, description: selected.description ?? '', steps: selected.steps })),
    [draft, selected],
  );

  // Live test of the (unsaved) steps.
  useEffect(() => {
    if (!draft) return undefined;
    const names = samples.split('\n').map((s) => s.trim()).filter(Boolean);
    const timer = setTimeout(async () => {
      try {
        setResults(await api.testRename(draft.steps, names, showName));
        setTestError(null);
      } catch (e) {
        setTestError(e.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, samples, showName]);

  const confirmDiscard = async () => !dirty || dialogs.confirm({ title: t('common.unsavedChanges'), message: t('rename.rules.discardMessage'), confirmLabel: t('rename.rules.discardChanges'), cancelLabel: t('rename.rules.keepEditing'), danger: true });
  const select = async (id) => (await confirmDiscard()) && setSelectedId(id);
  const setSteps = (fn) => setDraft((d) => ({ ...d, steps: fn(d.steps) }));
  const toggleOpen = (i) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });

  function moveStep(i, delta) {
    setSteps((steps) => {
      const next = steps.slice();
      const j = i + delta;
      if (j < 0 || j >= next.length) return steps;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setOpen(new Set());
  }

  async function save() {
    const r = await run(() => api.updateRenameRule(selected.id, draft), t('rename.rules.saved'));
    if (r) setDraft({ name: r.name, description: r.description ?? '', steps: r.steps });
  }

  async function duplicate() {
    if (!(await confirmDiscard())) return;
    const src = draft ?? selected;
    const r = await run(() => api.createRenameRule({ name: t('rename.rules.copyName', { name: src.name }), description: src.description, steps: src.steps }), t('rename.rules.copyCreated'));
    if (r) setSelectedId(r.id);
  }

  async function create() {
    if (!(await confirmDiscard())) return;
    const r = await run(() => api.createRenameRule({ name: t('rename.rules.newName'), steps: [newStep('smart')] }));
    if (r) setSelectedId(r.id);
  }

  async function importFiles(files) {
    for (const file of files) {
      const content = await readTextFile(file);
      const r = await run(() => api.importRenameRule(file.name, content), (x) =>
        x.skipped.length
          ? t('rename.rules.importedSkipped', { name: x.rule.name, count: x.rule.steps.length, skipped: x.skipped.join(', ') })
          : t('rename.rules.imported', { name: x.rule.name, count: x.rule.steps.length }));
      if (r) setSelectedId(r.rule.id);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function remove() {
    if (!(await dialogs.confirm({ title: t('rename.rules.deleteTitle'), message: t('rename.rules.deleteMessage', { name: selected.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    const r = await run(() => api.deleteRenameRule(selected.id), t('rename.rules.deleted'));
    if (r) setSelectedId(rules.find((x) => x.id !== selected.id)?.id ?? null);
  }

  return (
    <Modal
      title={<>{t('rename.rules.title')}<Help id="rename.rules" /></>}
      ariaLabel={t('rename.rules.title')}
      onClose={async () => (await confirmDiscard()) && onClose()}
      wide
      footer={
        <>
          {selected && onPick && (
            <button className="btn" onClick={async () => (await confirmDiscard()) && (onPick(selected.id), onClose())}>{t('rename.rules.use')}</button>
          )}
          <span className="spacer" />
          {!readOnly && selected && (
            <>
              <button className="btn" disabled={!dirty} onClick={() => setDraft({ name: selected.name, description: selected.description ?? '', steps: structuredClone(selected.steps) })}>{t('rename.rules.revert')}</button>
              <button className="btn primary" disabled={!dirty} onClick={save}>{t('common.save')}</button>
            </>
          )}
        </>
      }
    >
      <div className="rule-editor">
        <aside className="rule-list">
          {rules.map((r) => (
            <button key={r.id} className={`rule-item ${r.id === selectedId ? 'active' : ''}`} onClick={() => select(r.id)}>
              <span>{r.name}</span>
              {r.builtin && <span className="badge">{t('rename.rules.builtin')}</span>}
            </button>
          ))}
          <div className="rule-list-actions">
            <button className="btn small" onClick={create}><Plus size={14} /> {t('rename.rules.new')}</button>
            <button className="btn small" onClick={() => fileInput.current?.click()} title={t('rename.rules.importTitle')}>
              <Upload size={14} /> {t('common.import')}
            </button>
            <input ref={fileInput} type="file" accept=".aren,.json" multiple hidden onChange={(e) => importFiles([...e.target.files])} />
          </div>
          <p className="muted small">{t('rename.rules.importHint')}</p>
        </aside>

        {draft && selected ? (
          <section className="rule-detail">
            <div className="rule-head">
              <input className="rule-name" value={draft.name} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <div className="job-actions">
                <button className="icon-btn" title={t('common.duplicate')} onClick={duplicate}><Copy size={16} /></button>
                <a className="icon-btn" title={t('rename.rules.exportJson')} href={api.exportRenameRuleUrl(selected.id)} download><Download size={16} /></a>
                {!readOnly && <button className="icon-btn danger" title={t('common.delete')} onClick={remove}><Trash2 size={16} /></button>}
              </div>
            </div>
            <input
              className="rule-desc"
              value={draft.description}
              disabled={readOnly}
              placeholder={t('rename.rules.description')}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            {readOnly && <p className="note">{rich('rename.rules.readOnly', { icon: <Copy size={12} /> })}</p>}

            <h3 className="steps-title">{t('rename.rules.steps')}<Help id="rename.steps" /></h3>
            <ol className="steps">
              {draft.steps.map((step, i) => {
                const def = STEP_DEFS[step.type];
                const isOpen = open.has(i);
                return (
                  <li key={i} className={`step ${step.active ? '' : 'inactive'}`}>
                    <div className="step-head">
                      <input
                        type="checkbox"
                        checked={step.active}
                        disabled={readOnly}
                        title={t('rename.rules.active')}
                        onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))}
                      />
                      <button className="step-toggle" onClick={() => toggleOpen(i)}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="step-num">{i + 1}</span>
                        <strong>{t(def.labelKey)}</strong>
                        <span className="step-summary">{step.description ? `${step.description} — ` : ''}{def.summary(step)}</span>
                      </button>
                      {!readOnly && (
                        <span className="job-actions">
                          <button className="icon-btn" title={t('rename.rules.moveUp')} disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp size={14} /></button>
                          <button className="icon-btn" title={t('rename.rules.moveDown')} disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown size={14} /></button>
                          <button className="icon-btn danger" title={t('rename.rules.deleteStep')} onClick={() => { setSteps((s) => s.filter((_, j) => j !== i)); setOpen(new Set()); }}>
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </div>
                    {isOpen && (
                      <StepFields step={step} readOnly={readOnly} onChange={(ns) => setSteps((s) => s.map((x, j) => (j === i ? ns : x)))} />
                    )}
                  </li>
                );
              })}
            </ol>
            {!readOnly && (
              <label className="field-inline">
                <Plus size={14} /> {t('rename.rules.addStep')}
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const at = draft.steps.length;
                    setSteps((s) => [...s, newStep(e.target.value)]);
                    setOpen(new Set([at]));
                  }}
                >
                  <option value="">{t('rename.rules.choose')}</option>
                  {Object.entries(STEP_DEFS).map(([k, d]) => <option key={k} value={k}>{t(d.labelKey)}</option>)}
                </select>
              </label>
            )}

            <div className="try-it">
              <h3>{t('rename.rules.tryIt')}<Help id="rename.tryIt" /></h3>
              <div className="try-grid">
                <textarea value={samples} onChange={(e) => setSamples(e.target.value)} spellCheck={false} rows={5} placeholder={t('rename.rules.samplesPlaceholder')} />
                <label className="step-field">
                  <span>{t('rename.rules.showNameOptional')}</span>
                  <input value={showName} onChange={(e) => setShowName(e.target.value)} placeholder={t('rename.rules.autoDetected')} />
                </label>
              </div>
              {testError && <p className="text-bad small">{testError}</p>}
              <ul className="try-results">
                {results.map((r, i) => (
                  <li key={i}>
                    <span className="muted">{r.from}</span>
                    <span>→ <strong>{r.to}</strong></span>
                    {r.warnings.length > 0 && <span className="warn-text">⚠ {r.warnings.map(renameWarning).join('; ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : (
          <section className="rule-detail muted">{t('rename.rules.selectOrCreate')}</section>
        )}
      </div>
    </Modal>
  );
}
