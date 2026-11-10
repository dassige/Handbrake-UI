import { useEffect, useState } from 'react';
import { Help } from '../help/Help.jsx';

/** A titled block inside a settings section. */
export function Card({ title, help, aside, children, className = '' }) {
  return (
    <section className={`set-card ${className}`}>
      {(title || aside) && (
        <header className="set-card-head">
          {title && <h3>{title}{help && <Help id={help} />}</h3>}
          {aside}
        </header>
      )}
      <div className="set-card-body">{children}</div>
    </section>
  );
}

/** Label above a control, with an optional hint below it. */
export function Field({ label, hint, help, children, className = '' }) {
  return (
    <label className={`set-field ${className}`}>
      <span className="set-label">{label}{help && <Help id={help} />}</span>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

/** A checkbox with a label and an optional hint. */
export function Check({ checked, onChange, children, hint, disabled }) {
  return (
    <label className={`set-check ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {children}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** An on/off switch for turning a whole feature on. */
export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

const parseList = (text) => [...new Set(text.split(',').map((x) => x.trim()).filter(Boolean))];

/** Comma-separated list edited as text; the value is an array. Keeps what is typed (e.g. a trailing comma). */
export function ListInput({ value, onChange, ...rest }) {
  const [text, setText] = useState(() => value.join(', '));
  useEffect(() => {
    // Follow outside changes (Discard, a save from another tab) but not our own edits.
    if (JSON.stringify(parseList(text)) !== JSON.stringify(value)) setText(value.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      value={text}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
    />
  );
}

/** Number input whose value is a number ('' while the box is empty). */
export function NumberInput({ value, onChange, ...rest }) {
  return (
    <input
      type="number"
      {...rest}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}
