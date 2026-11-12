import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { t } from './i18n/index.js';

/**
 * Loads jobs, queue state, presets and settings, then keeps them current with
 * the server's event stream. `changeTick` increases whenever job statuses
 * change, so the file browser can refresh its badges.
 */
export function useLiveData(onError, onNotice, onEvent) {
  const [jobs, setJobs] = useState([]);
  const [queue, setQueue] = useState(null);
  const [presets, setPresets] = useState([]);
  const [renameRules, setRenameRules] = useState([]);
  const [merges, setMerges] = useState([]);
  const [qualityScans, setQualityScans] = useState([]);
  // Increases when a quality check finishes, so an open result reloads.
  const [qualityTick, setQualityTick] = useState(0);
  const [namingChecks, setNamingChecks] = useState([]);
  // Increases when a naming check finishes, so an open result reloads.
  const [namingTick, setNamingTick] = useState(0);
  const [settings, setSettings] = useState(null);
  const [info, setInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const errRef = useRef(onError);
  errRef.current = onError;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  // onEvent('jobStatus', { prev, job }) / onEvent('queueFinished', queue): tab title and browser notifications.
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const [watch, setWatch] = useState(null);
  const [backupSchedule, setBackupSchedule] = useState(null);

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
  const loadRenameRules = useCallback(() => api.renameRules().then(setRenameRules, (e) => errRef.current?.(e)), []);
  const loadMerges = useCallback(() => api.merges().then(setMerges, (e) => errRef.current?.(e)), []);
  const loadQualityScans = useCallback(() => api.qualityScans().then(setQualityScans, (e) => errRef.current?.(e)), []);
  const loadNamingChecks = useCallback(() => api.namingChecks().then(setNamingChecks, (e) => errRef.current?.(e)), []);
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
      loadRenameRules();
      loadMerges();
      loadQualityScans();
      loadNamingChecks();
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
        if (list[i].status !== job.status) {
          bump();
          const prev = list[i];
          setTimeout(() => eventRef.current?.('jobStatus', { prev, job }));
        }
        const next = list.slice();
        next[i] = job;
        return next;
      });
    });
    es.addEventListener('progress', (e) => {
      const p = JSON.parse(e.data);
      if (p.mergeId != null) {
        setMerges((list) => list.map((m) => (m.id === p.mergeId ? { ...m, progress: p.progress, phase: p.phase ?? m.phase } : m)));
        return;
      }
      setJobs((list) => list.map((j) => (j.id === p.id ? { ...j, ...p } : j)));
    });
    es.addEventListener('jobs', () => {
      loadJobs();
      bump();
    });
    es.addEventListener('queue', (e) => {
      const q = JSON.parse(e.data);
      setQueue(q);
      if (q.finished) {
        noticeRef.current?.(t('misc.live.queueFinished'));
        eventRef.current?.('queueFinished', q);
      }
    });
    es.addEventListener('presets', () => loadPresets());
    es.addEventListener('renameRules', () => loadRenameRules());
    es.addEventListener('merges', () => loadMerges());
    es.addEventListener('merge', (e) => {
      const m = JSON.parse(e.data);
      setMerges((list) => {
        const i = list.findIndex((x) => x.id === m.id);
        if (i < 0) return [m, ...list];
        if (list[i].status !== m.status) bump();
        const next = list.slice();
        next[i] = m;
        return next;
      });
    });
    // A file was uploaded or a folder created.
    es.addEventListener('files', () => bump());
    es.addEventListener('qualityScans', () => loadQualityScans());
    es.addEventListener('qualityProgress', (e) => {
      const p = JSON.parse(e.data);
      setQualityScans((list) => list.map((s) => (s.id === p.id ? { ...s, ...p } : s)));
    });
    es.addEventListener('qualityScan', (e) => {
      setQualityTick((t) => t + 1);
      // A re-check keeps its result's status, so its error is only reported here.
      const p = JSON.parse(e.data || '{}');
      if (p.recheck && p.error) errRef.current?.(new Error(p.error));
    });
    es.addEventListener('namingChecks', () => loadNamingChecks());
    es.addEventListener('namingProgress', (e) => {
      const p = JSON.parse(e.data);
      setNamingChecks((list) => list.map((c) => (c.id === p.id ? { ...c, ...p } : c)));
    });
    es.addEventListener('namingCheck', () => setNamingTick((t) => t + 1));
    // Files were renamed (or a rename undone): folder lists and naming results show it.
    es.addEventListener('renameHistory', () => bump());
    es.addEventListener('watch', (e) => setWatch(JSON.parse(e.data)));
    es.addEventListener('backupSchedule', (e) => setBackupSchedule(JSON.parse(e.data)));
    es.addEventListener('settings', (e) => {
      setSettings(JSON.parse(e.data));
      bump();
    });
    return () => {
      es.close();
      clearTimeout(tickTimer);
    };
  }, [loadJobs, loadPresets, loadRenameRules, loadMerges, loadQualityScans, loadNamingChecks, loadSettings, loadInfo]);

  return {
    jobs, queue, presets, renameRules, merges, qualityScans, qualityTick, namingChecks, namingTick, settings, info, connected, changeTick, watch, backupSchedule,
    reloadJobs: loadJobs, reloadPresets: loadPresets, setSettings,
  };
}
