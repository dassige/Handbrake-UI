import { ArrowDown, ArrowDownUp, ArrowUp } from 'lucide-react';
import { t } from '../i18n/index.js';

/** The standard sorts of a file list; each list picks the ones it can offer. */
export const SORT_LABEL_KEYS = {
  name: 'components.sort.name',
  date: 'components.sort.date',
  type: 'components.sort.type',
  size: 'components.sort.size',
  manual: 'components.sort.manual',
};

/**
 * "Sort by [Name ▾] [↑]" for a list. sort = { key, dir }; options = [{ key, label }] or keys
 * of SORT_LABEL_KEYS. The direction button is hidden for 'manual' (the user's own order).
 */
export function SortControl({ sort, onChange, options, className = '' }) {
  const opts = options.map((o) => (typeof o === 'string' ? { key: o, label: t(SORT_LABEL_KEYS[o]) } : o));
  return (
    <span className={`sort-control ${className}`}>
      <ArrowDownUp size={13} className="muted" aria-hidden="true" />
      <select
        value={sort.key}
        onChange={(e) => onChange({ key: e.target.value, dir: sort.dir })}
        aria-label={t('components.sort.label')}
        title={t('components.sort.label')}
      >
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {sort.key !== 'manual' && (
        <button
          type="button"
          className="icon-btn sort-dir"
          onClick={() => onChange({ key: sort.key, dir: -sort.dir })}
          title={sort.dir > 0 ? t('components.sort.ascending') : t('components.sort.descending')}
          aria-label={sort.dir > 0 ? t('components.sort.ascending') : t('components.sort.descending')}
        >
          {sort.dir > 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>
      )}
    </span>
  );
}
