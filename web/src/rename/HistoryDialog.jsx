import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { dateTime, fileName } from '../format.js';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';

export function HistoryDialog({ run, onClose, onUndone }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);

  const load = () => api.renameHistory().then(setList, () => setList([]));
  useEffect(() => {
    load();
  }, []);

  async function undo(h) {
    if (!confirm(`Restore the original names of ${h.items.length} file(s)?`)) return;
    const r = await run(() => api.undoRename(h.id), (x) => `Restored ${x.restored} file(s)${x.errors.length ? `; ${x.errors.length} could not be restored` : ''}`);
    if (r) {
      load();
      onUndone();
    }
  }

  return (
    <Modal title={<>Rename history<Help id="rename.history" /></>} ariaLabel="Rename history" onClose={onClose} wide>
      {list === null && <p className="muted">Loading…</p>}
      {list?.length === 0 && <p className="muted">Nothing renamed yet.</p>}
      <ul className="history">
        {list?.map((h) => (
          <li key={h.id} className={h.undoneAt ? 'undone' : ''}>
            <div className="history-head">
              <button className="step-toggle" onClick={() => setOpen(open === h.id ? null : h.id)}>
                {open === h.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <strong>{dateTime(h.createdAt)}</strong>
                <span>{h.items.length} file{h.items.length === 1 ? '' : 's'}</span>
                <span className="muted">{h.ruleName ?? ''}</span>
                {h.auto && <span className="badge queued">automatic</span>}
                {h.undoneAt && <span className="badge">undone {dateTime(h.undoneAt)}</span>}
              </button>
              {!h.undoneAt && (
                <button className="btn small" onClick={() => undo(h)}><Undo2 size={14} /> Undo</button>
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
