import { useCallback, useState } from 'react';
import { t } from '../i18n/index.js';

const PHONE = '(max-width: 700px)';
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches;

/**
 * On a phone the two panes of a view (e.g. Sources and Queue) are shown one at a
 * time. Returns [className for the panes element, the switch element, show(i)].
 * show(i) only switches on a phone, so actions can call it freely.
 */
export function usePaneSwitch(labels) {
  const [active, setActive] = useState(0);
  const show = useCallback((i) => {
    if (isPhone()) setActive(i);
  }, []);
  const element = (
    <div className="pane-switch" role="tablist" aria-label={t('components.paneSwitch.label')}>
      {labels.map((label, i) => (
        <button key={i} type="button" role="tab" aria-selected={active === i} className={active === i ? 'active' : ''} onClick={() => setActive(i)}>
          {label}
        </button>
      ))}
    </div>
  );
  return [`show-${active}`, element, show];
}
