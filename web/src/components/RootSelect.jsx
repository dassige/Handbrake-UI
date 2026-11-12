import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { t } from '../i18n/index.js';
import { rootLabel } from '../roots.js';

/**
 * A folder's name as shown in folder lists: the target folder in a light blue badge, so it
 * stands apart from the sources folders; a protected sources folder says so.
 */
export function RootName({ settings, root }) {
  if (root === settings?.targetRoot) return <span className="badge root-target">{rootLabel(settings, root)}</span>;
  if (settings?.protectedRoots?.includes(root)) return <>{t('sources.rootProtected', { name: rootLabel(settings, root) })}</>;
  return <>{rootLabel(settings, root)}</>;
}

/**
 * Chooses one of the folders (sources folders and the target folder). Like a <select>, but its
 * options can show the target folder's badge, which a native dropdown can't. Keyboard: arrows,
 * Home/End, Enter or Space to choose, Escape to close, and typing a name's first letters.
 */
export function RootSelect({ settings, roots, value, onChange, label, title }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const button = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();

  const current = Math.max(0, roots.indexOf(value));
  const show = () => {
    setActive(current);
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  const choose = (i) => {
    close();
    if (roots[i] !== value) onChange(roots[i]);
  };

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined;
    list.current?.focus();
    const onDown = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Typing jumps to the first folder whose name starts with the letters typed.
  const typeAhead = (key) => {
    const now = Date.now();
    const text = (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase();
    typed.current = { text, at: now };
    const i = roots.findIndex((r) => rootLabel(settings, r).toLowerCase().startsWith(text));
    if (i >= 0) setActive(i);
  };

  const onListKey = (e) => {
    const last = roots.length - 1;
    const keys = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: () => close(),
      Tab: () => close(false),
    };
    if (keys[e.key]) {
      if (e.key !== 'Tab') e.preventDefault();
      keys[e.key]();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeAhead(e.key);
    }
  };

  return (
    <div className="root-select" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="root-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${rootLabel(settings, value)}`}
        title={title}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className="root-select-value"><RootName settings={settings} root={value} /></span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={list}
          className="root-select-list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {roots.map((r, i) => (
            <li
              key={r}
              id={`${id}-${i}`}
              role="option"
              aria-selected={r === value}
              className={`${i === active ? 'active' : ''} ${r === value ? 'chosen' : ''}`}
              title={r}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <RootName settings={settings} root={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
