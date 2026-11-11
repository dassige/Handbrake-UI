// Things that reach you when the tab is in the background: the tab title shows the
// queue's progress, and (opt-in, per browser) desktop notifications.
import { useCallback, useEffect, useRef, useState } from 'react';
import { clockTime, fileName } from './format.js';
import { t } from './i18n/index.js';

const APP = 'EncForge';
const KEY = 'hbui.browserNotify';

// label is translated each time it is read (t(e.labelKey) does the same).
const browserEvent = (id, labelKey) => ({
  id,
  labelKey,
  get label() {
    return t(this.labelKey);
  },
});
export const BROWSER_EVENTS = [
  browserEvent('queueFinished', 'misc.attention.events.queueFinished'),
  browserEvent('jobFailed', 'misc.attention.events.jobFailed'),
  browserEvent('checkFailed', 'misc.attention.events.checkFailed'),
  browserEvent('jobDone', 'misc.attention.events.jobDone'),
];
const DEFAULT_PREFS = { enabled: false, events: { queueFinished: true, jobFailed: true, checkFailed: true, jobDone: false } };

/** Desktop notifications need a secure page (https or localhost). */
export const browserNotifySupported = () => typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window;

function readPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v ? { ...DEFAULT_PREFS, ...v, events: { ...DEFAULT_PREFS.events, ...v.events } } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** This browser's notification choices, kept in localStorage. */
export function useBrowserNotifyPrefs() {
  const [prefs, setPrefsState] = useState(readPrefs);
  const [permission, setPermission] = useState(() => (browserNotifySupported() ? Notification.permission : 'unsupported'));
  const setPrefs = useCallback((next) => {
    setPrefsState((p) => {
      const v = typeof next === 'function' ? next(p) : next;
      try {
        localStorage.setItem(KEY, JSON.stringify(v));
      } catch {
        // private mode: only for this visit
      }
      return v;
    });
  }, []);
  const enable = useCallback(async () => {
    if (!browserNotifySupported()) return false;
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') setPrefs((x) => ({ ...x, enabled: true }));
    return p === 'granted';
  }, [setPrefs]);
  return { prefs, setPrefs, permission, enable };
}

function show(title, body, tag) {
  if (!browserNotifySupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icon-192.png' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some browsers only allow notifications from a service worker
  }
}

/**
 * Keeps the tab title current and returns the onEvent handler for useLiveData.
 * The title: "42% · Show S01e02.mkv", "Checking · …", "Waiting for 23:00",
 * and "✓ Queue finished" until the tab is looked at again.
 */
export function useAttention({ jobs, queue }) {
  const [finishedUnseen, setFinishedUnseen] = useState(false);
  const prefsRef = useRef(readPrefs());

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setFinishedUnseen(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    // Preferences changed in another tab, or on the Settings page.
    const onStorage = () => (prefsRef.current = readPrefs());
    window.addEventListener('storage', onStorage);
    const t = setInterval(onStorage, 5000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      clearInterval(t);
    };
  }, []);

  const active = jobs.find((j) => j.status === 'running' || j.status === 'paused');
  let title = APP;
  if (active) {
    const name = fileName(active.sourcePath);
    if (active.status === 'paused') title = t('misc.attention.title.paused', { name, app: APP });
    else if (active.phase === 'verifying') title = t('misc.attention.title.checking', { name, app: APP });
    else if (active.phase === 'encoding') title = t('misc.attention.title.progress', { percent: Math.floor((active.progress ?? 0) * 100), name, app: APP });
    else title = t('misc.attention.title.starting', { name, app: APP });
  } else if (queue?.schedule?.waiting && queue.schedule.nextStart) {
    title = t('misc.attention.title.waiting', { time: clockTime(queue.schedule.nextStart), app: APP });
  } else if (finishedUnseen) {
    title = t('misc.attention.title.finished', { app: APP });
  }
  useEffect(() => {
    document.title = title;
  }, [title]);

  return useCallback((type, data) => {
    const hidden = document.visibilityState !== 'visible';
    const prefs = prefsRef.current;
    const want = (e) => hidden && prefs.enabled && prefs.events[e];
    if (type === 'queueFinished') {
      if (hidden) setFinishedUnseen(true);
      if (want('queueFinished')) {
        const c = data?.counts ?? {};
        const body = c.failed
          ? t('misc.attention.notify.queueFinishedBodyFailed', { count: c.done ?? 0, failed: c.failed })
          : t('misc.attention.notify.queueFinishedBody', { count: c.done ?? 0 });
        show(t('misc.attention.notify.queueFinished'), body, 'queue');
      }
      return;
    }
    if (type !== 'jobStatus') return;
    const { prev, job } = data;
    const name = fileName(job.sourcePath);
    if (job.status === 'failed' && prev.status !== 'failed' && want('jobFailed')) {
      show(t('misc.attention.notify.jobFailed'), `${name}\n${job.error ?? ''}`, `job-${job.id}`);
    } else if (job.status === 'done' && prev.status !== 'done') {
      if (job.verifyStatus === 'error' && want('checkFailed')) show(t('misc.attention.notify.checkFailed'), name, `job-${job.id}`);
      else if (job.verifyStatus !== 'error' && want('jobDone')) show(t('misc.attention.notify.jobDone'), name, `job-${job.id}`);
    }
  }, []);
}
