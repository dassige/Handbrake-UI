import { useCallback, useMemo, useState } from 'react';
import { Clapperboard, Pause, Play, Settings as SettingsIcon, SlidersHorizontal, WifiOff } from 'lucide-react';
import { RenameView } from './rename/RenameView.jsx';
import { MergeView } from './merge/MergeView.jsx';
import { QualityView } from './quality/QualityView.jsx';
import { UploadDialog } from './upload/UploadDialog.jsx';
import { UploadsPanel } from './upload/UploadsPanel.jsx';
import { useUploads } from './upload/useUploads.js';
import { Help, HelpProvider, HelpSearchButton } from './help/Help.jsx';
import { api } from './api.js';
import { useLiveData } from './useLiveData.js';
import { Toasts, useToasts } from './components/Toasts.jsx';
import { SourceBrowser } from './components/SourceBrowser.jsx';
import { QueuePanel } from './components/QueuePanel.jsx';
import { JobDrawer } from './components/JobDrawer.jsx';
import { PresetsDialog } from './components/PresetsDialog.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';

export default function App() {
  const toasts = useToasts();
  const onError = useCallback((e) => toasts.error(e.message || String(e)), [toasts]);
  const onNotice = useCallback((t) => toasts.info(t), [toasts]);
  const data = useLiveData(onError, onNotice);
  const { jobs, queue, presets, settings, info, connected } = data;

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [dialog, setDialog] = useState(null); // 'presets' | 'settings'
  const [upload, setUpload] = useState(null); // { dir, root, files } while the upload dialog is open
  const uploads = useUploads({ onError });
  const [presetId, setPresetId] = useState(null);
  const [position, setPosition] = useState('end');
  const [view, setView] = useState(() => ({ '#rename': 'rename', '#merge': 'merge', '#quality': 'quality' })[location.hash] ?? 'convert');
  const [renamePaths, setRenamePaths] = useState([]);
  const [mergePaths, setMergePaths] = useState([]);

  const switchView = useCallback((v) => {
    setView(v);
    history.replaceState(null, '', v === 'convert' ? '#' : `#${v}`);
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
        toasts.error('Upload a HandBrake preset first');
        setDialog('presets');
        return;
      }
      const r = await run(() => api.addJobs(paths, effectivePresetId, position));
      if (!r) return;
      const reasons = {};
      for (const s of r.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
      const skipped = Object.entries(reasons).map(([k, n]) => `${n} ${k}`).join(', ');
      if (r.added.length) toasts.info(`Added ${r.added.length} file${r.added.length > 1 ? 's' : ''}${skipped ? ` · skipped: ${skipped}` : ''}`);
      else toasts.error(`Nothing added${skipped ? `: ${skipped}` : ''}`);
    },
    [effectivePresetId, position, run, toasts],
  );

  const running = queue?.running;
  const counts = queue?.counts ?? {};

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
          <button className={view === 'quality' ? 'active' : ''} onClick={() => switchView('quality')}>
            Quality
          </button>
        </nav>
        <div className="queue-state">
          <span className={`dot ${running ? 'on' : 'off'}`} />
          <span>{running ? 'Queue running' : 'Queue stopped'}</span>
          <button
            className="btn small"
            onClick={() => run(running ? api.stopQueue : api.startQueue)}
            title={running ? 'Finish the current job, then stop' : 'Start converting queued jobs'}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? 'Stop after current' : 'Start'}
          </button>
          <Help id="queue.state" />
          <span className="counts">
            {counts.queued ?? 0} queued · {counts.done ?? 0} done
            {counts.failed ? <span className="text-bad"> · {counts.failed} failed</span> : null}
          </span>
        </div>
        <div className="topbar-right">
          {!connected && (
            <span className="offline" title="Live updates disconnected; retrying">
              <WifiOff size={14} /> offline
            </span>
          )}
          <HelpSearchButton />
          <button className="btn ghost" onClick={() => setDialog('presets')}>
            <SlidersHorizontal size={16} /> Presets
          </button>
          <button className="btn ghost" onClick={() => setDialog('settings')}>
            <SettingsIcon size={16} /> Settings
          </button>
        </div>
      </header>

      {info?.handbrake?.error && (
        <div className="banner bad">HandBrakeCLI is not available: {info.handbrake.error}</div>
      )}
      {presets.length === 0 && (
        <div className="banner">
          No presets yet. <button className="link" onClick={() => setDialog('presets')}>Upload a preset</button>{' '}
          exported from HandBrake to start converting.
        </div>
      )}

      {view === 'quality' ? (
        <QualityView
          settings={settings}
          scans={data.qualityScans}
          tick={data.qualityTick}
          changeTick={data.changeTick}
          run={run}
          onError={onError}
          onAddToQueue={addPaths}
          onOpenSettings={() => setDialog('settings')}
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
      <main className="panes">
        <SourceBrowser
          settings={settings}
          changeTick={data.changeTick}
          onAdd={addPaths}
          onError={onError}
          help="convert.sources"
          onUpload={(dir, root, files) => setUpload({ dir, root, files })}
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
          onClose={() => setSelectedJobId(null)}
          onSelect={setSelectedJobId}
        />
      )}
      {dialog === 'presets' && <PresetsDialog presets={presets} run={run} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && settings && (
        <SettingsDialog
          settings={settings}
          info={info}
          renameRules={data.renameRules}
          run={run}
          onSaved={data.setSettings}
          onClose={() => setDialog(null)}
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
