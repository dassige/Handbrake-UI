import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n/index.js';

let nextId = 1;

/** Returns a stable toast API plus the current list. */
export function useToasts() {
  const [list, setList] = useState([]);
  const api = useMemo(() => {
    const push = (kind, text) => {
      const id = nextId++;
      setList((l) => [...l.slice(-4), { id, kind, text }]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
    };
    return {
      info: (text) => push('info', text),
      error: (text) => push('error', text),
      dismiss: (id) => setList((l) => l.filter((x) => x.id !== id)),
    };
  }, []);
  api.list = list;
  return api;
}

export function Toasts({ toasts }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.list.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          <button className="icon-btn" onClick={() => toasts.dismiss(toast.id)} aria-label={t('components.toasts.dismiss')}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
