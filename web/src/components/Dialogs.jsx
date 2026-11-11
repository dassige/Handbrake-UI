import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle, Info } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { t } from '../i18n/index.js';

// The app's own replacement for window.confirm / alert / prompt: every question
// is a Modal, and every helper returns a Promise with the answer.
const DialogContext = createContext(null);

let nextId = 1;

export function DialogProvider({ children }) {
  const [stack, setStack] = useState([]);

  const ask = useCallback(
    (opts) =>
      new Promise((resolve) => {
        const id = nextId++;
        const finish = (value) => {
          setStack((s) => s.filter((d) => d.id !== id));
          resolve(value);
        };
        setStack((s) => [...s, { ...opts, id, finish }]);
      }),
    [],
  );

  const api = useMemo(
    () => ({
      /** Resolves to the value of the button pressed, or `cancelValue` (default null) on Escape/close. */
      choose: ask,
      /** Resolves true or false. */
      // Default titles and labels are default parameters: translated at each call, in the current language.
      confirm: ({ title = t('components.dialogs.confirmTitle'), message, confirmLabel = t('common.ok'), cancelLabel = t('common.cancel'), danger } = {}) =>
        ask({
          title, message, icon: danger ? 'warn' : 'question', cancelValue: false,
          buttons: [
            { label: cancelLabel, value: false },
            { label: confirmLabel, value: true, primary: !danger, danger, autoFocus: true },
          ],
        }),
      /** Resolves when closed. */
      alert: ({ title = t('components.dialogs.alertTitle'), message, okLabel = t('common.ok'), danger } = {}) =>
        ask({
          title, message, icon: danger ? 'warn' : 'info', cancelValue: undefined,
          buttons: [{ label: okLabel, value: undefined, primary: true, autoFocus: true }],
        }),
      /** Resolves to the trimmed text, or null when cancelled. */
      prompt: ({ title, message, label, value = '', placeholder, confirmLabel = t('common.ok'), validate } = {}) =>
        ask({
          title, message, cancelValue: null,
          input: { label, value, placeholder, validate },
          buttons: [
            { label: t('common.cancel'), value: null },
            { label: confirmLabel, value: 'input', primary: true },
          ],
        }),
    }),
    [ask],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {stack.map((d) => (
        <AskDialog key={d.id} dialog={d} />
      ))}
    </DialogContext.Provider>
  );
}

export function useDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used inside <DialogProvider>');
  return ctx;
}

const ICONS = { warn: AlertTriangle, info: Info, question: HelpCircle };

function AskDialog({ dialog }) {
  const { title, message, buttons, input, icon, cancelValue = null, finish, wide } = dialog;
  const [text, setText] = useState(input?.value ?? '');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const Icon = ICONS[icon];

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  function press(b) {
    if (b.value !== 'input') return finish(b.value);
    const v = text.trim();
    const problem = input.validate?.(v) ?? (v ? null : t('components.dialogs.typeValue'));
    if (problem) {
      setError(problem);
      return undefined;
    }
    return finish(v);
  }

  return (
    <Modal
      title={title}
      onClose={() => finish(cancelValue)}
      className="ask-overlay"
      wide={wide}
      footer={buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className={`btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger-solid' : ''}`}
          autoFocus={b.autoFocus && !input}
          onClick={() => press(b)}
        >
          {b.label}
        </button>
      ))}
    >
      <div className={`ask ${icon ? `ask-${icon}` : ''}`}>
        {Icon && <Icon size={22} className="ask-icon" />}
        <div className="ask-text">
          {typeof message === 'string' ? <p>{message}</p> : message}
          {input && (
            <form
              className="settings"
              onSubmit={(e) => {
                e.preventDefault();
                press(buttons.find((b) => b.value === 'input'));
              }}
            >
              <label>
                {input.label}
                <input
                  ref={inputRef}
                  value={text}
                  placeholder={input.placeholder}
                  spellCheck={false}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                />
              </label>
              {error && <p className="text-bad small">{error}</p>}
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
