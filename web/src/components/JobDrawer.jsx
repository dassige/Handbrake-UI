import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleX, Copy, Download, FileText, Info, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime, duration, elapsed, fileName, percent, ratio } from '../format.js';
import { Help } from '../help/Help.jsx';
import { useEscape } from './Modal.jsx';
import { StatusBadge, VerifyBadge } from './StatusBadge.jsx';
import { JobActions } from './JobRow.jsx';
import { has, t } from '../i18n/index.js';
import { checkDetail, checkLabel, checkNote, renameNote } from '../i18n/serverText.js';

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
        const log = await api.jobLog(job.id);
        if (stop) return;
        const el = pre.current;
        const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setText(log);
        setError(null);
        if (atBottom) requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight));
      } catch (e) {
        if (!stop) setError(e.message);
      }
    };
    load();
    const timer = live ? setInterval(load, 3000) : null;
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [job.id, live, job.status]);

  return (
    <div className="log">
      {error && <p className="text-bad">{error}</p>}
      <pre ref={pre}>{text || (live ? t('job.drawer.waitingForOutput') : t('job.drawer.noLog'))}</pre>
    </div>
  );
}

const CHECK_ICON = {
  ok: <CircleCheck size={15} className="text-good" />,
  warning: <CircleAlert size={15} className="text-warn" />,
  error: <CircleX size={15} className="text-bad" />,
  info: <Info size={15} className="muted" />,
};

/** The Phase row: job.phases.<phase>, or the phase id itself when it has no label. */
function phaseText(job) {
  const phase = job.status === 'paused' ? 'paused' : job.phase;
  if (phase == null) return null;
  return has(`job.phases.${phase}`) ? t(`job.phases.${phase}`) : phase;
}

function CheckSection({ job, run }) {
  const v = job.verify;
  const checking = job.verifyStatus === 'running' || (job.status !== 'done' && job.phase === 'verifying');
  return (
    <section>
      <SectionTitle help="verify.results">{t('job.check.title')}</SectionTitle>
      {checking ? (
        <>
          <p className="muted">{t('job.check.checking')}</p>
          {job.verifyProgress != null && job.status === 'done' && (
            <div className="progress"><div className="bar" style={{ width: `${job.verifyProgress * 100}%` }} /></div>
          )}
        </>
      ) : !v ? (
        <p className="muted">{t('job.check.notChecked')}</p>
      ) : (
        <>
          <p className="check-summary">
            <VerifyBadge status={job.verifyStatus} />
            <span className="muted small">
              {v.mode === 'quick' ? t('job.check.quick') : v.mode === 'full' ? t('job.check.full') : t('job.check.title')}
              {v.checkedAt ? ` · ${dateTime(v.checkedAt)}` : ''}
              {v.tookMs ? ` · ${duration(v.tookMs / 1000)}` : ''}
            </span>
          </p>
          {(v.note || v.noteCode) && <p className="muted">{checkNote(v)}</p>}
          <ul className="checks">
            {v.checks.map((c) => (
              <li key={c.id} className={c.status}>
                {CHECK_ICON[c.status] ?? CHECK_ICON.info}
                <span>
                  <strong>{checkLabel(c)}</strong> <span className="check-detail">{checkDetail(c)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {job.status === 'done' && !checking && (
        <button className="btn small" onClick={() => run(() => api.jobAction(job.id, 'verify'), t('job.check.started'))}>
          <ShieldCheck size={14} /> {t('job.check.again')}
        </button>
      )}
    </section>
  );
}

export function JobDrawer({ job, presets, run, onRename, onClose, onSelect, canPause = true, canConvertNow = false }) {
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
    const r = await run(() => api.jobAction(job.id, 'again', { presetId, position: 'end' }), t('job.drawer.addedToQueue'));
    if (r?.id) onSelect(r.id);
  }

  return (
    <aside className="drawer" aria-label={t('job.drawer.label')}>
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
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </span>
      </div>

      <div className="drawer-body">
        <div className="drawer-actions">
          <span className="row-inline">
            <JobActions job={job} run={run} queueIndex={queued ? 1 : -1} labels onRename={onRename} canPause={canPause} canConvertNow={canConvertNow} />
            <Help id="job.actions" />
          </span>
          {!queued && !active && presets.length > 0 && (
            <label className="field-inline">
              <RotateCcw size={14} /> {t('job.drawer.convertAgainWith')}
              <select value="" onChange={(e) => e.target.value && convertAgain(Number(e.target.value))}>
                <option value="">{t('job.drawer.choosePreset')}</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {active && (
          <section>
            <SectionTitle help="job.statuses">{t('job.progress.title')}</SectionTitle>
            <div className={`progress big ${job.status === 'paused' ? 'paused' : ''} ${job.phase === 'verifying' ? 'checking' : ''}`}>
              <div className="bar" style={{ width: `${(job.progress ?? 0) * 100}%` }} />
              <span>{job.phase === 'verifying' ? t('job.progress.checking', { percent: percent(job.progress) }) : percent(job.progress)}</span>
            </div>
            <Row label={t('job.progress.phase')}>{phaseText(job)}</Row>
            <Row label={t('job.progress.speed')}>{job.fps != null && job.status === 'running' ? t('job.progress.speedValue', { fps: job.fps.toFixed(1), avg: job.avgFps?.toFixed(1) ?? '—' }) : null}</Row>
            <Row label={t('job.progress.timeLeft')}>{job.eta && job.status === 'running' && job.phase !== 'verifying' ? duration(job.eta) : null}</Row>
            <Row label={t('job.progress.elapsed')}>{duration(elapsed(job))}</Row>
            <Row label={t('job.progress.pass')}>{job.passCount > 1 ? t('job.progress.passValue', { pass: job.pass, total: job.passCount }) : null}</Row>
          </section>
        )}

        {(job.status === 'done' || job.phase === 'verifying') && <CheckSection job={job} run={run} />}

        {job.renameNote && (
          <section>
            <SectionTitle help="rename.auto">{t('job.rename.title')}</SectionTitle>
            <p className="warn-text">{renameNote(job.renameNote)}</p>
          </section>
        )}

        {job.error && (
          <section>
            <SectionTitle help="job.log">{job.status === 'failed' ? t('job.error.error') : t('job.error.note')}</SectionTitle>
            <p className={job.status === 'failed' ? 'text-bad' : 'muted'}>{job.error}</p>
          </section>
        )}

        <section>
          <SectionTitle help="job.files">{t('job.files.title')}</SectionTitle>
          <Row label={t('job.files.source')}><code className="path">{job.sourcePath}</code></Row>
          <Row label={t('job.files.output')}>
            {queued && outputEdit != null ? (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await run(() => api.updateJob(job.id, { outputPath: outputEdit }), t('job.files.outputUpdated'));
                  if (r) setOutputEdit(null);
                }}
              >
                <input value={outputEdit} onChange={(e) => setOutputEdit(e.target.value)} autoFocus />
                <button className="btn small primary">{t('common.save')}</button>
                <button type="button" className="btn small" onClick={() => setOutputEdit(null)}>{t('common.cancel')}</button>
              </form>
            ) : (
              <>
                <code className="path">{job.outputPath}</code>
                {queued && (
                  <button className="link" onClick={() => setOutputEdit(job.outputPath)}>{t('job.files.edit')}</button>
                )}
                {queued && <span className="muted small"> {t('job.files.suffixNote')}</span>}
              </>
            )}
          </Row>
          <Row label={t('job.files.sizes')}>
            {bytes(job.sourceSize)}
            {job.outputSize != null && <> → {bytes(job.outputSize)}{saved != null && ` ${saved >= 0 ? t('job.files.smaller', { percent: saved }) : t('job.files.larger', { percent: -saved })}`}</>}
          </Row>
          <button
            className="link small"
            onClick={() => navigator.clipboard?.writeText(job.outputPath)}
            title={t('job.files.copyTitle')}
          >
            <Copy size={12} /> {t('job.files.copy')}
          </button>
          {job.status === 'done' && (
            <a className="link small drawer-download" href={api.downloadUrl(job.outputPath)} download title={t('job.files.downloadTitle')}>
              <Download size={12} /> {t('job.files.download')}
            </a>
          )}
        </section>

        <section>
          <SectionTitle help="presets">{t('job.preset.title')}</SectionTitle>
          {queued ? (
            <select
              value={job.presetId ?? ''}
              onChange={(e) => run(() => api.updateJob(job.id, { presetId: Number(e.target.value) }), t('job.preset.changed'))}
            >
              {job.presetId == null || !presets.some((p) => p.id === job.presetId) ? (
                <option value={job.presetId ?? ''}>{t('job.preset.deleted', { name: job.presetName })}</option>
              ) : null}
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <p>{job.presetName}</p>
          )}
        </section>

        <section>
          <SectionTitle help="job.source">{t('job.source.title')}</SectionTitle>
          {info ? (
            <>
              <Row label={t('job.source.duration')}>{duration(info.duration)}</Row>
              <Row label={t('job.source.video')}>
                {[info.videoCodec, info.width && `${info.width}×${info.height}`, info.fps && `${info.fps} fps`, info.container]
                  .filter(Boolean).join(' · ')}
              </Row>
              <Row label={t('job.source.audio')}>
                {info.audio?.length ? (
                  <ul className="tracks">{info.audio.map((a, i) => <li key={i}>{a.description || `${a.lang} ${a.codec}`}</li>)}</ul>
                ) : t('job.source.none')}
              </Row>
              <Row label={t('job.source.subtitles')}>
                {info.subtitles?.length ? (
                  <ul className="tracks">{info.subtitles.map((s, i) => <li key={i}>{s.lang} ({s.format})</li>)}</ul>
                ) : t('job.source.none')}
              </Row>
              <Row label={t('job.source.chapters')}>{info.chapters || null}</Row>
            </>
          ) : (
            <p className="muted">{job.scanError ? t('job.source.scanError', { error: job.scanError }) : t('job.source.reading')}</p>
          )}
        </section>

        <section>
          <SectionTitle help="job.timing">{t('job.timing.title')}</SectionTitle>
          <Row label={t('job.timing.added')}>{dateTime(job.createdAt)}</Row>
          <Row label={t('job.timing.started')}>{job.startedAt ? dateTime(job.startedAt) : null}</Row>
          <Row label={t('job.timing.finished')}>{job.finishedAt ? dateTime(job.finishedAt) : null}</Row>
          <Row label={t('job.timing.encodeTime')}>{job.finishedAt && job.startedAt ? duration(elapsed(job)) : null}</Row>
          <Row label={t('job.timing.averageSpeed')}>{job.status === 'done' && job.avgFps ? t('job.timing.fps', { fps: job.avgFps.toFixed(1) }) : null}</Row>
          <Row label={t('job.timing.attempts')}>{job.attempts > 1 ? job.attempts : null}</Row>
          <Row label={t('job.timing.exitCode')}>{job.exitCode != null && job.exitCode !== 0 ? job.exitCode : null}</Row>
        </section>

        <section>
          <h3>
            <button className="link" onClick={() => setShowLog((v) => !v)}>
              <FileText size={14} /> {showLog ? t('job.drawer.hideLog') : t('job.drawer.showLog')}
            </button>
            <Help id="job.log" />
          </h3>
          {showLog && <LogViewer job={job} />}
        </section>
      </div>
    </aside>
  );
}
