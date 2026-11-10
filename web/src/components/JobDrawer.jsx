import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleX, Copy, Download, FileText, Info, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime, duration, elapsed, fileName, percent, ratio } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useEscape } from './Modal.jsx';
import { StatusBadge, VerifyBadge } from './StatusBadge.jsx';
import { JobActions } from './JobRow.jsx';

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function SectionTitle({ children, help }) {
  return (
    <h3>
      {children}
      {help && <Help id={help} />}
    </h3>
  );
}

function LogViewer({ job }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const pre = useRef(null);
  const live = job.status === 'running' || job.status === 'paused';

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const t = await api.jobLog(job.id);
        if (stop) return;
        const el = pre.current;
        const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setText(t);
        setError(null);
        if (atBottom) requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight));
      } catch (e) {
        if (!stop) setError(e.message);
      }
    };
    load();
    const t = live ? setInterval(load, 3000) : null;
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [job.id, live, job.status]);

  return (
    <div className="log">
      {error && <p className="text-bad">{error}</p>}
      <pre ref={pre}>{text || (live ? 'Waiting for output…' : 'No log for this job.')}</pre>
    </div>
  );
}

const CHECK_ICON = {
  ok: <CircleCheck size={15} className="text-good" />,
  warning: <CircleAlert size={15} className="text-warn" />,
  error: <CircleX size={15} className="text-bad" />,
  info: <Info size={15} className="muted" />,
};

function CheckSection({ job, run }) {
  const v = job.verify;
  const checking = job.verifyStatus === 'running' || (job.status !== 'done' && job.phase === 'verifying');
  return (
    <section>
      <SectionTitle help="verify.results">Check</SectionTitle>
      {checking ? (
        <>
          <p className="muted">Checking the converted file…</p>
          {job.verifyProgress != null && job.status === 'done' && (
            <div className="progress"><div className="bar" style={{ width: `${job.verifyProgress * 100}%` }} /></div>
          )}
        </>
      ) : !v ? (
        <p className="muted">Not checked.</p>
      ) : (
        <>
          <p className="check-summary">
            <VerifyBadge status={job.verifyStatus} />
            <span className="muted small">
              {v.mode === 'quick' ? 'Quick check' : v.mode === 'full' ? 'Full check' : 'Check'}
              {v.checkedAt ? ` · ${dateTime(v.checkedAt)}` : ''}
              {v.tookMs ? ` · ${duration(v.tookMs / 1000)}` : ''}
            </span>
          </p>
          {v.note && <p className="muted">{v.note}</p>}
          <ul className="checks">
            {v.checks.map((c) => (
              <li key={c.id} className={c.status}>
                {CHECK_ICON[c.status] ?? CHECK_ICON.info}
                <span>
                  <strong>{c.label}</strong> <span className="check-detail">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {job.status === 'done' && !checking && (
        <button className="btn small" onClick={() => run(() => api.jobAction(job.id, 'verify'), 'Checking the file…')}>
          <ShieldCheck size={14} /> Check again
        </button>
      )}
    </section>
  );
}

export function JobDrawer({ job, presets, run, onRename, onClose, onSelect, canPause = true }) {
  const [showLog, setShowLog] = useState(job.status === 'failed');
  const [outputEdit, setOutputEdit] = useState(null);
  const info = job.sourceInfo;
  const saved = ratio(job);
  const queued = job.status === 'queued';
  const active = job.status === 'running' || job.status === 'paused';
  useEscape(onClose);

  useEffect(() => {
    setOutputEdit(null);
    setShowLog(job.status === 'failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  async function convertAgain(presetId) {
    const r = await run(() => api.jobAction(job.id, 'again', { presetId, position: 'end' }), 'Added to the queue');
    if (r?.id) onSelect(r.id);
  }

  return (
    <aside className="drawer" aria-label="Job details">
      <div className="drawer-head">
        <div>
          <span className="badges">
            <StatusBadge status={job.status} phase={job.phase} />
            {job.status === 'done' && <VerifyBadge status={job.verifyStatus} />}
          </span>
          <h2 title={job.sourcePath}>{fileName(job.sourcePath)}</h2>
        </div>
        <span className="drawer-head-tools">
          <Help id="job.details" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </span>
      </div>

      <div className="drawer-body">
        <div className="drawer-actions">
          <span className="row-inline">
            <JobActions job={job} run={run} queueIndex={queued ? 1 : -1} labels onRename={onRename} canPause={canPause} />
            <Help id="job.actions" />
          </span>
          {!queued && !active && presets.length > 0 && (
            <label className="field-inline">
              <RotateCcw size={14} /> Convert again with
              <select value="" onChange={(e) => e.target.value && convertAgain(Number(e.target.value))}>
                <option value="">choose preset…</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {active && (
          <section>
            <SectionTitle help="job.statuses">Progress</SectionTitle>
            <div className={`progress big ${job.status === 'paused' ? 'paused' : ''} ${job.phase === 'verifying' ? 'checking' : ''}`}>
              <div className="bar" style={{ width: `${(job.progress ?? 0) * 100}%` }} />
              <span>{job.phase === 'verifying' ? `Checking ${percent(job.progress)}` : percent(job.progress)}</span>
            </div>
            <Row label="Phase">{job.status === 'paused' ? 'paused' : job.phase === 'verifying' ? 'checking the converted file' : job.phase}</Row>
            <Row label="Speed">{job.fps != null && job.status === 'running' ? `${job.fps.toFixed(1)} fps (avg ${job.avgFps?.toFixed(1) ?? '—'})` : null}</Row>
            <Row label="Time left">{job.eta && job.status === 'running' && job.phase !== 'verifying' ? duration(job.eta) : null}</Row>
            <Row label="Elapsed">{duration(elapsed(job))}</Row>
            <Row label="Pass">{job.passCount > 1 ? `${job.pass} of ${job.passCount}` : null}</Row>
          </section>
        )}

        {(job.status === 'done' || job.phase === 'verifying') && <CheckSection job={job} run={run} />}

        {job.renameNote && (
          <section>
            <SectionTitle help="rename.auto">Rename</SectionTitle>
            <p className="warn-text">{job.renameNote}</p>
          </section>
        )}

        {job.error && (
          <section>
            <SectionTitle help="job.log">{job.status === 'failed' ? 'Error' : 'Note'}</SectionTitle>
            <p className={job.status === 'failed' ? 'text-bad' : 'muted'}>{job.error}</p>
          </section>
        )}

        <section>
          <SectionTitle help="job.files">Files</SectionTitle>
          <Row label="Source"><code className="path">{job.sourcePath}</code></Row>
          <Row label="Output">
            {queued && outputEdit != null ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await run(() => api.updateJob(job.id, { outputPath: outputEdit }), 'Output path updated');
                  if (r) setOutputEdit(null);
                }}
              >
                <input value={outputEdit} onChange={(e) => setOutputEdit(e.target.value)} autoFocus />
                <button className="btn small primary">Save</button>
                <button type="button" className="btn small" onClick={() => setOutputEdit(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <code className="path">{job.outputPath}</code>
                {queued && (
                  <button className="link" onClick={() => setOutputEdit(job.outputPath)}>edit</button>
                )}
                {queued && <span className="muted small"> (a suffix is added if the file exists when it starts)</span>}
              </>
            )}
          </Row>
          <Row label="Sizes">
            {bytes(job.sourceSize)}
            {job.outputSize != null && <> → {bytes(job.outputSize)}{saved != null && ` (${saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`})`}</>}
          </Row>
          <button
            className="link small"
            onClick={() => navigator.clipboard?.writeText(job.outputPath)}
            title="Copy output path"
          >
            <Copy size={12} /> copy output path
          </button>
          {job.status === 'done' && (
            <a className="link small drawer-download" href={api.downloadUrl(job.outputPath)} download title="Download the converted file to this computer">
              <Download size={12} /> download converted file
            </a>
          )}
        </section>

        <section>
          <SectionTitle help="presets">Preset</SectionTitle>
          {queued ? (
            <select
              value={job.presetId ?? ''}
              onChange={(e) => run(() => api.updateJob(job.id, { presetId: Number(e.target.value) }), 'Preset changed')}
            >
              {job.presetId == null || !presets.some((p) => p.id === job.presetId) ? (
                <option value={job.presetId ?? ''}>{job.presetName} (deleted)</option>
              ) : null}
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <p>{job.presetName}</p>
          )}
        </section>

        <section>
          <SectionTitle help="job.source">Source</SectionTitle>
          {info ? (
            <>
              <Row label="Duration">{duration(info.duration)}</Row>
              <Row label="Video">
                {[info.videoCodec, info.width && `${info.width}×${info.height}`, info.fps && `${info.fps} fps`, info.container]
                  .filter(Boolean).join(' · ')}
              </Row>
              <Row label="Audio">
                {info.audio?.length ? (
                  <ul className="tracks">{info.audio.map((a, i) => <li key={i}>{a.description || `${a.lang} ${a.codec}`}</li>)}</ul>
                ) : 'none'}
              </Row>
              <Row label="Subtitles">
                {info.subtitles?.length ? (
                  <ul className="tracks">{info.subtitles.map((s, i) => <li key={i}>{s.lang} ({s.format})</li>)}</ul>
                ) : 'none'}
              </Row>
              <Row label="Chapters">{info.chapters || null}</Row>
            </>
          ) : (
            <p className="muted">{job.scanError ? `Could not read source details: ${job.scanError}` : 'Reading source details…'}</p>
          )}
        </section>

        <section>
          <SectionTitle help="job.timing">Timing</SectionTitle>
          <Row label="Added">{dateTime(job.createdAt)}</Row>
          <Row label="Started">{job.startedAt ? dateTime(job.startedAt) : null}</Row>
          <Row label="Finished">{job.finishedAt ? dateTime(job.finishedAt) : null}</Row>
          <Row label="Encode time">{job.finishedAt && job.startedAt ? duration(elapsed(job)) : null}</Row>
          <Row label="Average speed">{job.status === 'done' && job.avgFps ? `${job.avgFps.toFixed(1)} fps` : null}</Row>
          <Row label="Attempts">{job.attempts > 1 ? job.attempts : null}</Row>
          <Row label="Exit code">{job.exitCode != null && job.exitCode !== 0 ? job.exitCode : null}</Row>
        </section>

        <section>
          <h3>
            <button className="link" onClick={() => setShowLog((v) => !v)}>
              <FileText size={14} /> {showLog ? 'Hide' : 'Show'} HandBrake log
            </button>
            <Help id="job.log" />
          </h3>
          {showLog && <LogViewer job={job} />}
        </section>
      </div>
    </aside>
  );
}
