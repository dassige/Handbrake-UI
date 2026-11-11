import { intlLocale, t } from './i18n/index.js';

export function bytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function duration(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function dateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(intlLocale(), {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t('format.ago.justNow');
  if (s < 3600) return t('format.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('format.ago.hours', { count: Math.floor(s / 3600) });
  return dateTime(ms);
}

/** Encode time without pauses. */
export function elapsed(job, now = Date.now()) {
  if (!job.startedAt) return null;
  return ((job.finishedAt ?? now) - job.startedAt - (job.pausedMs ?? 0)) / 1000;
}

export function fileName(p) {
  return p ? p.split(/[\\/]/).pop() : '';
}

export function dirName(p) {
  if (!p) return '';
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

/** Path relative to root, for compact display. */
export function relTo(root, p) {
  if (!root || !p) return p;
  const r = root.replace(/[\\/]+$/, '');
  return p.startsWith(r) ? p.slice(r.length).replace(/^[\\/]/, '') || '.' : p;
}

export function percent(x) {
  return `${((x ?? 0) * 100).toFixed(1)}%`;
}

export function ratio(job) {
  if (!job.sourceSize || !job.outputSize) return null;
  return Math.round((1 - job.outputSize / job.sourceSize) * 100);
}

/** "5 h 20 min", "12 min", "40 s". */
export function humanDuration(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return t('format.duration.daysHours', { days: d, hours: h });
  if (h) return m ? t('format.duration.hoursMinutes', { hours: h, minutes: m }) : t('format.duration.hours', { hours: h });
  if (m) return t('format.duration.minutes', { minutes: m });
  return t('format.duration.seconds', { seconds: s });
}

/** A moment in the near future: "14:05", "tomorrow 03:40", "Thu 03:40", "24 Nov 03:40". */
export function clockTime(ms, now = Date.now()) {
  if (ms == null) return '—';
  const at = new Date(ms);
  const locale = intlLocale();
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date(now))) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return t('format.clock.tomorrow', { time });
  if (days > 1 && days < 7) return t('format.clock.weekday', { day: at.toLocaleDateString(locale, { weekday: 'short' }), time });
  return t('format.clock.date', { date: at.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), time });
}
