import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n/index.js';

// Escape closes only the top-most layer (a help panel above a dialog above the job drawer).
const layers = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layers.length) {
      e.preventDefault();
      layers.at(-1).current?.();
    }
  });
}

/** Registers onClose as a layer that Escape closes when it is on top. */
export function useEscape(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    layers.push(ref);
    return () => {
      const i = layers.lastIndexOf(ref);
      if (i >= 0) layers.splice(i, 1);
    };
  }, []);
}

export function Modal({ title, onClose, children, footer, wide, className = '', ariaLabel }) {
  useEscape(onClose);
  return (
    <div className={`overlay ${className}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
