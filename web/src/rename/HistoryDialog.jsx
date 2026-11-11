import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { dateTime, fileName } from '../format.js';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { t } from '../i18n/index.js';

export function HistoryDialog({ run, onClose, onUndone }) {
  const dialogs = useDialogs();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);

  const load = () => api.renameHistory().then(setList, () => setList([]));
  useEffect(() => {
    load();
  }, []);

  async function undo(h) {
    if (!(await dialogs.confirm({ title: t('rename.history.undoTitle'), message: t('rename.history.undoMessage', { count: h.items.filter((i) => !i.companion).length }), confirmLabel: t('rename.history.restoreNames') }))) return;
    const r = await run(() => api.undoRename(h.id), (x) => (x.errors.length
      ? t('rename.history.restoredWithErrors', { count: x.restored, errors: x.errors.length })
      : t('rename.history.restored', { count: x.restored })));
    if (r) {
      load();
      onUndone();
    }
  }

  return (
    <Modal title={<>{t('rename.history.title')}<Help id="rename.history" /></>} ariaLabel={t('rename.history.title')} onClose={onClose} wide>
      {list === null && <p className="muted">{t('common.loading')}</p>}
      {list?.length === 0 && <p className="muted">{t('rename.history.empty')}</p>}
      <ul className="history">
        {list?.map((h) => (
          <li key={h.id} className={h.undoneAt ? 'undone' : ''}>
            <div className="history-head">
              <button className="step-toggle" onClick={() => setOpen(open === h.id ? null : h.id)}>
                {open === h.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <strong>{dateTime(h.createdAt)}</strong>
                <span>{t('common.files.count', { count: h.items.filter((i) => !i.companion).length })}</span>
                <span className="muted">{h.ruleName ?? ''}</span>
                {h.auto && <span className="badge queued">{t('rename.history.automatic')}</span>}
                {h.undoneAt && <span className="badge">{t('rename.history.undone', { time: dateTime(h.undoneAt) })}</span>}
              </button>
              {!h.undoneAt && (
                <button className="btn small" onClick={() => undo(h)}><Undo2 size={14} /> {t('rename.history.undo')}</button>
              )}
            </div>
            {open === h.id && (
              <ul className="history-items">
                {h.items.map((it, i) => (
                  <li key={i}>
                    <span className="muted">{fileName(it.from)}</span> → <span>{fileName(it.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
