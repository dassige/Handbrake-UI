import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, LogOut, Pause, Play, Settings as SettingsIcon, SlidersHorizontal, WifiOff } from 'lucide-react';
import { RenameView } from './rename/RenameView.jsx';
import { MergeView } from './merge/MergeView.jsx';
import { QualityView } from './quality/QualityView.jsx';
import { NamingView } from './naming/NamingView.jsx';
import { StatsView } from './stats/StatsView.jsx';
import { SettingsPage, SECTION_IDS } from './settings/SettingsPage.jsx';
import { PresetsPage } from './presets/PresetsPage.jsx';
import { UploadDialog } from './upload/UploadDialog.jsx';
import { UploadsPanel } from './upload/UploadsPanel.jsx';
import { useUploads } from './upload/useUploads.js';
import { Help, HelpProvider, HelpSearchButton } from './help/Help.jsx';
import { api } from './api.js';
import { useLiveData } from './useLiveData.js';
import { useAttention } from './attention.js';
import { queueEstimate } from './eta.js';
import { clockTime, humanDuration } from './format.js';
import { Toasts, useToasts } from './components/Toasts.jsx';
import { SourceBrowser } from './components/SourceBrowser.jsx';
import { QueuePanel } from './components/QueuePanel.jsx';
import { JobDrawer } from './components/JobDrawer.jsx';
import { useDialogs } from './components/Dialogs.jsx';
import { usePaneSwitch } from './components/PaneSwitch.jsx';
import { displayPath } from './roots.js';
import { rich, setLanguage, t } from './i18n/index.js';
import { errorText, skipReason } from './i18n/serverText.js';

const VIEWS = ['convert', 'rename', 'merge', 'quality', 'naming', 'stats', 'presets', 'settings'];

/** "#settings/watch" → { view: 'settings', sub: 'watch' } */
function parseHash(hash) {
  const [v, sub] = hash.replace(/^#/, '').split('/');
  return VIEWS.includes(v) ? { view: v, sub: sub ? decodeURIComponent(sub) : null } : { view: 'convert', sub: null };
}

/** Re-renders every 30 s, so times such as "done around 03:40" stay current. */
function useMinuteClock() {
  const [, setT] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setT((x) => x + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}

/** auth: GET /api/auth/status (AuthGate); onAuthChange: replaces it, e.g. after turning login on or off. */
export default function App({ auth, onAuthChange }) {
  const toasts = useToasts();
  const dialogs = useDialogs();
  const onError = useCallback((e) => toasts.error(errorText(e)), [toasts]);
  const onNotice = useCallback((text) => toasts.info(text), [toasts]);
  const eventRef = useRef(null);
  const onEvent = useCallback((type, d) => eventRef.current?.(type, d), []);
  const data = useLiveData(onError, onNotice, onEvent);
  const { jobs, queue, presets, settings, info, connected } = data;
  eventRef.current = useAttention({ jobs, queue });
  useMinuteClock();
  // The language is a server setting: follow it when it loads or changes (here or in another browser).
  useEffect(() => {
    if (settings?.language) setLanguage(settings.language);
  }, [settings?.language]);

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [upload, setUpload] = useState(null); // { dir, root, files } while the upload dialog is open
  const uploads = useUploads({ onError });
  const [presetId, setPresetId] = useState(null);
  const [position, setPosition] = useState('end');
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const view = route.view;
  const [renamePaths, setRenamePaths] = useState([]);
  // The rule set chosen in Rename (also picked by Naming's "Fix in Rename").
  const [renameRuleId, setRenameRuleId] = useState(null);
  // Naming: the rule set for the next check.
  const [namingRuleId, setNamingRuleId] = useState(null);
  const [mergePaths, setMergePaths] = useState([]);
  const settingsDirty = useRef(false);
  const onSettingsDirty = useCallback((d) => (settingsDirty.current = d), []);
  const presetsDirty = useRef(false);
  const onPresetsDirty = useCallback((d) => (presetsDirty.current = d), []);

  const go = useCallback((v, sub = null) => {
    setRoute({ view: v, sub });
    history.replaceState(null, '', v === 'convert' ? '#' : `#${v}${sub != null ? `/${encodeURIComponent(sub)}` : ''}`);
  }, []);

  /** Changes view; leaving Settings or the preset editor with unsaved changes asks first. */
  const switchView = useCallback(
    async (v, sub = null) => {
      if (view === 'settings' && v !== 'settings' && settingsDirty.current) {
        const ok = await dialogs.confirm({
          title: t('app.leave.settingsTitle'),
          message: t('app.leave.settingsMessage'),
          confirmLabel: t('app.leave.confirm'),
          danger: true,
        });
        if (!ok) return;
        settingsDirty.current = false;
      }
      if (view === 'presets' && v !== 'presets' && presetsDirty.current) {
        const ok = await dialogs.confirm({
          title: t('app.leave.presetTitle'),
          message: t('app.leave.presetMessage'),
          confirmLabel: t('app.leave.confirm'),
          danger: true,
        });
        if (!ok) return;
        presetsDirty.current = false;
      }
      go(v, sub);
    },
    [view, dialogs, go],
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /** Opens the rename view with these files added (and this rule set chosen, when given). */
  const openRename = useCallback(
    (paths, ruleId = null) => {
      setRenamePaths((p) => [...new Set([...p, ...paths])]);
      if (ruleId != null) setRenameRuleId(ruleId);
      setSelectedJobId(null);
      switchView('rename');
    },
    [switchView],
  );

  /** Opens the merge view with these files added (in this order). */
  const openMerge = useCallback(
    (paths) => {
      setMergePaths((p) => [...new Set([...p, ...paths])]);
      setSelectedJobId(null);
      switchView('merge');
    },
    [switchView],
  );

  const effectivePresetId = presetId ?? presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? null;
  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) ?? null, [jobs, selectedJobId]);
  const estimate = queueEstimate(jobs, queue, settings);
  const activeJobs = (counts0) => (counts0.queued ?? 0) + (counts0.running ?? 0) + (counts0.paused ?? 0);
  const activeCount = queue?.counts ? activeJobs(queue.counts) : 0;
  const [paneClass, paneSwitch, showPane] = usePaneSwitch([
    t('app.panes.sources'),
    activeCount ? t('app.panes.queueCount', { n: activeCount }) : t('app.panes.queue'),
  ]);

  /** Runs an API call and shows its error, if any, as a toast. */
  const run = useCallback(
    async (fn, success) => {
      try {
        const r = await fn();
        if (success) toasts.info(typeof success === 'function' ? success(r) : success);
        return r;
      } catch (e) {
        onError(e);
        return undefined;
      }
    },
    [onError, toasts],
  );

  /** origin 'quality': from the quality check, to replace the originals once converted. */
  const addPaths = useCallback(
    async (paths, { origin } = {}) => {
      if (!paths.length) return;
      if (!effectivePresetId) {
        toasts.error(t('app.add.noPreset'));
        switchView('presets');
        return;
      }
      const r = await run(() => api.addJobs(paths, effectivePresetId, position, origin));
      if (!r) return;
      // Skipped files grouped by their (translated) reason: "2 already converted, 1 not a video".
      const reasons = {};
      for (const s of r.skipped) {
        const reason = skipReason(s);
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      const skipped = Object.entries(reasons).map(([reason, n]) => t('app.add.skippedReason', { count: n, reason })).join(', ');
      if (r.added.length) {
        toasts.info(skipped ? t('app.add.addedSkipped', { count: r.added.length, skipped }) : t('app.add.added', { count: r.added.length }));
        showPane(1);
      }
      else toasts.error(skipped ? t('app.add.nothingSkipped', { skipped }) : t('app.add.nothing'));
    },
    [effectivePresetId, position, run, toasts, switchView, showPane],
  );

  /** "Watch" in the Sources panel: adds the open folder as a watch folder (asks first), or opens its settings. */
  async function watchFolder(path) {
    if (settings.watch.folders.some((f) => f.path === path)) {
      switchView('settings', 'watch');
      return;
    }
    const preset = presets.find((p) => p.id === effectivePresetId);
    const ok = await dialogs.confirm({
      title: t('app.watch.title'),
      message: (
        <>
          <p>
            {rich(preset ? 'app.watch.messagePreset' : 'app.watch.message', {
              path: <strong title={path}>{displayPath(settings, path)}</strong>,
              preset: preset?.name,
            })}
          </p>
          <p className="muted small">{settings.watch.enabled ? t('app.watch.note') : t('app.watch.noteOff')}</p>
        </>
      ),
      confirmLabel: t('app.watch.confirm'),
    });
    if (!ok) return;
    const watch = { ...settings.watch, enabled: true, folders: [...settings.watch.folders, { path, presetId: null, recursive: true }] };
    const r = await run(() => api.saveSettings({ watch }), t('app.watch.done'));
    if (r) data.setSettings(r);
  }

  const running = queue?.running;
  const counts = queue?.counts ?? {};
  const sched = queue?.schedule;

  /** Start; outside the conversion window, asks whether to wait for it or start now. */
  async function start() {
    if (sched?.enabled && !sched.open && (counts.queued ?? 0) > 0) {
      const choice = await dialogs.choose({
        title: t('app.outsideWindow.title'),
        icon: 'warn',
        cancelValue: null,
        message: (
          <>
            <p>{sched.nextStart ? t('app.outsideWindow.opensAt', { time: clockTime(sched.nextStart) }) : t('app.outsideWindow.opensLater')}</p>
            <p className="muted small">{t('app.outsideWindow.note')}</p>
          </>
        ),
        buttons: [
          { label: t('common.cancel'), value: null },
          { label: t('app.outsideWindow.startNow'), value: 'now' },
          { label: t('app.outsideWindow.wait'), value: 'wait', primary: true, autoFocus: true },
        ],
      });
      if (!choice) return;
      run(() => api.startQueue(choice === 'now'), choice === 'wait' ? t('app.outsideWindow.startsAt', { time: clockTime(sched.nextStart) }) : undefined);
      return;
    }
    run(() => api.startQueue());
  }

  async function signOut() {
    if (view === 'settings' && settingsDirty.current) {
      const ok = await dialogs.confirm({
        title: t('app.leave.settingsTitle'),
        message: t('app.leave.settingsMessage'),
        confirmLabel: t('app.leave.confirm'),
        danger: true,
      });
      if (!ok) return;
    }
    if (await run(() => api.logout())) onAuthChange(await api.authStatus().catch(() => ({ enabled: true, via: null })));
  }

  let stateText = running ? t('app.state.running') : t('app.state.stopped');
  if (running && sched?.waiting) stateText = t('app.state.waitingFor', { time: clockTime(sched.nextStart) });
  // One job started with "Convert now"; the queue itself stays stopped.
  const single = !running && !!queue?.activeSingle;
  if (single) stateText = t('app.state.convertingOne');

  return (
    <HelpProvider>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="/icon-192.png" alt="" width={24} height={24} />
          <span>EncForge</span>
          <Help id="app.overview" />
        </div>
        <nav className="tabs" aria-label={t('app.views.label')}>
          <button className={view === 'convert' ? 'active' : ''} onClick={() => switchView('convert')}>{t('app.views.convert')}</button>
          <button className={view === 'rename' ? 'active' : ''} onClick={() => switchView('rename')}>
            {t('app.views.rename')}{renamePaths.length ? <span className="chip-count"> {renamePaths.length}</span> : null}
          </button>
          <button className={view === 'merge' ? 'active' : ''} onClick={() => switchView('merge')}>
            {t('app.views.merge')}{mergePaths.length ? <span className="chip-count"> {mergePaths.length}</span> : null}
          </button>
          <button className={view === 'quality' ? 'active' : ''} onClick={() => switchView('quality')}>{t('app.views.quality')}</button>
          <button className={view === 'naming' ? 'active' : ''} onClick={() => switchView('naming')}>{t('app.views.naming')}</button>
          <button className={view === 'stats' ? 'active' : ''} onClick={() => switchView('stats')}>{t('app.views.stats')}</button>
        </nav>
        <div className="queue-state">
          <span className={`dot ${running ? (sched?.waiting ? 'wait' : 'on') : single ? 'on' : 'off'}`} />
          <span>{stateText}</span>
          <button
            className="btn small"
            onClick={() => (running ? run(api.stopQueue) : start())}
            title={running ? t('app.state.stopTitle') : t('app.state.startTitle')}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? t('app.state.stopAfterCurrent') : t('common.start')}
          </button>
          <Help id="queue.state" />
          <span className="counts">
            {t('app.state.queued', { count: counts.queued ?? 0 })} · {t('app.state.done', { count: counts.done ?? 0 })}
            {counts.failed ? <span className="text-bad"> · {t('app.state.failed', { count: counts.failed })}</span> : null}
            {estimate?.seconds > 0 && (
              <span title={estimate.finishAt && !estimate.unknown ? t('app.state.doneAround', { time: clockTime(estimate.finishAt) }) : undefined}>
                {' '}· {t('app.state.left', { duration: humanDuration(estimate.seconds) })}
              </span>
            )}
          </span>
          {sched?.enabled && !sched.waiting && (
            <button
              className={`sched-pill ${sched.open ? 'open' : ''}`}
              onClick={() => switchView('settings', 'schedule')}
              title={
                sched.open
                  ? sched.closesAt ? t('app.window.openUntilTitle', { time: clockTime(sched.closesAt) }) : t('app.window.openTitle')
                  : t('app.window.closedTitle', { time: clockTime(sched.nextStart) })
              }
            >
              <CalendarClock size={13} />
              {sched.open ? (sched.closesAt ? t('app.window.until', { time: clockTime(sched.closesAt) }) : t('app.window.open')) : clockTime(sched.nextStart)}
            </button>
          )}
        </div>
        <div className="topbar-right">
          {!connected && (
            <span className="offline" title={t('app.offlineTitle')}>
              <WifiOff size={14} /> {t('app.offline')}
            </span>
          )}
          <HelpSearchButton />
          <button className={`btn ghost ${view === 'presets' ? 'active' : ''}`} onClick={() => switchView('presets')} title={t('app.views.presets')} aria-label={t('app.views.presets')}>
            <SlidersHorizontal size={16} /> <span className="btn-label">{t('app.views.presets')}</span>
          </button>
          <button className={`btn ghost ${view === 'settings' ? 'active' : ''}`} onClick={() => switchView('settings')} title={t('app.views.settings')} aria-label={t('app.views.settings')}>
            <SettingsIcon size={16} /> <span className="btn-label">{t('app.views.settings')}</span>
          </button>
          {auth?.via === 'session' && (
            <button className="btn ghost" onClick={signOut} title={t('auth.signOut')} aria-label={t('auth.signOut')}>
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {info?.handbrake?.error && (
        <div className="banner bad">{t('app.handbrakeMissing', { error: info.handbrake.error })}</div>
      )}
      {presets.length === 0 && view !== 'presets' && (
        <div className="banner">
          {rich('app.noPresets', {
            link: <button className="link" onClick={() => switchView('presets')}>{t('app.noPresetsLink')}</button>,
          })}
        </div>
      )}

      {view === 'settings' && settings ? (
        <SettingsPage
          settings={settings}
          info={info}
          presets={presets}
          renameRules={data.renameRules}
          watchStatus={data.watch}
          backupStatus={data.backupSchedule}
          section={SECTION_IDS.includes(route.sub) ? route.sub : SECTION_IDS[0]}
          onSection={(s) => go('settings', s)}
          run={run}
          onSaved={data.setSettings}
          onError={onError}
          onNotice={onNotice}
          onDirtyChange={onSettingsDirty}
          auth={auth}
          onAuthChange={onAuthChange}
        />
      ) : view === 'presets' ? (
        <PresetsPage
          presets={presets}
          selectedId={route.sub != null ? Number(route.sub) : null}
          onSelect={(id) => go('presets', id)}
          run={run}
          onError={onError}
          onDirtyChange={onPresetsDirty}
        />
      ) : view === 'stats' ? (
        <StatsView changeTick={data.changeTick} onError={onError} />
      ) : view === 'quality' ? (
        <QualityView
          settings={settings}
          scans={data.qualityScans}
          tick={data.qualityTick}
          changeTick={data.changeTick}
          run={run}
          onError={onError}
          onAddToQueue={(paths) => addPaths(paths, { origin: 'quality' })}
          onOpenSettings={() => switchView('settings', 'quality')}
        />
      ) : view === 'naming' ? (
        <NamingView
          settings={settings}
          rules={data.renameRules}
          ruleId={namingRuleId}
          setRuleId={setNamingRuleId}
          checks={data.namingChecks}
          tick={data.namingTick}
          changeTick={data.changeTick}
          run={run}
          onError={onError}
          onFixInRename={openRename}
        />
      ) : view === 'merge' ? (
        <MergeView
          settings={settings}
          merges={data.merges}
          paths={mergePaths}
          setPaths={setMergePaths}
          changeTick={data.changeTick}
          run={run}
          onError={onError}
        />
      ) : view === 'rename' ? (
        <RenameView
          settings={settings}
          rules={data.renameRules}
          ruleId={renameRuleId}
          setRuleId={setRenameRuleId}
          paths={renamePaths}
          setPaths={setRenamePaths}
          changeTick={data.changeTick}
          run={run}
          onError={onError}
        />
      ) : (
      <main className={`panes ${paneClass}`}>
        {paneSwitch}
        <SourceBrowser
          settings={settings}
          changeTick={data.changeTick}
          onAdd={addPaths}
          onError={onError}
          help="convert.sources"
          sortId="convert"
          allowDelete
          onNotice={onNotice}
          onUpload={(dir, root, files) => setUpload({ dir, root, files })}
          onWatch={watchFolder}
        />
        <QueuePanel
          jobs={jobs}
          presets={presets}
          presetId={effectivePresetId}
          onPresetChange={setPresetId}
          position={position}
          onPositionChange={setPosition}
          settings={settings}
          onDropPaths={addPaths}
          onSelect={setSelectedJobId}
          selectedId={selectedJobId}
          run={run}
          onRename={openRename}
          onMerge={openMerge}
          estimate={estimate}
          queueState={queue}
        />
      </main>
      )}

      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          presets={presets}
          settings={settings}
          run={run}
          onRename={openRename}
          canPause={queue?.canPause !== false}
          canConvertNow={!!queue && !queue.running && queue.activeJobId == null}
          onClose={() => setSelectedJobId(null)}
          onSelect={setSelectedJobId}
        />
      )}
      {upload && (
        <UploadDialog
          dir={upload.dir}
          root={upload.root}
          initialFiles={upload.files}
          settings={settings}
          onStart={uploads.add}
          onError={onError}
          onClose={() => setUpload(null)}
        />
      )}
      <UploadsPanel uploads={uploads} />
      <Toasts toasts={toasts} />
    </div>
    </HelpProvider>
  );
}
