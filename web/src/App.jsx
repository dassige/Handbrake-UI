import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Clapperboard, Pause, Play, Settings as SettingsIcon, SlidersHorizontal, WifiOff } from 'lucide-react';
import { RenameView } from './rename/RenameView.jsx';
import { MergeView } from './merge/MergeView.jsx';
import { QualityView } from './quality/QualityView.jsx';
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

const VIEWS = ['convert', 'rename', 'merge', 'quality', 'stats', 'presets', 'settings'];

/** "#settings/watch" → { view: 'settings', sub: 'watch' } */
function parseHash(hash) {
  const [v, sub] = hash.replace(/^#/, '').split('/');
  return VIEWS.includes(v) ? { view: v, sub: sub ? decodeURIComponent(sub) : null } : { view: 'convert', sub: null };
}

/** Re-renders every 30 s, so times such as "done around 03:40" stay current. */
function useMinuteClock() {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setT((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}

export default function App() {
  const toasts = useToasts();
  const dialogs = useDialogs();
  const onError = useCallback((e) => toasts.error(e.message || String(e)), [toasts]);
  const onNotice = useCallback((t) => toasts.info(t), [toasts]);
  const eventRef = useRef(null);
  const onEvent = useCallback((type, d) => eventRef.current?.(type, d), []);
  const data = useLiveData(onError, onNotice, onEvent);
  const { jobs, queue, presets, settings, info, connected } = data;
  eventRef.current = useAttention({ jobs, queue });
  useMinuteClock();

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [upload, setUpload] = useState(null); // { dir, root, files } while the upload dialog is open
  const uploads = useUploads({ onError });
  const [presetId, setPresetId] = useState(null);
  const [position, setPosition] = useState('end');
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const view = route.view;
  const [renamePaths, setRenamePaths] = useState([]);
  const [mergePaths, setMergePaths] = useState([]);
  const settingsDirty = useRef(false);
  const onSettingsDirty = useCallback((d) => (settingsDirty.current = d), []);

  const go = useCallback((v, sub = null) => {
    setRoute({ view: v, sub });
    history.replaceState(null, '', v === 'convert' ? '#' : `#${v}${sub != null ? `/${encodeURIComponent(sub)}` : ''}`);
  }, []);

  /** Changes view; leaving Settings with unsaved changes asks first. */
  const switchView = useCallback(
    async (v, sub = null) => {
      if (view === 'settings' && v !== 'settings' && settingsDirty.current) {
        const ok = await dialogs.confirm({
          title: 'Unsaved settings',
          message: 'Leave Settings without saving? Your changes will be lost.',
          confirmLabel: 'Leave without saving',
          danger: true,
        });
        if (!ok) return;
        settingsDirty.current = false;
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

  /** Opens the rename view with these files added. */
  const openRename = useCallback(
    (paths) => {
      setRenamePaths((p) => [...new Set([...p, ...paths])]);
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
  const [paneClass, paneSwitch, showPane] = usePaneSwitch(['Sources', `Queue${queue?.counts && activeJobs(queue.counts) ? ` (${activeJobs(queue.counts)})` : ''}`]);

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

  const addPaths = useCallback(
    async (paths) => {
      if (!paths.length) return;
      if (!effectivePresetId) {
        toasts.error('Import a HandBrake preset first');
        switchView('presets');
        return;
      }
      const r = await run(() => api.addJobs(paths, effectivePresetId, position));
      if (!r) return;
      const reasons = {};
      for (const s of r.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
      const skipped = Object.entries(reasons).map(([k, n]) => `${n} ${k}`).join(', ');
      if (r.added.length) {
        toasts.info(`Added ${r.added.length} file${r.added.length > 1 ? 's' : ''}${skipped ? ` · skipped: ${skipped}` : ''}`);
        showPane(1);
      }
      else toasts.error(`Nothing added${skipped ? `: ${skipped}` : ''}`);
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
      title: 'Watch this folder?',
      message: (
        <>
          <p>New videos that appear in <strong title={path}>{displayPath(settings, path)}</strong> will be added to the queue by themselves{preset ? <>, with the default preset ({preset.name})</> : null}.</p>
          <p className="muted small">
            Files already in it are left alone.{settings.watch.enabled ? '' : ' Watching is off, so this turns it on.'} Change the preset and the
            other options in Settings → Watch folders.
          </p>
        </>
      ),
      confirmLabel: 'Watch',
    });
    if (!ok) return;
    const watch = { ...settings.watch, enabled: true, folders: [...settings.watch.folders, { path, presetId: null, recursive: true }] };
    const r = await run(() => api.saveSettings({ watch }), 'Watching the folder');
    if (r) data.setSettings(r);
  }

  const running = queue?.running;
  const counts = queue?.counts ?? {};
  const sched = queue?.schedule;

  /** Start; outside the conversion window, asks whether to wait for it or start now. */
  async function start() {
    if (sched?.enabled && !sched.open && (counts.queued ?? 0) > 0) {
      const choice = await dialogs.choose({
        title: 'Outside the conversion window',
        icon: 'warn',
        cancelValue: null,
        message: (
          <>
            <p>The conversion window opens {sched.nextStart ? clockTime(sched.nextStart) : 'later'}.</p>
            <p className="muted small">“Start now” converts the whole queue straight away, ignoring the window until the queue stops.</p>
          </>
        ),
        buttons: [
          { label: 'Cancel', value: null },
          { label: 'Start now', value: 'now' },
          { label: 'Wait for the window', value: 'wait', primary: true, autoFocus: true },
        ],
      });
      if (!choice) return;
      run(() => api.startQueue(choice === 'now'), choice === 'wait' ? `The queue starts ${clockTime(sched.nextStart)}` : undefined);
      return;
    }
    run(() => api.startQueue());
  }

  let stateText = running ? 'Queue running' : 'Queue stopped';
  if (running && sched?.waiting) stateText = `Waiting for ${clockTime(sched.nextStart)}`;

  return (
    <HelpProvider>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Clapperboard size={20} />
          <span>HandBrake Queue</span>
          <Help id="app.overview" />
        </div>
        <nav className="tabs" aria-label="View">
          <button className={view === 'convert' ? 'active' : ''} onClick={() => switchView('convert')}>Convert</button>
          <button className={view === 'rename' ? 'active' : ''} onClick={() => switchView('rename')}>
            Rename{renamePaths.length ? <span className="chip-count"> {renamePaths.length}</span> : null}
          </button>
          <button className={view === 'merge' ? 'active' : ''} onClick={() => switchView('merge')}>
            Merge{mergePaths.length ? <span className="chip-count"> {mergePaths.length}</span> : null}
          </button>
          <button className={view === 'quality' ? 'active' : ''} onClick={() => switchView('quality')}>Quality</button>
          <button className={view === 'stats' ? 'active' : ''} onClick={() => switchView('stats')}>Stats</button>
        </nav>
        <div className="queue-state">
          <span className={`dot ${running ? (sched?.waiting ? 'wait' : 'on') : 'off'}`} />
          <span>{stateText}</span>
          <button
            className="btn small"
            onClick={() => (running ? run(api.stopQueue) : start())}
            title={running ? 'Finish the current job, then stop' : 'Start converting queued jobs'}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? 'Stop after current' : 'Start'}
          </button>
          <Help id="queue.state" />
          <span className="counts">
            {counts.queued ?? 0} queued · {counts.done ?? 0} done
            {counts.failed ? <span className="text-bad"> · {counts.failed} failed</span> : null}
            {estimate?.seconds > 0 && (
              <span title={estimate.finishAt && !estimate.unknown ? `Done around ${clockTime(estimate.finishAt)}` : undefined}>
                {' '}· ≈ {humanDuration(estimate.seconds)} left
              </span>
            )}
          </span>
          {sched?.enabled && !sched.waiting && (
            <button
              className={`sched-pill ${sched.open ? 'open' : ''}`}
              onClick={() => switchView('settings', 'schedule')}
              title={sched.open ? `Conversion window open${sched.closesAt ? ` until ${clockTime(sched.closesAt)}` : ''}` : `Conversion window closed; opens ${clockTime(sched.nextStart)}`}
            >
              <CalendarClock size={13} />
              {sched.open ? (sched.closesAt ? `until ${clockTime(sched.closesAt)}` : 'open') : clockTime(sched.nextStart)}
            </button>
          )}
        </div>
        <div className="topbar-right">
          {!connected && (
            <span className="offline" title="Live updates disconnected; retrying">
              <WifiOff size={14} /> offline
            </span>
          )}
          <HelpSearchButton />
          <button className={`btn ghost ${view === 'presets' ? 'active' : ''}`} onClick={() => switchView('presets')} title="Presets" aria-label="Presets">
            <SlidersHorizontal size={16} /> <span className="btn-label">Presets</span>
          </button>
          <button className={`btn ghost ${view === 'settings' ? 'active' : ''}`} onClick={() => switchView('settings')} title="Settings" aria-label="Settings">
            <SettingsIcon size={16} /> <span className="btn-label">Settings</span>
          </button>
        </div>
      </header>

      {info?.handbrake?.error && (
        <div className="banner bad">HandBrakeCLI is not available: {info.handbrake.error}</div>
      )}
      {presets.length === 0 && view !== 'presets' && (
        <div className="banner">
          No presets yet. <button className="link" onClick={() => switchView('presets')}>Import a preset</button>{' '}
          exported from HandBrake to start converting.
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
        />
      ) : view === 'presets' ? (
        <PresetsPage
          presets={presets}
          selectedId={route.sub != null ? Number(route.sub) : null}
          onSelect={(id) => go('presets', id)}
          run={run}
          onError={onError}
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
          onAddToQueue={addPaths}
          onOpenSettings={() => switchView('settings', 'quality')}
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
