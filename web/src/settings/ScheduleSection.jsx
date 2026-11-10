import { useMemo } from 'react';
import { inWindow, minutesOf, nextWindowStart, windowEnd } from '../schedule.js';
import { clockTime } from '../format.js';
import { Card, Check, Field, Switch } from './fields.jsx';

// Monday first, as people read a week; values are Date.getDay() numbers.
const DAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
];

function describe(s) {
  const start = minutesOf(s.start);
  const end = minutesOf(s.end);
  if (start == null || end == null) return '';
  const names = DAYS.filter(([d]) => s.days.includes(d)).map(([, n]) => n);
  const days = names.length === 7 ? 'Every day' : names.length ? names.join(', ') : 'No day chosen';
  if (start === end) return `${days}: open all day from ${s.start}.`;
  return start < end
    ? `${days}, from ${s.start} to ${s.end}.`
    : `${days}, from ${s.start} to ${s.end} the next morning.`;
}

export function ScheduleSection({ draft, set, info }) {
  const s = draft.schedule;
  const setS = (k, v) => set('schedule', { ...s, [k]: v });
  const browserOffset = -new Date().getTimezoneOffset();
  const zoneDiffers = info?.time && info.time.offset !== browserOffset;

  const preview = useMemo(() => {
    if (!s.enabled || minutesOf(s.start) == null || minutesOf(s.end) == null || !s.days.length) return null;
    const now = new Date();
    const end = windowEnd(s, now);
    return inWindow(s, now)
      ? { open: true, text: end ? `Open now; closes ${clockTime(end.getTime())}.` : 'Open all the time.' }
      : { open: false, text: `Closed now; opens ${clockTime(nextWindowStart(s, now)?.getTime())}.` };
  }, [s]);

  return (
    <>
      <Card
        title="Conversion window"
        help="settings.schedule"
        aside={<Switch checked={s.enabled} onChange={(v) => setS('enabled', v)} label={s.enabled ? 'On' : 'Off'} />}
      >
        <p className="set-hint">
          Convert only at certain times, e.g. at night, so encoding doesn’t compete with a media server or other services. Outside the window
          the queue holds the next job; a job that is converting when the window closes is finished first.
        </p>
        <fieldset className="set-fieldset" disabled={!s.enabled}>
          <div className="set-row">
            <Field label="Opens at">
              <input type="time" value={s.start} onChange={(e) => setS('start', e.target.value)} required />
            </Field>
            <Field label="Closes at">
              <input type="time" value={s.end} onChange={(e) => setS('end', e.target.value)} required />
            </Field>
          </div>
          <div className="set-field">
            <span className="set-label">On these days (the day the window opens)</span>
            <div className="day-chips" role="group" aria-label="Days">
              {DAYS.map(([d, name]) => (
                <button
                  key={d}
                  type="button"
                  className={`day-chip ${s.days.includes(d) ? 'on' : ''}`}
                  aria-pressed={s.days.includes(d)}
                  onClick={() => setS('days', s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort())}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <Check
            checked={s.autoStart}
            onChange={(v) => setS('autoStart', v)}
            hint="Otherwise press Start as usual; outside the window the queue then waits for it to open."
          >
            Start the queue by itself when the window opens and jobs are waiting
          </Check>
          {preview && (
            <div className={`schedule-preview ${preview.open ? 'open' : ''}`}>
              <strong>{describe(s)}</strong> {preview.text}
            </div>
          )}
        </fieldset>
        {zoneDiffers && (
          <p className="warn-text">
            The server’s clock is on {info.time.zone} (UTC{info.time.offset >= 0 ? '+' : '−'}
            {Math.abs(info.time.offset / 60)}), not this computer’s time zone. The window follows the server: set <code>TZ</code> in
            the server’s <code>.env</code> (e.g. <code>TZ=Europe/London</code>) and restart the container.
          </p>
        )}
      </Card>
    </>
  );
}
