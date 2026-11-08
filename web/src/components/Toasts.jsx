import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

let nextId = 1;

/** Returns a stable toast API plus the current list. */
export function useToasts() {
  const [list, setList] = useState([]);
  const api = useMemo(() => {
    const push = (kind, text) => {
      const id = nextId++;
      setList((l) => [...l.slice(-4), { id, kind, text }]);
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
    };
    return {
      info: (text) => push('info', text),
      error: (text) => push('error', text),
      dismiss: (id) => setList((l) => l.filter((t) => t.id !== id)),
    };
  }, []);
  api.list = list;
  return api;
}

export function Toasts({ toasts }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button className="icon-btn" onClick={() => toasts.dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
