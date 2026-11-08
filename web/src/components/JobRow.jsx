import { useEffect, useState } from 'react';
import { ArrowUpToLine, GripVertical, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dirName, duration, elapsed, fileName, percent, ratio, relTo, ago } from '../format.js';
import { StatusBadge } from './StatusBadge.jsx';

export const DRAG_JOB = 'application/x-hbui-job';

/** Re-renders every second while the job is running (for elapsed time). */
function useClock(active) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

/** Job buttons: icons in the queue list, labelled buttons in the details drawer. */
export function JobActions({ job, run, queueIndex = -1, labels = false }) {
  const act = (name, body) => run(() => api.jobAction(job.id, name, body));
  const s = job.status;
  const btn = ({ icon: Icon, label, title, danger, onClick }) => (
    <button
      key={label}
      className={labels ? `btn small${danger ? ' danger' : ''}` : `icon-btn${danger ? ' danger' : ''}`}
      title={title ?? label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={labels ? 14 : 16} />
      {labels && label}
    </button>
  );
  return (
    <div className="job-actions" onClick={(e) => e.stopPropagation()}>
      {s === 'running' && btn({ icon: Pause, label: 'Pause', onClick: () => act('pause') })}
      {s === 'paused' && btn({ icon: Play, label: 'Resume', onClick: () => act('resume') })}
      {['running', 'paused', 'queued'].includes(s) && (
        btn({ icon: Square, danger: true, label: 'Cancel', title: s === 'queued' ? 'Cancel (keeps it in the list)' : 'Stop and cancel this conversion', onClick: () => (s === 'queued' || confirm('Cancel this conversion? Progress is lost.')) && act('cancel') })
      )}
      {s === 'queued' && queueIndex > 0 && (
        btn({ icon: ArrowUpToLine, label: 'Move to top', onClick: () => act('move', { where: 'top' }) })
      )}
      {s === 'done' && (
        btn({ icon: RotateCcw, label: 'Convert again', title: 'Convert again (new job; the output gets a suffix)', onClick: () => act('again', { position: 'end' }) })
      )}
      {(s === 'failed' || s === 'cancelled') && (
        btn({ icon: RotateCcw, label: 'Retry', title: 'Put back in the queue', onClick: () => act('retry') })
      )}
      {!['running', 'paused'].includes(s) && (
        btn({ icon: Trash2, label: 'Remove', title: 'Remove from the list (files are not touched)', onClick: () => run(() => api.removeJobs([job.id])) })
      )}
    </div>
  );
}

export function JobRow({
  job, settings, selected, onSelect, run, queueIndex, dropBefore,
  onJobDragStart, onJobDragEnd, onJobDragOver, onJobDrop,
}) {
  const active = job.status === 'running' || job.status === 'paused';
  useClock(job.status === 'running');
  const queued = job.status === 'queued';
  const saved = ratio(job);
  const info = job.sourceInfo;

  let meta;
  if (active) {
    meta = job.phase === 'encoding' || job.status === 'paused'
      ? [
          percent(job.progress),
          job.status === 'running' && job.fps != null ? `${job.fps.toFixed(1)} fps` : null,
          job.status === 'running' && job.eta ? `ETA ${duration(job.eta)}` : null,
          `elapsed ${duration(elapsed(job))}`,
          job.passCount > 1 ? `pass ${job.pass}/${job.passCount}` : null,
        ]
      : [job.phase === 'muxing' ? 'Finishing file…' : 'Reading source…'];
  } else if (job.status === 'done') {
    meta = [
      `${bytes(job.sourceSize)} → ${bytes(job.outputSize)}`,
      saved != null ? `${saved > 0 ? '−' : '+'}${Math.abs(saved)}%` : null,
      `in ${duration(elapsed(job))}`,
      job.avgFps ? `${job.avgFps.toFixed(1)} fps avg` : null,
      ago(job.finishedAt),
    ];
  } else if (job.status === 'failed') {
    meta = [job.error];
  } else {
    meta = [
      bytes(job.sourceSize),
      info?.duration ? duration(info.duration) : null,
      info?.width ? `${info.width}×${info.height}` : null,
      info?.videoCodec,
    ];
  }

  return (
    <div
      className={`job-row ${job.status} ${selected ? 'selected' : ''} ${dropBefore ? 'drop-before' : ''}`}
      onClick={onSelect}
      draggable={queued}
      onDragStart={queued ? onJobDragStart : undefined}
      onDragEnd={onJobDragEnd}
      onDragOver={onJobDragOver}
      onDrop={onJobDrop}
    >
      <div className="job-grip" title={queued ? 'Drag to reorder' : undefined}>
        {queued ? <GripVertical size={15} /> : null}
      </div>
      <div className="job-main">
        <div className="job-title">
          <StatusBadge status={job.status} phase={job.phase} />
          <span className="job-name" title={job.sourcePath}>{fileName(job.sourcePath)}</span>
        </div>
        <div className="job-sub" title={job.outputPath}>
          <span className="muted">{job.presetName}</span>
          <span className="muted">→ {relTo(settings?.targetRoot, dirName(job.outputPath)) || '.'}</span>
        </div>
        {active && (
          <div className={`progress ${job.status === 'paused' ? 'paused' : ''}`}>
            <div className="bar" style={{ width: `${(job.progress ?? 0) * 100}%` }} />
          </div>
        )}
        <div className={`job-meta ${job.status === 'failed' ? 'text-bad' : ''}`}>
          {meta.filter(Boolean).join(' · ')}
        </div>
      </div>
      <JobActions job={job} run={run} queueIndex={queueIndex} />
    </div>
  );
}
