import { useCallback } from 'react';
import { Replace } from 'lucide-react';
import { api } from '../api.js';
import { dirName, fileName } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { useDialogs } from './Dialogs.jsx';

// "Replace original" for jobs added from the quality check (server/src/replace.js).

export const QUALITY_ORIGIN = 'quality';
export const isQualityJob = (job) => job.origin === QUALITY_ORIGIN;

/** Whether the original can be replaced now (the server checks again, and more). */
export const canReplace = (job) =>
  isQualityJob(job) && job.status === 'done' && !job.replaced && !['error', 'running'].includes(job.verifyStatus);

/** Where the converted file will go: the original's folder and name, the converted file's extension. */
export function replacedName(job) {
  const ext = fileName(job.outputPath).match(/\.[^.]+$/)?.[0] ?? '';
  return fileName(job.sourcePath).replace(/\.[^.]+$/, '') + ext;
}

/** "Replaces original" on a quality-check job; "Original replaced" once done. */
export function ReplaceBadge({ job }) {
  if (!isQualityJob(job)) return null;
  return (
    <span
      className={`badge replace ${job.replaced ? 'done' : ''}`}
      title={job.replaced ? t('job.replace.badgeDoneTitle', { path: job.replaced.path }) : t('job.replace.badgeTitle')}
    >
      <Replace size={11} /> {job.replaced ? t('job.replace.badgeDone') : t('job.replace.badge')}
    </span>
  );
}

/**
 * Returns replace(jobs): asks whether to keep or delete the originals, then replaces them one by
 * one. Resolves to the number replaced.
 */
export function useReplaceOriginal({ settings, run }) {
  const dialogs = useDialogs();
  return useCallback(
    async (jobs) => {
      const list = jobs.filter(canReplace);
      if (!list.length) return 0;
      const folder = settings?.replaceBackupFolder || '';
      const one = list.length === 1 ? list[0] : null;
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
            {list.some((j) => j.verifyStatus === 'warning') && <p className="warn-text">{t('job.replace.warnings')}</p>}
          </>
        ),
        buttons: [
          { label: t('common.cancel'), value: null },
          { label: t('job.replace.delete', { count: list.length }), value: 'delete', danger: true, autoFocus: !folder },
          ...(folder ? [{ label: t('job.replace.keep', { count: list.length }), value: 'keep', primary: true, autoFocus: true }] : []),
        ],
      });
      if (!choice) return 0;
      let replaced = 0;
      for (const j of list) {
        const r = await run(() => api.jobAction(j.id, 'replace-original', { backup: choice === 'keep' }));
        if (r) replaced++;
      }
      if (replaced) await run(async () => replaced, t('job.replace.done', { count: replaced }));
      return replaced;
    },
    [dialogs, run, settings?.replaceBackupFolder],
  );
}
