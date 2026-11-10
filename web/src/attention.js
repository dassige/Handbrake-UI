// Things that reach you when the tab is in the background: the tab title shows the
// queue's progress, and (opt-in, per browser) desktop notifications.
import { useCallback, useEffect, useRef, useState } from 'react';
import { clockTime, fileName } from './format.js';

const APP = 'HandBrake Queue';
const KEY = 'hbui.browserNotify';

export const BROWSER_EVENTS = [
  { id: 'queueFinished', label: 'The queue finished' },
  { id: 'jobFailed', label: 'A conversion failed' },
  { id: 'checkFailed', label: 'A check after conversion failed' },
  { id: 'jobDone', label: 'Each converted file' },
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
    const n = new Notification(title, { body, tag, icon: '/favicon.svg' });
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
    if (active.status === 'paused') title = `Paused · ${name} — ${APP}`;
    else if (active.phase === 'verifying') title = `Checking · ${name} — ${APP}`;
    else if (active.phase === 'encoding') title = `${Math.floor((active.progress ?? 0) * 100)}% · ${name} — ${APP}`;
    else title = `Starting · ${name} — ${APP}`;
  } else if (queue?.schedule?.waiting && queue.schedule.nextStart) {
    title = `Waiting for ${clockTime(queue.schedule.nextStart)} — ${APP}`;
  } else if (finishedUnseen) {
    title = `✓ Queue finished — ${APP}`;
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
        show('Queue finished', `${c.done ?? 0} converted${c.failed ? ` · ${c.failed} failed` : ''}`, 'queue');
      }
      return;
    }
    if (type !== 'jobStatus') return;
    const { prev, job } = data;
    const name = fileName(job.sourcePath);
    if (job.status === 'failed' && prev.status !== 'failed' && want('jobFailed')) {
      show('Conversion failed', `${name}\n${job.error ?? ''}`, `job-${job.id}`);
    } else if (job.status === 'done' && prev.status !== 'done') {
      if (job.verifyStatus === 'error' && want('checkFailed')) show('Check failed', name, `job-${job.id}`);
      else if (job.verifyStatus !== 'error' && want('jobDone')) show('Converted', name, `job-${job.id}`);
    }
  }, []);
}
