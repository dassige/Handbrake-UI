import { useCallback } from 'react';
import { CircleStop, Replace, X } from 'lucide-react';
import { api } from '../api.js';
import { dirName, fileName, percent } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { errorText } from '../i18n/serverText.js';
import { useDialogs } from './Dialogs.jsx';

// "Replace original" for jobs added from the quality check (server/src/replace.js). The server
// works through the list in the background (GET/POST /api/replace, "replace" events): the
// `replace` state below is that list.

export const QUALITY_ORIGIN = 'quality';
export const isQualityJob = (job) => job.origin === QUALITY_ORIGIN;

/** This job's place in the background list: { status, error, code, current? } or null. */
export function replaceItemOf(replace, jobId) {
  const item = replace?.items.find((i) => i.id === jobId);
  if (!item) return null;
  return { ...item, current: replace.current?.id === jobId ? replace.current : null };
}

const inProgress = (item) => item && ['waiting', 'replacing'].includes(item.status);

/** Whether the original can be replaced now (the server checks again, and more). */
export const canReplace = (job, replace = null) =>
  isQualityJob(job) && job.status === 'done' && !job.replaced && !['error', 'running'].includes(job.verifyStatus)
  && !inProgress(replaceItemOf(replace, job.id));

/** Where the converted file will go: the original's folder and name, the converted file's extension. */
export function replacedName(job) {
  const ext = fileName(job.outputPath).match(/\.[^.]+$/)?.[0] ?? '';
  return fileName(job.sourcePath).replace(/\.[^.]+$/, '') + ext;
}

/** How far the file being replaced is: 0–1, or null while it is not copying (a move is instant). */
export const copyFraction = (current) => (current?.total ? Math.min(1, current.done / current.total) : null);

/** "Copying the converted file… 42%" */
export function stepText(current) {
  if (!current?.step) return t('job.replace.starting');
  const f = copyFraction(current);
  return `${t(`job.replace.step.${current.step}`)}${f != null ? ` ${percent(f)}` : ''}`;
}

/**
 * A quality-check job: "Replaces original", then "Original replaced"; while in the background
 * list "Waiting to replace" or "Replacing… 42%"; "Replace failed" after a failed attempt.
 */
export function ReplaceBadge({ job, item = null }) {
  if (!isQualityJob(job)) return null;
  let cls = '';
  let text = t('job.replace.badge');
  let title = t('job.replace.badgeTitle');
  if (job.replaced) {
    cls = 'done';
    text = t('job.replace.badgeDone');
    title = t('job.replace.badgeDoneTitle', { path: job.replaced.path });
  } else if (item?.status === 'waiting') {
    cls = 'waiting';
    text = t('job.replace.badgeWaiting');
  } else if (item?.status === 'replacing') {
    cls = 'running';
    const f = copyFraction(item.current);
    text = f != null ? t('job.replace.badgeReplacingPercent', { percent: percent(f) }) : t('job.replace.badgeReplacing');
    title = stepText(item.current);
  } else if (item?.status === 'failed') {
    cls = 'failed';
    text = t('job.replace.badgeFailed');
    title = errorText({ message: item.error, code: item.code });
  }
  return (
    <span className={`badge replace ${cls}`} title={title}>
      <Replace size={11} /> {text}
    </span>
  );
}

/** A thin bar under a job being replaced. */
export function ReplaceRowProgress({ item }) {
  if (item?.status !== 'replacing') return null;
  const f = copyFraction(item.current);
  return (
    <div className={`progress replacing ${f == null ? 'indeterminate' : ''}`} title={stepText(item.current)}>
      <div className="bar" style={{ width: `${(f ?? 1) * 100}%` }} />
    </div>
  );
}

/**
 * Above the queue: the originals being replaced in the background ("3 of 12", the file and how
 * far it is, Stop after this one), then the summary with the failures until dismissed.
 */
export function ReplaceProgress({ replace, run }) {
  if (!replace?.items.length) return null;
  const count = (s) => replace.items.filter((i) => i.status === s).length;
  const total = replace.items.length;
  const finished = total - count('waiting') - count('replacing');
  const current = replace.current;
  const item = current && replace.items.find((i) => i.id === current.id);
  const failed = replace.items.filter((i) => i.status === 'failed');
  const f = copyFraction(current);

  if (replace.running) {
    // Overall: finished jobs plus the part of the current one.
    const overall = (finished + (f ?? 0)) / total;
    return (
      <div className="replace-progress" role="status">
        <div className="replace-progress-head">
          <Replace size={14} />
          <strong>{t('queue.replacing.title', { done: Math.min(finished + 1, total), total })}</strong>
          <span className="muted small replace-progress-file" title={item?.name}>
            {item ? `${item.name} · ${stepText(current)}` : ''}
          </span>
          <span className="spacer" />
          <button className="btn ghost small" disabled={replace.stopping} onClick={() => run(() => api.stopReplace())} title={t('queue.replacing.stopTitle')}>
            <CircleStop size={14} /> {replace.stopping ? t('queue.replacing.stopping') : t('queue.replacing.stop')}
          </button>
        </div>
        <div className="progress"><div className="bar" style={{ width: `${overall * 100}%` }} /></div>
        {failed.length > 0 && <p className="text-bad small">{t('queue.replacing.failedSoFar', { count: failed.length })}</p>}
      </div>
    );
  }

  return (
    <div className={`replace-progress ${failed.length ? 'bad' : 'ok'}`} role="status">
      <div className="replace-progress-head">
        <Replace size={14} />
        <strong>
          {[
            t('queue.replacing.doneCount', { count: count('done') }),
            failed.length ? t('queue.replacing.failedCount', { count: failed.length }) : null,
            count('skipped') ? t('queue.replacing.skippedCount', { count: count('skipped') }) : null,
          ].filter(Boolean).join(' · ')}
        </strong>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => run(() => api.clearReplace())} title={t('queue.replacing.dismiss')} aria-label={t('queue.replacing.dismiss')}>
          <X size={15} />
        </button>
      </div>
      {failed.length > 0 && (
        <ul className="replace-failures">
          {failed.map((i) => (
            <li key={i.id}><strong>{i.name}</strong>: {errorText({ message: i.error, code: i.code })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The last choice of "keep the converted file too", per browser.
const KEEP_KEY = 'encforge.replace.keepConverted';
const lastKeep = () => {
  try {
    return localStorage.getItem(KEEP_KEY) === '1';
  } catch {
    return false;
  }
};
const rememberKeep = (v) => {
  try {
    localStorage.setItem(KEEP_KEY, v ? '1' : '0');
  } catch {
    // private window, storage off: the choice is just not remembered
  }
};

/**
 * Returns replace(jobs): asks whether to keep or delete the originals, and whether to move or
 * copy the converted files, then hands them to the server, which replaces them in the
 * background. Resolves to the number handed over.
 */
export function useReplaceOriginal({ settings, run, replace = null }) {
  const dialogs = useDialogs();
  return useCallback(
    async (jobs) => {
      const list = jobs.filter((j) => canReplace(j, replace));
      if (!list.length) return 0;
      const folder = settings?.replaceBackupFolder || '';
      const one = list.length === 1 ? list[0] : null;
      // Read when a button is pressed (the dialog's message is not re-rendered).
      const opts = { keepConverted: lastKeep() };
      const choice = await dialogs.choose({
        title: one ? t('job.replace.title') : t('job.replace.titleMany', { count: list.length }),
        icon: 'warn',
        cancelValue: null,
        message: (
          <>
            <p>
              {one
                ? rich('job.replace.messageOne', {
                  original: <strong title={one.sourcePath}>{fileName(one.sourcePath)}</strong>,
                  name: <strong>{replacedName(one)}</strong>,
                  folder: <code>{dirName(one.sourcePath)}</code>,
                })
                : t('job.replace.messageMany', { count: list.length })}
            </p>
            <p className="muted small">
              {folder ? rich('job.replace.keepNote', { folder: <code>{folder}</code> }) : t('job.replace.noFolder')}
            </p>
            <label className="set-check">
              <input type="checkbox" defaultChecked={opts.keepConverted} onChange={(e) => (opts.keepConverted = e.target.checked)} />
              <span>
                {t('job.replace.keepConverted', { count: list.length })}
                <span className="set-hint">{t('job.replace.keepConvertedHint')}</span>
              </span>
            </label>
            {list.some((j) => j.verifyStatus === 'warning') && <p className="warn-text">{t('job.replace.warnings')}</p>}
            <p className="muted small">{t('job.replace.background')}</p>
          </>
        ),
        buttons: [
          { label: t('common.cancel'), value: null },
          { label: t('job.replace.delete', { count: list.length }), value: 'delete', danger: true, autoFocus: !folder },
          ...(folder ? [{ label: t('job.replace.keep', { count: list.length }), value: 'keep', primary: true, autoFocus: true }] : []),
        ],
      });
      if (!choice) return 0;
      rememberKeep(opts.keepConverted);
      const r = await run(() => api.startReplace(list.map((j) => j.id), choice === 'keep', opts.keepConverted));
      return r ? list.length : 0;
    },
    [dialogs, run, replace, settings?.replaceBackupFolder],
  );
}
