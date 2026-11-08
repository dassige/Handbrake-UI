import { useCallback, useMemo, useState } from 'react';
import { Clapperboard, Pause, Play, Settings as SettingsIcon, SlidersHorizontal, WifiOff } from 'lucide-react';
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
  const data = useLiveData(onError);
  const { jobs, queue, presets, settings, info, connected } = data;

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [dialog, setDialog] = useState(null); // 'presets' | 'settings'
  const [presetId, setPresetId] = useState(null);
  const [position, setPosition] = useState('end');

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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Clapperboard size={20} />
          <span>HandBrake Queue</span>
        </div>
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

      <main className="panes">
        <SourceBrowser settings={settings} changeTick={data.changeTick} onAdd={addPaths} onError={onError} />
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
        />
      </main>

      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          presets={presets}
          settings={settings}
          run={run}
          onClose={() => setSelectedJobId(null)}
          onSelect={setSelectedJobId}
        />
      )}
      {dialog === 'presets' && <PresetsDialog presets={presets} run={run} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && settings && (
        <SettingsDialog
          settings={settings}
          info={info}
          run={run}
          onSaved={data.setSettings}
          onClose={() => setDialog(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
