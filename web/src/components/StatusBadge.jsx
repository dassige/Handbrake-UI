const LABELS = {
  queued: 'Queued',
  running: 'Converting',
  paused: 'Paused',
  done: 'Converted',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusBadge({ status, phase }) {
  let label = LABELS[status] ?? status;
  if (status === 'running' && phase === 'scanning') label = 'Scanning';
  if (status === 'running' && phase === 'muxing') label = 'Finishing';
  if (phase === 'verifying' && (status === 'running' || status === 'paused')) label = status === 'paused' ? 'Check paused' : 'Checking';
  return <span className={`badge ${status}`}>{label}</span>;
}

const VERIFY = {
  ok: ['done', 'Checked'],
  warning: ['paused', 'Check warnings'],
  error: ['failed', 'Check failed'],
  skipped: ['', 'Not checked'],
  running: ['running', 'Checking'],
};

/** Result of the check after conversion (see help topic verify.results). */
export function VerifyBadge({ status }) {
  if (!status) return null;
  const [cls, label] = VERIFY[status] ?? ['', status];
  return <span className={`badge ${cls} verify`}>{label}</span>;
}

/** Compact summary of a folder's job counts, e.g. "3 converted · 1 queued". */
export function FolderBadges({ counts }) {
  if (!counts) return null;
  const parts = [];
  const active = (counts.running ?? 0) + (counts.paused ?? 0);
  if (active) parts.push(['running', `${active} converting`]);
  if (counts.queued) parts.push(['queued', `${counts.queued} queued`]);
  if (counts.done) parts.push(['done', `${counts.done} converted`]);
  if (counts.failed) parts.push(['failed', `${counts.failed} failed`]);
  return (
    <span className="folder-badges">
      {parts.map(([k, t]) => (
        <span key={k} className={`badge ${k}`}>{t}</span>
      ))}
    </span>
  );
}
