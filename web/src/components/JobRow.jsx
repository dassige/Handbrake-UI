import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Captions, GripVertical, Pause, Play, RotateCcw, SkipForward, Square, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dirName, duration, elapsed, fileName, humanDuration, percent, ratio, relTo, ago } from '../format.js';
import { StatusBadge, VerifyBadge } from './StatusBadge.jsx';
import { ReplaceBadge } from './replaceOriginal.jsx';
import { useDialogs } from './Dialogs.jsx';
import { t } from '../i18n/index.js';
import { renameNote } from '../i18n/serverText.js';
import { containerProblem } from '../subtitles/modes.js';

export const DRAG_JOB = 'application/x-hbui-job';

/** Solid red square: the outline one looked like a checkbox. */
const StopIcon = (props) => <Square {...props} className="stop-icon" />;

/** Re-renders every second while the job is running (for elapsed time). */
function useClock(active) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/**
 * Job buttons: icons in the queue list, labelled buttons in the details drawer.
 * canConvertNow: the queue is stopped and idle, so a queued job can be converted on its own.
 */
export function JobActions({ job, run, queueIndex = -1, labels = false, onRename, canPause = true, canConvertNow = false }) {
  const dialogs = useDialogs();
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
      {s === 'running' && canPause && btn({ icon: Pause, label: t('job.actions.pause'), onClick: () => act('pause') })}
      {s === 'paused' && btn({ icon: Play, label: t('job.actions.resume'), onClick: () => act('resume') })}
      {['running', 'paused', 'queued'].includes(s) && job.phase === 'verifying' && (
        btn({ icon: SkipForward, label: t('job.actions.skipCheck'), title: t('job.actions.skipCheckTitle'), onClick: () => act('cancel') })
      )}
      {['running', 'paused', 'queued'].includes(s) && job.phase !== 'verifying' && (
        btn({
          icon: StopIcon,
          danger: true,
          label: t('common.cancel'),
          title: s === 'queued' ? t('job.actions.cancelQueuedTitle') : t('job.actions.cancelRunningTitle'),
          onClick: async () => (s === 'queued' || (await dialogs.confirm({
            title: t('job.actions.cancelConversion'),
            message: t('job.actions.cancelMessage'),
            confirmLabel: t('job.actions.cancelConversion'),
            cancelLabel: t('job.actions.keepGoing'),
            danger: true,
          }))) && act('cancel'),
        })
      )}
      {s === 'queued' && canConvertNow && (
        btn({ icon: Play, label: t('job.actions.convertNow'), title: t('job.actions.convertNowTitle'), onClick: () => act('convert-now') })
      )}
      {s === 'queued' && queueIndex > 0 && (
        btn({ icon: ArrowUpToLine, label: t('job.actions.moveTop'), onClick: () => act('move', { where: 'top' }) })
      )}
      {/* In the details drawer: step by step, for touch screens where dragging doesn't work. */}
      {s === 'queued' && labels && btn({ icon: ArrowUp, label: t('job.actions.up'), title: t('job.actions.upTitle'), onClick: () => act('move', { where: 'up' }) })}
      {s === 'queued' && labels && btn({ icon: ArrowDown, label: t('job.actions.down'), title: t('job.actions.downTitle'), onClick: () => act('move', { where: 'down' }) })}
      {s === 'queued' && labels && btn({ icon: ArrowDownToLine, label: t('job.actions.moveBottom'), onClick: () => act('move', { where: 'bottom' }) })}
      {s === 'done' && onRename && btn({ icon: Wand2, label: t('common.rename'), title: t('job.actions.renameTitle'), onClick: () => onRename([job.outputPath]) })}
      {/* Once its original was replaced, converting "again" would convert the converted file. */}
      {s === 'done' && !job.replaced && (
        btn({ icon: RotateCcw, label: t('job.actions.again'), title: t('job.actions.againTitle'), onClick: () => act('again', { position: 'end' }) })
      )}
      {(s === 'failed' || s === 'cancelled') && (
        btn({ icon: RotateCcw, label: t('common.retry'), title: t('job.actions.retryTitle'), onClick: () => act('retry') })
      )}
      {!['running', 'paused'].includes(s) && (
        btn({ icon: Trash2, label: t('common.remove'), title: t('job.actions.removeTitle'), onClick: () => run(() => api.removeJobs([job.id])) })
      )}
    </div>
  );
}

/** Sidecar subtitle files of the job (those that are used), e.g. "CC 2". */
function SubtitleBadge({ job, settings }) {
  const used = (job.subtitles ?? []).filter((f) => f.include !== false);
  if (!used.length) return null;
  // Not converted yet: warn when the output format can't hold some of them.
  const problem = ['queued', 'failed', 'cancelled'].includes(job.status) ? containerProblem(job, settings) : null;
  const title = [
    t('subtitles.row.title', { count: used.length, list: used.map((f) => f.name).join(', ') }),
    problem && t(problem.lost ? 'subtitles.job.containerLost' : 'subtitles.job.containerCopied', { container: problem.container, names: problem.names.join(', ') }),
  ].filter(Boolean).join('\n');
  return (
    <span className={`badge subs ${problem ? (problem.lost ? 'lost' : 'warn') : ''}`} title={title}>
      {problem ? <AlertTriangle size={12} /> : <Captions size={12} />} {used.length}
    </span>
  );
}

/**
 * selected: the job shown in the details. checked/onCheck: picked with its checkbox (several
 * jobs at once); onSelect gets the click event, so Ctrl/Shift-click can pick instead.
 */
export function JobRow({
  job, settings, selected, onSelect, checked = false, onCheck, run, onRename, queueIndex, dropBefore,
  onJobDragStart, onJobDragEnd, onJobDragOver, onJobDrop, estimate, canPause, canConvertNow,
}) {
  const active = job.status === 'running' || job.status === 'paused';
  useClock(job.status === 'running');
  const queued = job.status === 'queued';
  const saved = ratio(job);
  const info = job.sourceInfo;

  let meta;
  if (active) {
    meta = job.phase === 'verifying'
      ? [t('job.row.checking', { percent: percent(job.progress) })]
      : job.phase === 'encoding' || job.status === 'paused'
      ? [
          percent(job.progress),
          job.status === 'running' && job.fps != null ? `${job.fps.toFixed(1)} fps` : null,
          job.status === 'running' && job.eta ? t('job.row.eta', { time: duration(job.eta) }) : null,
          t('job.row.elapsed', { time: duration(elapsed(job)) }),
          job.passCount > 1 ? t('job.row.pass', { pass: job.pass, total: job.passCount }) : null,
        ]
      : [job.phase === 'muxing' ? t('job.row.finishing') : t('job.row.reading')];
  } else if (job.status === 'done') {
    meta = [
      `${bytes(job.sourceSize)} → ${bytes(job.outputSize)}`,
      saved != null ? `${saved > 0 ? '−' : '+'}${Math.abs(saved)}%` : null,
      t('job.row.took', { time: duration(elapsed(job)) }),
      job.avgFps ? t('job.row.fpsAvg', { fps: job.avgFps.toFixed(1) }) : null,
      ago(job.finishedAt),
      renameNote(job.renameNote),
    ];
  } else if (job.status === 'failed') {
    meta = [job.error];
  } else {
    meta = [
      bytes(job.sourceSize),
      info?.duration ? duration(info.duration) : null,
      info?.width ? `${info.width}×${info.height}` : null,
      info?.videoCodec,
      estimate != null ? t('job.row.toConvert', { duration: humanDuration(estimate) }) : null,
    ];
  }

  return (
    <div
      className={`job-row ${job.status} ${selected ? 'selected' : ''} ${checked ? 'checked' : ''} ${dropBefore ? 'drop-before' : ''}`}
      onClick={onSelect}
      draggable={queued}
      onDragStart={queued ? onJobDragStart : undefined}
      onDragEnd={onJobDragEnd}
      onDragOver={onJobDragOver}
      onDrop={onJobDrop}
    >
      {onCheck && (
        <input
          type="checkbox"
          className="job-check"
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={onCheck}
          aria-label={t('queue.selectJob', { name: fileName(job.sourcePath) })}
        />
      )}
      <div className="job-grip" title={queued ? t('job.row.dragToReorder') : undefined}>
        {queued ? <GripVertical size={15} /> : null}
      </div>
      <div className="job-main">
        <div className="job-title">
          <StatusBadge status={job.status} phase={job.phase} />
          {job.status === 'done' && <VerifyBadge status={job.verifyStatus} />}
          <ReplaceBadge job={job} />
          <span className="job-name" title={job.sourcePath}>{fileName(job.sourcePath)}</span>
          <SubtitleBadge job={job} settings={settings} />
        </div>
        <div className="job-sub" title={job.outputPath}>
          <span className="muted">{job.presetName}</span>
          <span className="muted">→ {relTo(settings?.targetRoot, dirName(job.outputPath)) || '.'}</span>
        </div>
        {active && (
          <div className={`progress ${job.status === 'paused' ? 'paused' : ''} ${job.phase === 'verifying' ? 'checking' : ''}`}>
            <div className="bar" style={{ width: `${(job.progress ?? 0) * 100}%` }} />
          </div>
        )}
        <div className={`job-meta ${job.status === 'failed' ? 'text-bad' : ''} ${job.renameNote ? 'has-note' : ''}`}>
          {meta.filter(Boolean).join(' · ')}
        </div>
      </div>
      <JobActions job={job} run={run} queueIndex={queueIndex} onRename={onRename} canPause={canPause} canConvertNow={canConvertNow} />
    </div>
  );
}
