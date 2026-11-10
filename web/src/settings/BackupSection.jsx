import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderSearch, Play, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { ago, bytes, clockTime } from '../format.js';
import { FolderPicker } from '../components/FolderPicker.jsx';
import { BackupPanel } from './BackupPanel.jsx';
import { Card, Check, Field, NumberInput, Switch } from './fields.jsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Settings → Backup and restore: the backup schedule (part of the settings form), then the backups themselves. */
export function BackupSection({ draft, set, base, run, onError, onNotice, backupStatus, dirty }) {
  const b = draft.backupSchedule;
  const setB = (k, v) => set('backupSchedule', { ...b, [k]: v });
  const [status, setStatus] = useState(null);
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => api.backupScheduled().then(setStatus, () => {}), []);
  useEffect(() => {
    load();
  }, [load, base.backupSchedule]);
  useEffect(() => {
    if (backupStatus) setStatus(backupStatus);
  }, [backupStatus]);

  async function runNow() {
    setRunning(true);
    const r = await run(() => api.runScheduledBackup(), (x) => `Backup saved: ${x.last.name}`);
    if (r) setStatus(r.status);
    else load();
    setRunning(false);
  }

  const last = status?.last;
  const saved = base.backupSchedule;

  return (
    <>
      <Card
        title="Scheduled backups"
        help="backup.schedule"
        aside={<Switch checked={b.enabled} onChange={(v) => setB('enabled', v)} label={b.enabled ? 'On' : 'Off'} />}
      >
        <p className="set-hint">
          Makes a backup by itself, e.g. every night into a folder on your NAS, and keeps the newest ones. If the server was off at
          that time, the backup is made as soon as it is back.
        </p>
        <fieldset className="set-fieldset" disabled={!b.enabled}>
          <div className="set-row">
            <Field label="How often">
              <select value={b.frequency} onChange={(e) => setB('frequency', e.target.value)}>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </Field>
            {b.frequency === 'weekly' && (
              <Field label="On">
                <select value={b.weekday} onChange={(e) => setB('weekday', Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
            )}
            <Field label="At">
              <input type="time" value={b.time} onChange={(e) => setB('time', e.target.value)} required />
            </Field>
            <Field label="Keep the newest">
              <NumberInput min="1" max="365" value={b.keep} onChange={(v) => setB('keep', v)} className="narrow" />
            </Field>
          </div>
          <Field
            label="Folder on the server"
            hint={
              <>
                Empty = the app’s own data folder (<code>data/backups</code>). A network share works if it is mounted on the server
                and, with Docker, inside the mounted media folder (e.g. <code>/mnt/multimedia-volume1/backups/handbrake-ui</code>).
              </>
            }
          >
            <div className="inline-form">
              <input value={b.folder} onChange={(e) => setB('folder', e.target.value)} placeholder="data/backups (default)" spellCheck={false} />
              <button type="button" className="btn small" onClick={() => setPicking(true)} title="Pick a folder under the sources or target folders; any other path can be typed">
                <FolderSearch size={14} /> Browse…
              </button>
            </div>
          </Field>
          <Check checked={b.logs} onChange={(v) => setB('logs', v)}>Include the conversion logs</Check>
        </fieldset>
        {picking && (
          <FolderPicker
            settings={draft}
            title="Choose the backup folder"
            kind="any"
            initial={b.folder || undefined}
            onError={onError}
            onClose={() => setPicking(false)}
            onPick={(p) => {
              setB('folder', p);
              setPicking(false);
            }}
          />
        )}

        {saved.enabled && status && (
          <div className="backup-status">
            {last ? (
              last.ok ? (
                <p className="ok-line"><CheckCircle2 size={14} className="text-good" /> Last backup {ago(last.at)}: {last.name} ({bytes(last.size)})</p>
              ) : (
                <p className="text-bad"><TriangleAlert size={14} /> Last backup {ago(last.at)} failed: {last.error}
                  {status.retryAt ? ` Trying again at ${clockTime(status.retryAt)}.` : ''}</p>
              )
            ) : status.backups[0] ? (
              <p className="ok-line"><CheckCircle2 size={14} className="text-good" /> Newest backup {ago(status.backups[0].createdAt)}</p>
            ) : null}
            <p className="set-hint">
              {status.nextAt ? `Next at ${clockTime(status.nextAt)}` : ''}
              {dirty ? ' · save your changes first' : ''}
            </p>
          </div>
        )}
        <div className="set-actions">
          <button type="button" className="btn small" onClick={runNow} disabled={!saved.enabled || running || status?.running || dirty}>
            <Play size={14} /> {running || status?.running ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </Card>

      <BackupPanel run={run} onError={onError} onNotice={onNotice} scheduled={status} onScheduledChange={load} />
    </>
  );
}
