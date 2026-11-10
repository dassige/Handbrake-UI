import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Download, HardDriveDownload, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime } from '../format.js';
import { useDialogs } from '../components/Dialogs.jsx';
import { startDownload } from '../download/useDownload.jsx';
import { Card } from './fields.jsx';

const COUNTS = [
  { key: 'presets', label: 'Presets', config: true },
  { key: 'renameRules', label: 'Your rename rule sets', config: true },
  { key: 'jobs', label: 'Jobs (queue and history)' },
  { key: 'renameHistory', label: 'Rename history' },
  { key: 'merges', label: 'Merges' },
  { key: 'qualityScans', label: 'Quality check results' },
];

/** Downloads or keeps backups of the settings and database, and restores them (Settings → Backup and restore). */
export function BackupPanel({ run, onError, onNotice }) {
  const dialogs = useDialogs();
  const [logs, setLogs] = useState(true);
  const [snapshots, setSnapshots] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [scope, setScope] = useState('config');
  const [busy, setBusy] = useState(null); // text while working
  const fileInput = useRef(null);

  const loadSnapshots = useCallback(() => api.backupSnapshots().then(setSnapshots, (e) => onError(e)), [onError]);
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  async function work(text, fn) {
    setBusy(text);
    try {
      return await fn();
    } catch (e) {
      onError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function saveOnServer() {
    const r = await work('Saving…', () => api.saveBackupSnapshot(logs));
    if (r) {
      onNotice(`Backup saved on the server: ${r.name}`);
      loadSnapshots();
    }
  }

  async function inspectFile(file) {
    const r = await work('Reading the backup…', () => api.inspectBackupFile(file));
    if (r) {
      setInspection({ ...r, label: file.name });
      setScope('config');
    }
  }

  async function inspectSnapshot(s) {
    const r = await work('Reading the backup…', () => api.inspectBackupSnapshot(s.name));
    if (r) {
      setInspection({ ...r, label: s.name });
      setScope('config');
    }
  }

  async function removeSnapshot(s) {
    const ok = await dialogs.confirm({
      title: 'Delete backup',
      message: `Delete the backup ${s.name} from the server?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.deleteBackupSnapshot(s.name)))) loadSnapshots();
  }

  async function restore() {
    const all = scope === 'all';
    const ok = await dialogs.choose({
      title: 'Restore this backup?',
      icon: 'warn',
      cancelValue: false,
      message: (
        <>
          <p>
            {all
              ? 'Everything will be replaced with the backup: settings, presets, rename rules, jobs and their logs, rename history, merges and quality results.'
              : 'Settings, presets and rename rules will be replaced with the backup. Jobs and history stay as they are.'}
          </p>
          <p className="muted small">The current data is saved on the server first, so you can go back to it from Settings → Backup and restore.</p>
        </>
      ),
      buttons: [
        { label: 'Cancel', value: false, autoFocus: true },
        { label: all ? 'Restore everything' : 'Restore configuration', value: true, danger: true },
      ],
    });
    if (!ok) return;
    const r = await work('Restoring…', () => api.restoreBackup(inspection.source, scope));
    if (!r) return;
    await dialogs.alert({
      title: 'Restored',
      message: (
        <>
          <p>{r.scope === 'all' ? 'Everything was restored' : 'The configuration was restored'} from {inspection.label}.</p>
          <p className="muted small">The data from before is saved on the server as {r.savedAs}. The page reloads now.</p>
        </>
      ),
    });
    location.reload();
  }

  const m = inspection?.manifest;
  const v = m?.versions?.app?.version;

  return (
    <>
      <Card title="Make a backup" help="backup.overview" aside={busy && <span className="muted small">{busy}</span>}>
        <p className="set-hint">
          Settings, presets, rename rules, the job list and history, merges and quality results. Video files are not included.
        </p>
        <label className="check">
          <input type="checkbox" checked={logs} onChange={(e) => setLogs(e.target.checked)} />
          Include the conversion logs
        </label>
        <div className="backup-actions">
          <button className="btn primary" disabled={!!busy} onClick={() => startDownload(api.backupUrl(logs))}>
            <HardDriveDownload size={15} /> Download backup
          </button>
          <button className="btn" disabled={!!busy} onClick={saveOnServer}>
            <Save size={15} /> Save on the server
          </button>
        </div>
      </Card>

      <Card title="Restore">
        <div className="backup-actions">
          <button className="btn" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> Choose a backup file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files[0];
              e.target.value = '';
              if (f) inspectFile(f);
            }}
          />
          <span className="muted small">or pick one of the backups on the server below.</span>
        </div>

        {inspection && (
          <div className="backup-inspect">
            <p>
              <strong>{inspection.label}</strong>
              <span className="muted small">
                {' '}· made {dateTime(m?.createdAt)}{v ? ` by version ${v}` : ''}
                {inspection.logs ? ` · ${inspection.logs} log${inspection.logs === 1 ? '' : 's'}` : ' · no logs'}
              </span>
            </p>
            <table className="backup-counts small">
              <thead>
                <tr><th /><th>In the backup</th><th>Now</th></tr>
              </thead>
              <tbody>
                {COUNTS.map((c) => (
                  <tr key={c.key} className={!c.config && scope === 'config' ? 'off' : ''}>
                    <td>{c.label}</td>
                    <td>{inspection.counts[c.key]}</td>
                    <td>{inspection.current[c.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inspection.warnings.map((w) => <p key={w} className="warn-text">{w}</p>)}
            <div className="backup-scope">
              <label className="radio">
                <input type="radio" name="scope" checked={scope === 'config'} onChange={() => setScope('config')} />
                <span>
                  Configuration only
                  <span className="muted small">Settings, presets and rename rules. Jobs and history stay as they are.</span>
                </span>
              </label>
              <label className="radio">
                <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} disabled={!!inspection.busy} />
                <span>
                  Everything
                  <span className="muted small">
                    {inspection.busy ? `Not possible while ${inspection.busy}.` : 'Also jobs, their logs, rename history, merges and quality results. The queue stays stopped.'}
                  </span>
                </span>
              </label>
            </div>
            <div className="backup-actions">
              <button className="btn primary danger-solid" disabled={!!busy} onClick={restore}>
                <ArchiveRestore size={15} /> Restore…
              </button>
              <button className="btn ghost" onClick={() => setInspection(null)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Backups on the server">
        {snapshots?.length === 0 && <p className="set-hint">None yet. “Save on the server” and every restore add one here.</p>}
        {snapshots?.length > 0 && (
          <ul className="backup-list">
            {snapshots.map((s) => (
              <li key={s.name}>
                {s.reason === 'before-restore' ? <RotateCcw size={15} className="muted" /> : <Save size={15} className="muted" />}
                <span className="file-name" title={s.name}>
                  {s.reason === 'before-restore' ? 'Before a restore' : 'Saved by hand'} · {dateTime(s.createdAt)}
                </span>
                <span className="muted small">{bytes(s.size)}</span>
                <button className="icon-btn" title="Restore from this backup" aria-label={`Restore ${s.name}`} disabled={!!busy} onClick={() => inspectSnapshot(s)}>
                  <ArchiveRestore size={15} />
                </button>
                <button className="icon-btn" title="Download" aria-label={`Download ${s.name}`} onClick={() => startDownload(api.backupSnapshotUrl(s.name))}>
                  <Download size={15} />
                </button>
                <button className="icon-btn danger" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => removeSnapshot(s)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
