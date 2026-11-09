import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Upload, X } from 'lucide-react';
import { bytes, percent } from '../format.js';
import { useDialogs } from '../components/Dialogs.jsx';

function speed(item) {
  if (item.status !== 'uploading' || !item.startedAt) return null;
  const secs = (Date.now() - item.startedAt) / 1000;
  return secs > 2 ? (item.sent - (item.startSent ?? 0)) / secs : null;
}

/** Floating list of uploads in progress; it stays while you use the rest of the app. */
export function UploadsPanel({ uploads }) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(true);
  const { items } = uploads;
  const active = items.filter((x) => ['waiting', 'uploading'].includes(x.status));
  // Open while uploading; folded to its title bar once everything is finished.
  const busy = active.length > 0;
  useEffect(() => setOpen(busy), [busy]);
  if (!items.length) return null;

  const done = items.filter((x) => x.status === 'done').length;
  const failed = items.filter((x) => x.status === 'failed').length;
  const total = items.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + x.size, 0);
  const sent = items.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + x.sent, 0);

  async function cancel(item) {
    const ok = await dialogs.confirm({
      title: 'Cancel upload',
      message: `Stop uploading “${item.name}” and delete the part already sent?`,
      confirmLabel: 'Cancel upload',
      cancelLabel: 'Keep uploading',
      danger: true,
    });
    if (ok) uploads.cancel(item.id);
  }

  return (
    <aside className="uploads-panel" aria-label="Uploads">
      <div className="uploads-head">
        <Upload size={15} />
        <strong>
          {active.length ? `Uploading · ${active.length} left` : `Uploads finished · ${done} done`}
        </strong>
        <span className="muted small">{percent(total ? sent / total : 0)}</span>
        {failed > 0 && <span className="badge failed">{failed} failed</span>}
        <span className="spacer" />
        {!active.length && (
          <button className="btn ghost small" onClick={uploads.clearFinished}>Clear</button>
        )}
        <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <ul className="uploads-list">
          {items.map((x) => {
            const bps = speed(x);
            return (
              <li key={x.id} className={x.status}>
                <div className="uploads-row">
                  <span className="file-name" title={`${x.name} → ${x.dir}`}>{x.name}</span>
                  {['waiting', 'uploading', 'failed'].includes(x.status) && (
                    <button className="icon-btn danger" title="Cancel this upload" aria-label={`Cancel ${x.name}`} onClick={() => cancel(x)}>
                      <X size={14} />
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(x.status) && (
                    <button className="icon-btn" title="Try again" aria-label={`Retry ${x.name}`} onClick={() => uploads.retry(x.id)}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
                <div className="progress">
                  <div className="bar" style={{ width: `${(x.size ? x.sent / x.size : 0) * 100}%` }} />
                </div>
                <div className="uploads-meta small">
                  {x.status === 'waiting' && <span className="muted">Waiting · {bytes(x.size)}</span>}
                  {x.status === 'uploading' && (
                    <span className="muted">
                      {bytes(x.sent)} of {bytes(x.size)}
                      {bps ? ` · ${bytes(bps)}/s · ${Math.ceil((x.size - x.sent) / bps / 60)} min left` : ''}
                    </span>
                  )}
                  {x.status === 'done' && <span className="text-good">Uploaded · {bytes(x.size)}</span>}
                  {x.status === 'cancelled' && <span className="muted">Cancelled</span>}
                  {x.error && <span className={x.status === 'failed' ? 'text-bad' : 'warn-text'}>{x.error}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
