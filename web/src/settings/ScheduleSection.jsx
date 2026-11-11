import { useMemo } from 'react';
import { inWindow, minutesOf, nextWindowStart, windowEnd } from '../schedule.js';
import { clockTime } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { Card, Check, Field, Switch } from './fields.jsx';

// Monday first, as people read a week; values are Date.getDay() numbers. Names: settings.schedule.day.<id>.
const DAYS = [
  [1, 'mon'], [2, 'tue'], [3, 'wed'], [4, 'thu'], [5, 'fri'], [6, 'sat'], [0, 'sun'],
];
const dayName = (id) => t(`settings.schedule.day.${id}`);

function describe(s) {
  const start = minutesOf(s.start);
  const end = minutesOf(s.end);
  if (start == null || end == null) return '';
  const names = DAYS.filter(([d]) => s.days.includes(d)).map(([, id]) => dayName(id));
  const days = names.length === 7 ? t('settings.schedule.everyDay') : names.length ? names.join(', ') : t('settings.schedule.noDay');
  if (start === end) return t('settings.schedule.allDay', { days, start: s.start });
  return start < end
    ? t('settings.schedule.range', { days, start: s.start, end: s.end })
    : t('settings.schedule.overnight', { days, start: s.start, end: s.end });
}

export function ScheduleSection({ draft, set, info }) {
  const s = draft.schedule;
  const setS = (k, v) => set('schedule', { ...s, [k]: v });
  const browserOffset = -new Date().getTimezoneOffset();
  const zoneDiffers = info?.time && info.time.offset !== browserOffset;

  // The times only; the sentence is made when rendering (in the current language).
  const preview = useMemo(() => {
    if (!s.enabled || minutesOf(s.start) == null || minutesOf(s.end) == null || !s.days.length) return null;
    const now = new Date();
    const end = windowEnd(s, now);
    return inWindow(s, now)
      ? { open: true, time: end ? end.getTime() : null }
      : { open: false, time: nextWindowStart(s, now)?.getTime() };
  }, [s]);
  const previewText = !preview
    ? ''
    : preview.open
      ? preview.time != null ? t('settings.schedule.openNow', { time: clockTime(preview.time) }) : t('settings.schedule.openAlways')
      : t('settings.schedule.closedNow', { time: clockTime(preview.time) });

  return (
    <>
      <Card
        title={t('settings.schedule.title')}
        help="settings.schedule"
        aside={<Switch checked={s.enabled} onChange={(v) => setS('enabled', v)} label={s.enabled ? t('common.on') : t('common.off')} />}
      >
        <p className="set-hint">{t('settings.schedule.intro')}</p>
        <fieldset className="set-fieldset" disabled={!s.enabled}>
          <div className="set-row">
            <Field label={t('settings.schedule.opensAt')}>
              <input type="time" value={s.start} onChange={(e) => setS('start', e.target.value)} required />
            </Field>
            <Field label={t('settings.schedule.closesAt')}>
              <input type="time" value={s.end} onChange={(e) => setS('end', e.target.value)} required />
            </Field>
          </div>
          <div className="set-field">
            <span className="set-label">{t('settings.schedule.days')}</span>
            <div className="day-chips" role="group" aria-label={t('settings.schedule.daysLabel')}>
              {DAYS.map(([d, id]) => (
                <button
                  key={d}
                  type="button"
                  className={`day-chip ${s.days.includes(d) ? 'on' : ''}`}
                  aria-pressed={s.days.includes(d)}
                  onClick={() => setS('days', s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort())}
                >
                  {dayName(id)}
                </button>
              ))}
            </div>
          </div>
          <Check
            checked={s.autoStart}
            onChange={(v) => setS('autoStart', v)}
            hint={t('settings.schedule.autoStartHint')}
          >
            {t('settings.schedule.autoStart')}
          </Check>
          {preview && (
            <div className={`schedule-preview ${preview.open ? 'open' : ''}`}>
              <strong>{describe(s)}</strong> {previewText}
            </div>
          )}
        </fieldset>
        {zoneDiffers && (
          <p className="warn-text">
            {rich('settings.schedule.zoneWarning', {
              zone: info.time.zone,
              offset: `${info.time.offset >= 0 ? '+' : '−'}${Math.abs(info.time.offset / 60)}`,
            })}
          </p>
        )}
      </Card>
    </>
  );
}
