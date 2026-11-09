import { useMemo, useState } from 'react';
import { Combine, Trash2, Upload, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { DRAG_PATHS } from './SourceBrowser.jsx';
import { JobRow, DRAG_JOB } from './JobRow.jsx';
import { Help } from '../help/Help.jsx';
import { useDialogs } from './Dialogs.jsx';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'active', label: 'Active', match: (j) => ['running', 'paused', 'queued'].includes(j.status) },
  { key: 'done', label: 'Converted', match: (j) => j.status === 'done' },
  { key: 'failed', label: 'Failed / cancelled', match: (j) => ['failed', 'cancelled'].includes(j.status) },
];

export function QueuePanel({
  jobs, presets, presetId, onPresetChange, position, onPositionChange, settings,
  onDropPaths, onSelect, selectedId, run, onRename, onMerge,
}) {
  const dialogs = useDialogs();
  const [filter, setFilter] = useState('all');
  const [dropActive, setDropActive] = useState(false);
  const [dragJob, setDragJob] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const visible = useMemo(() => jobs.filter(FILTERS.find((f) => f.key === filter).match), [jobs, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, jobs.filter(f.match).length])), [jobs]);
  const queuedIds = jobs.filter((j) => j.status === 'queued').map((j) => j.id);
  const finishedCount = jobs.filter((j) => ['done', 'failed', 'cancelled'].includes(j.status)).length;

  const isPathDrag = (e) => e.dataTransfer.types.includes(DRAG_PATHS);

  function onDragOver(e) {
    if (isPathDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    }
  }

  function onDrop(e) {
    setDropActive(false);
    const raw = e.dataTransfer.getData(DRAG_PATHS);
    if (!raw) return;
    e.preventDefault();
    onDropPaths(JSON.parse(raw));
  }

  /** Drops a queued job before another queued job. */
  function reorderDrop(targetId) {
    const moving = dragJob;
    setDragJob(null);
    setDropTarget(null);
    if (moving == null || moving === targetId) return;
    const order = queuedIds.filter((id) => id !== moving);
    const at = targetId == null ? order.length : order.indexOf(targetId);
    order.splice(at < 0 ? order.length : at, 0, moving);
    run(() => api.reorder(order));
  }

  return (
    <section
      className={`pane queue ${dropActive ? 'drop-active' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropActive(false)}
      onDrop={onDrop}
    >
      <div className="pane-head">
        <h2>Queue<Help id="convert.queue" /></h2>
        <div className="pane-tools">
          <label className="field-inline" title="Preset used for files you add">
            Preset<Help id="presets" />
            <select value={presetId ?? ''} onChange={(e) => onPresetChange(Number(e.target.value))} disabled={!presets.length}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.category ? `${p.category} / ` : ''}{p.name}{p.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline" title="Where new files go in the queue">
            Add
            <select value={position} onChange={(e) => onPositionChange(e.target.value)}>
              <option value="end">at the end</option>
              <option value="next">next</option>
            </select>
          </label>
        </div>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label} <span className="chip-count">{counts[f.key]}</span>
          </button>
        ))}
        <Help id="job.statuses" />
        <span className="spacer" />
        {filter === 'done' && counts.done > 0 && (
          <button
            className="btn ghost small"
            title="Open the converted files in the Rename view"
            onClick={() => onRename(visible.map((j) => j.outputPath))}
          >
            <Wand2 size={14} /> Rename these
          </button>
        )}
        {filter === 'done' && counts.done > 1 && onMerge && (
          <button
            className="btn ghost small"
            title="Open the converted files in the Merge view"
            onClick={() => onMerge(visible.map((j) => j.outputPath))}
          >
            <Combine size={14} /> Merge these
          </button>
        )}
        <button
          className="btn ghost small"
          disabled={!finishedCount}
          title="Remove converted, failed and cancelled jobs from the list (files are not touched)"
          onClick={async () => {
            if (await dialogs.confirm({ title: 'Clear finished jobs', message: `Remove ${finishedCount} finished job(s) from the list? Files are not deleted.`, confirmLabel: 'Clear' })) {
              run(() => api.clearJobs(['done', 'failed', 'cancelled']));
            }
          }}
        >
          <Trash2 size={14} /> Clear finished
        </button>
      </div>

      <div className="job-list" onDragOver={(e) => dragJob != null && e.preventDefault()} onDrop={() => dragJob != null && reorderDrop(null)}>
        {visible.length === 0 && (
          <div className="drop-hint">
            <Upload size={28} />
            <p>{jobs.length ? 'No jobs match this filter.' : 'Drag files or folders here from Sources.'}</p>
          </div>
        )}
        {visible.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            settings={settings}
            selected={job.id === selectedId}
            onSelect={() => onSelect(job.id)}
            run={run}
            onRename={onRename}
            queueIndex={queuedIds.indexOf(job.id)}
            queueLength={queuedIds.length}
            dropBefore={dropTarget === job.id}
            onJobDragStart={(e) => {
              e.dataTransfer.setData(DRAG_JOB, String(job.id));
              e.dataTransfer.effectAllowed = 'move';
              setDragJob(job.id);
            }}
            onJobDragEnd={() => {
              setDragJob(null);
              setDropTarget(null);
            }}
            onJobDragOver={(e) => {
              if (dragJob == null || job.status !== 'queued') return;
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(job.id);
            }}
            onJobDrop={(e) => {
              if (dragJob == null || job.status !== 'queued') return;
              e.preventDefault();
              e.stopPropagation();
              reorderDrop(job.id);
            }}
          />
        ))}
        {dropActive && <div className="drop-overlay">Drop to add to the queue</div>}
      </div>
    </section>
  );
}
