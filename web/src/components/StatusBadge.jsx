import { has, t } from '../i18n/index.js';

// Labels: components.status.<status> (queued, running, paused, done, failed, cancelled).
const statusLabel = (status) => (has(`components.status.${status}`) ? t(`components.status.${status}`) : status);

export function StatusBadge({ status, phase }) {
  let label = statusLabel(status);
  if (status === 'running' && phase === 'scanning') label = t('components.status.scanning');
  if (status === 'running' && phase === 'muxing') label = t('components.status.finishing');
  if (phase === 'verifying' && (status === 'running' || status === 'paused')) label = status === 'paused' ? t('components.status.checkPaused') : t('components.status.checking');
  return <span className={`badge ${status}`}>{label}</span>;
}

// Badge class per check result; the label is components.verify.<status>.
const VERIFY = {
  ok: 'done',
  warning: 'paused',
  error: 'failed',
  skipped: '',
  running: 'running',
};

/** Result of the check after conversion (see help topic verify.results). */
export function VerifyBadge({ status }) {
  if (!status) return null;
  const cls = VERIFY[status] ?? '';
  const label = Object.hasOwn(VERIFY, status) ? t(`components.verify.${status}`) : status;
  return <span className={`badge ${cls} verify`}>{label}</span>;
}

/** Compact summary of a folder's job counts, e.g. "3 converted · 1 queued". */
export function FolderBadges({ counts }) {
  if (!counts) return null;
  const parts = [];
  const active = (counts.running ?? 0) + (counts.paused ?? 0);
  if (active) parts.push(['running', t('components.folderBadges.converting', { count: active })]);
  if (counts.queued) parts.push(['queued', t('components.folderBadges.queued', { count: counts.queued })]);
  if (counts.done) parts.push(['done', t('components.folderBadges.converted', { count: counts.done })]);
  if (counts.failed) parts.push(['failed', t('components.folderBadges.failed', { count: counts.failed })]);
  return (
    <span className="folder-badges">
      {parts.map(([k, text]) => (
        <span key={k} className={`badge ${k}`}>{text}</span>
      ))}
    </span>
  );
}
