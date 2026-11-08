import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Loads jobs, queue state, presets and settings, then keeps them current with
 * the server's event stream. `changeTick` increases whenever job statuses
 * change, so the file browser can refresh its badges.
 */
export function useLiveData(onError) {
  const [jobs, setJobs] = useState([]);
  const [queue, setQueue] = useState(null);
  const [presets, setPresets] = useState([]);
  const [settings, setSettings] = useState(null);
  const [info, setInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const errRef = useRef(onError);
  errRef.current = onError;

  const loadJobs = useCallback(async () => {
    try {
      const r = await api.jobs();
      setJobs(r.jobs);
      setQueue(r.queue);
    } catch (e) {
      errRef.current?.(e);
    }
  }, []);
  const loadPresets = useCallback(() => api.presets().then(setPresets, (e) => errRef.current?.(e)), []);
  const loadSettings = useCallback(() => api.settings().then(setSettings, (e) => errRef.current?.(e)), []);
  const loadInfo = useCallback(() => api.info().then(setInfo, () => {}), []);

  useEffect(() => {
    let tickTimer;
    const bump = () => {
      clearTimeout(tickTimer);
      tickTimer = setTimeout(() => setChangeTick((t) => t + 1), 400);
    };
    const loadAll = () => {
      loadJobs();
      loadPresets();
      loadSettings();
      loadInfo();
    };
    loadAll();

    const es = new EventSource('/api/events');
    let wasDown = false;
    es.onopen = () => {
      setConnected(true);
      if (wasDown) {
        loadAll();
        bump();
      }
      wasDown = false;
    };
    es.onerror = () => {
      setConnected(false);
      wasDown = true;
    };
    es.addEventListener('job', (e) => {
      const job = JSON.parse(e.data);
      setJobs((list) => {
        const i = list.findIndex((j) => j.id === job.id);
        if (i < 0) return [...list, job];
        if (list[i].status !== job.status) bump();
        const next = list.slice();
        next[i] = job;
        return next;
      });
    });
    es.addEventListener('progress', (e) => {
      const p = JSON.parse(e.data);
      setJobs((list) => list.map((j) => (j.id === p.id ? { ...j, ...p } : j)));
    });
    es.addEventListener('jobs', () => {
      loadJobs();
      bump();
    });
    es.addEventListener('queue', (e) => setQueue(JSON.parse(e.data)));
    es.addEventListener('presets', () => loadPresets());
    es.addEventListener('settings', (e) => {
      setSettings(JSON.parse(e.data));
      bump();
    });
    return () => {
      es.close();
      clearTimeout(tickTimer);
    };
  }, [loadJobs, loadPresets, loadSettings, loadInfo]);

  return {
    jobs, queue, presets, settings, info, connected, changeTick,
    reloadJobs: loadJobs, reloadPresets: loadPresets, setSettings,
  };
}
