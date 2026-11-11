import { useMemo, useState } from 'react';
import { CalendarClock, Clock, Combine, ShieldCheck, Trash2, Upload, Wand2 } from 'lucide-react';
import { clockTime, humanDuration } from '../format.js';
import { api } from '../api.js';
import { DRAG_PATHS } from './SourceBrowser.jsx';
import { JobRow, DRAG_JOB } from './JobRow.jsx';
import { Help } from '../help/Help.jsx';
import { useDialogs } from './Dialogs.jsx';
import { t } from '../i18n/index.js';

const FILTERS = [
  { key: 'all', labelKey: 'queue.filters.all', match: () => true },
  { key: 'active', labelKey: 'queue.filters.active', match: (j) => ['running', 'paused', 'queued'].includes(j.status) },
  { key: 'done', labelKey: 'queue.filters.done', match: (j) => j.status === 'done' },
  { key: 'failed', labelKey: 'queue.filters.failed', match: (j) => ['failed', 'cancelled'].includes(j.status) },
  // Converted, but the check after conversion found problems (shown in red when there are any).
  { key: 'checkFailed', labelKey: 'queue.filters.checkFailed', match: (j) => j.status === 'done' && j.verifyStatus === 'error', alert: true },
];

export function QueuePanel({
  jobs, presets, presetId, onPresetChange, position, onPositionChange, settings,
  onDropPaths, onSelect, selectedId, run, onRename, onMerge, estimate, queueState,
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
  // "Convert now" on a queued job: only while the queue is stopped and nothing converts.
  const canConvertNow = !!queueState && !queueState.running && queueState.activeJobId == null;

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
        <h2>{t('queue.title')}<Help id="convert.queue" /></h2>
        <div className="pane-tools">
          <label className="field-inline" title={t('queue.presetTitle')}>
            {t('queue.preset')}<Help id="presets" />
            <select value={presetId ?? ''} onChange={(e) => onPresetChange(Number(e.target.value))} disabled={!presets.length}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.category ? `${p.category} / ` : ''}{p.isDefault ? t('queue.presetDefault', { name: p.name }) : p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline" title={t('queue.positionTitle')}>
            {t('common.add')}
            <select value={position} onChange={(e) => onPositionChange(e.target.value)}>
              <option value="end">{t('queue.position.end')}</option>
              <option value="next">{t('queue.position.next')}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? 'active' : ''} ${f.alert && counts[f.key] ? 'alert' : ''}`}
            onClick={() => setFilter(f.key)}
            title={f.key === 'checkFailed' ? t('queue.filters.checkFailedTitle') : undefined}
          >
            {t(f.labelKey)} <span className="chip-count">{counts[f.key]}</span>
          </button>
        ))}
        <Help id="job.statuses" />
        <span className="spacer" />
        {filter === 'checkFailed' && counts.checkFailed > 0 && (
          <button
            className="btn ghost small"
            title={t('queue.checkAllAgainTitle')}
            onClick={async () => {
              for (const j of visible) await run(() => api.jobAction(j.id, 'verify'));
            }}
            disabled={visible.some((j) => j.verifyStatus === 'running')}
          >
            <ShieldCheck size={14} /> {t('queue.checkAllAgain')}
          </button>
        )}
        {filter === 'done' && counts.done > 0 && (
          <button
            className="btn ghost small"
            title={t('queue.renameTheseTitle')}
            onClick={() => onRename(visible.map((j) => j.outputPath))}
          >
            <Wand2 size={14} /> {t('queue.renameThese')}
          </button>
        )}
        {filter === 'done' && counts.done > 1 && onMerge && (
          <button
            className="btn ghost small"
            title={t('queue.mergeTheseTitle')}
            onClick={() => onMerge(visible.map((j) => j.outputPath))}
          >
            <Combine size={14} /> {t('queue.mergeThese')}
          </button>
        )}
        <button
          className="btn ghost small"
          disabled={!finishedCount}
          title={t('queue.clearFinishedTitle')}
          onClick={async () => {
            if (await dialogs.confirm({ title: t('queue.clearDialog.title'), message: t('queue.clearDialog.message', { count: finishedCount }), confirmLabel: t('common.clear') })) {
              run(() => api.clearJobs(['done', 'failed', 'cancelled']));
            }
          }}
        >
          <Trash2 size={14} /> {t('queue.clearFinished')}
        </button>
      </div>

      <EstimateBar estimate={estimate} queue={queueState} />

      <div className="job-list" onDragOver={(e) => dragJob != null && e.preventDefault()} onDrop={() => dragJob != null && reorderDrop(null)}>
        {visible.length === 0 && (
          <div className="drop-hint">
            <Upload size={28} />
            <p>{jobs.length ? t('queue.noMatch') : t('queue.dragHere')}</p>
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
            canPause={queueState?.canPause !== false}
            canConvertNow={canConvertNow}
            estimate={job.status === 'queued' ? estimate?.perJob.get(job.id) : undefined}
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
        {dropActive && <div className="drop-overlay">{t('queue.dropToAdd')}</div>}
      </div>
    </section>
  );
}

/** "≈ 5 h 20 min left · done around 03:40", or why it isn't converting now. */
function EstimateBar({ estimate, queue }) {
  if (!estimate) return null;
  const sched = queue?.schedule;
  const parts = [];
  if (estimate.seconds > 0) parts.push(t('queue.estimate.left', { duration: humanDuration(estimate.seconds) }));
  if (estimate.unknown) parts.push(t('queue.estimate.notEstimated', { count: estimate.unknown }));
  let when = null;
  if (estimate.finishAt && !estimate.unknown) {
    when = t(queue?.running ? 'queue.estimate.doneAround' : 'queue.estimate.ifStartedDoneAround', { time: clockTime(estimate.finishAt) });
  }
  let note = null;
  if (sched?.enabled && !sched.override) {
    if (sched.waiting && sched.nextStart) note = t('queue.estimate.waitingWindow', { time: clockTime(sched.nextStart) });
    else if (queue?.running && !sched.open && sched.nextStart) note = t('queue.estimate.windowClosed', { time: clockTime(sched.nextStart) });
    else if (queue?.running && sched.open && sched.closesAt) note = t('queue.estimate.windowOpenUntil', { time: clockTime(sched.closesAt) });
  }
  if (!parts.length && !note) return null;
  return (
    <div className="estimate-bar">
      <Clock size={14} />
      <span>
        {parts.join(' · ')}
        {when && <>{parts.length ? ' · ' : ''}<strong>{when}</strong></>}
        {estimate.estimated > 0 && !estimate.unknown && <span className="muted"> {t('queue.estimate.guessed')}</span>}
      </span>
      {note && <span className="estimate-note"><CalendarClock size={14} /> {note}</span>}
      <Help id="queue.eta" />
    </div>
  );
}
