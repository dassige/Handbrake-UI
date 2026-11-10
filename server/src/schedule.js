// Conversion window ("quiet hours"): the queue starts new jobs only inside it.
// A copy of this file lives in web/src/schedule.js (used for the queue finish time);
// test/schedule.test.js runs the same cases on both, so keep them identical.

export const DEFAULT_SCHEDULE = {
  enabled: false,
  start: '23:00',
  end: '07:00',
  // Days the window opens on (0 = Sunday … 6 = Saturday). An overnight window
  // that opens on Friday ends on Saturday morning.
  days: [0, 1, 2, 3, 4, 5, 6],
  // Start the queue by itself when the window opens and jobs are waiting.
  autoStart: true,
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const minutesOf = (hhmm) => {
  const m = TIME.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Validates a schedule; throws an Error with a readable message. */
export function normalizeSchedule(s) {
  const v = { ...DEFAULT_SCHEDULE, ...(s ?? {}) };
  for (const k of ['enabled', 'autoStart']) {
    if (typeof v[k] !== 'boolean') throw new Error(`schedule.${k} must be true or false`);
  }
  for (const k of ['start', 'end']) {
    if (minutesOf(v[k]) == null) throw new Error(`schedule.${k} must be a time like 23:00`);
  }
  if (!Array.isArray(v.days)) throw new Error('schedule.days must be a list');
  const days = [...new Set(v.days.map(Number))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('schedule.days must be numbers 0–6');
  if (v.enabled && !days.length) throw new Error('Choose at least one day for the conversion window');
  return { enabled: v.enabled, start: v.start, end: v.end, days, autoStart: v.autoStart };
}

/** True when the window is open at `date`. A disabled schedule is always open. */
export function inWindow(schedule, date = new Date()) {
  if (!schedule?.enabled) return true;
  const start = minutesOf(schedule.start);
  const end = minutesOf(schedule.end);
  const now = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay();
  const opens = (d) => schedule.days.includes((d + 7) % 7);
  if (start < end) return opens(day) && now >= start && now < end;
  // Overnight (or 24 h when start = end): open from start today until end tomorrow.
  return (opens(day) && now >= start) || (opens(day - 1) && now < end);
}

/** When the window is next open: `date` itself when it is open now; null when it never opens. */
export function nextWindowStart(schedule, date = new Date()) {
  if (inWindow(schedule, date)) return date;
  if (!schedule.days.length) return null;
  const start = minutesOf(schedule.start);
  for (let k = 0; k <= 7; k++) {
    const c = new Date(date.getFullYear(), date.getMonth(), date.getDate() + k, Math.floor(start / 60), start % 60);
    if (c > date && schedule.days.includes(c.getDay())) return c;
  }
  return null;
}

/** When the window that is open at `date` closes; null when it is closed or the schedule is off. */
export function windowEnd(schedule, date = new Date()) {
  if (!schedule?.enabled || !inWindow(schedule, date)) return null;
  const end = minutesOf(schedule.end);
  for (let k = 0; k <= 8; k++) {
    const c = new Date(date.getFullYear(), date.getMonth(), date.getDate() + k, Math.floor(end / 60), end % 60);
    if (c > date && !inWindow(schedule, c)) return c;
  }
  return null; // open all week
}

/**
 * When a list of jobs will be done, following the queue rules: a job starts only
 * inside the window, and a job that is running when the window closes is finished.
 * `jobs` are durations in seconds, in queue order; `runningLeft` is the time left on
 * the job being converted now (it is not held back by the window).
 * Returns a Date, or null when the window never opens.
 */
export function finishTime(schedule, jobs, { now = new Date(), runningLeft = 0, ignoreWindow = false } = {}) {
  let t = new Date(now.getTime() + Math.max(0, runningLeft) * 1000);
  for (const seconds of jobs) {
    if (!ignoreWindow && schedule?.enabled) {
      const open = nextWindowStart(schedule, t);
      if (!open) return null;
      t = open;
    }
    t = new Date(t.getTime() + Math.max(0, seconds) * 1000);
  }
  return t;
}
