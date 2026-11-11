import { useId } from 'react';
import { t } from '../i18n/index.js';

/**
 * A labelled <select>. options: [{ value, label, disabled? }]; values may be numbers or strings.
 * A value that isn't among the options (an older preset, another HandBrake build) stays
 * selectable, marked as such, so opening a preset never changes it silently.
 */
export function Sel({ label, value, options, onChange, hint, disabled, className = '', unknownLabel }) {
  const known = options.some((o) => o.value === value);
  const list = known || value === undefined ? options : [{ value, label: unknownLabel?.(value) ?? t('presets.editor.notOffered', { value }) }, ...options];
  return (
    <label className={`set-field ${className}`}>
      {label && <span className="set-label">{label}</span>}
      <select
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(e) => {
          const o = list.find((x) => String(x.value) === e.target.value);
          onChange(o ? o.value : e.target.value);
        }}
      >
        {list.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

/** A labelled number input; the value is a number (min while empty). */
export function Num({ label, value, onChange, min, max, step = 1, suffix, hint, disabled, className = '' }) {
  return (
    <label className={`set-field ${className}`}>
      {label && <span className="set-label">{label}</span>}
      <span className="pe-num">
        <input
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? (min ?? 0) : Number(e.target.value))}
        />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

/** A labelled text input. */
export function Text({ label, value, onChange, placeholder, hint, disabled, mono, className = '', maxLength }) {
  return (
    <label className={`set-field ${className}`}>
      {label && <span className="set-label">{label}</span>}
      <input
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        spellCheck={false}
        className={mono ? 'mono' : ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

/** Radio buttons in a row. options: [{ value, label }]. */
export function Radios({ label, value, options, onChange, disabled }) {
  const name = useId();
  return (
    <div className="set-field" role="radiogroup" aria-label={label}>
      {label && <span className="set-label">{label}</span>}
      <div className="pe-radios">
        {options.map((o) => (
          <label key={String(o.value)} className="pe-radio">
            <input type="radio" name={name} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
