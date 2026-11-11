import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveRestore, CalendarClock, Download, HardDriveDownload, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { backupBusy, backupWarnings } from '../i18n/serverText.js';
import { useDialogs } from '../components/Dialogs.jsx';
import { startDownload } from '../download/useDownload.jsx';
import { Card } from './fields.jsx';

const COUNTS = [
  { key: 'presets', labelKey: 'settings.backup.counts.presets', config: true },
  { key: 'renameRules', labelKey: 'settings.backup.counts.renameRules', config: true },
  { key: 'jobs', labelKey: 'settings.backup.counts.jobs' },
  { key: 'renameHistory', labelKey: 'settings.backup.counts.renameHistory' },
  { key: 'merges', labelKey: 'settings.backup.counts.merges' },
  { key: 'qualityScans', labelKey: 'settings.backup.counts.qualityScans' },
];

/** Downloads or keeps backups of the settings and database, and restores them (Settings → Backup and restore). */
export function BackupPanel({ run, onError, onNotice, scheduled, onScheduledChange }) {
  const dialogs = useDialogs();
  const [logs, setLogs] = useState(true);
  const [snapshots, setSnapshots] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [scope, setScope] = useState('config');
  const [busy, setBusy] = useState(null); // key of the text shown while working
  const fileInput = useRef(null);

  // Scheduled backups have their own list (they may be in another folder).
  const loadSnapshots = useCallback(
    () => api.backupSnapshots().then((l) => setSnapshots(l.filter((s) => s.reason !== 'scheduled')), (e) => onError(e)),
    [onError],
  );
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  async function work(textKey, fn) {
    setBusy(textKey);
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
    const r = await work('common.saving', () => api.saveBackupSnapshot(logs));
    if (r) {
      onNotice(t('settings.backup.savedOnServer', { name: r.name }));
      loadSnapshots();
    }
  }

  async function inspectFile(file) {
    const r = await work('settings.backup.reading', () => api.inspectBackupFile(file));
    if (r) {
      setInspection({ ...r, label: file.name });
      setScope('config');
    }
  }

  async function inspectSnapshot(s) {
    const r = await work('settings.backup.reading', () =>
      s.reason === 'scheduled' ? api.inspectScheduledBackup(s.name) : api.inspectBackupSnapshot(s.name));
    if (r) {
      setInspection({ ...r, label: s.name });
      setScope('config');
    }
  }

  async function removeSnapshot(s) {
    const ok = await dialogs.confirm({
      title: t('settings.backup.deleteTitle'),
      message: t('settings.backup.deleteConfirm', { name: s.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await run(() => api.deleteBackupSnapshot(s.name)))) loadSnapshots();
  }

  async function removeScheduled(s) {
    const ok = await dialogs.confirm({
      title: t('settings.backup.deleteTitle'),
      message: t('settings.backup.deleteScheduledConfirm', { name: s.name, folder: scheduled?.folder }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await run(() => api.deleteScheduledBackup(s.name)))) onScheduledChange?.();
  }

  async function restore() {
    const all = scope === 'all';
    const ok = await dialogs.choose({
      title: t('settings.backup.restoreConfirmTitle'),
      icon: 'warn',
      cancelValue: false,
      message: (
        <>
          <p>{all ? t('settings.backup.restoreAllMessage') : t('settings.backup.restoreConfigMessage')}</p>
          <p className="muted small">{t('settings.backup.restoreSavedFirst')}</p>
        </>
      ),
      buttons: [
        { label: t('common.cancel'), value: false, autoFocus: true },
        { label: all ? t('settings.backup.restoreAllButton') : t('settings.backup.restoreConfigButton'), value: true, danger: true },
      ],
    });
    if (!ok) return;
    const r = await work('settings.backup.restoring', () => api.restoreBackup(inspection.source, scope));
    if (!r) return;
    await dialogs.alert({
      title: t('settings.backup.restoredTitle'),
      message: (
        <>
          <p>
            {r.scope === 'all'
              ? t('settings.backup.restoredAll', { name: inspection.label })
              : t('settings.backup.restoredConfig', { name: inspection.label })}
          </p>
          <p className="muted small">{t('settings.backup.restoredSavedAs', { name: r.savedAs })}</p>
        </>
      ),
    });
    location.reload();
  }

  const m = inspection?.manifest;
  const v = m?.versions?.app?.version;

  return (
    <>
      <Card title={t('settings.backup.makeTitle')} help="backup.overview" aside={busy && <span className="muted small">{t(busy)}</span>}>
        <p className="set-hint">{t('settings.backup.makeHint')}</p>
        <label className="check">
          <input type="checkbox" checked={logs} onChange={(e) => setLogs(e.target.checked)} />
          {t('settings.backup.includeLogs')}
        </label>
        <div className="backup-actions">
          <button className="btn primary" disabled={!!busy} onClick={() => startDownload(api.backupUrl(logs))}>
            <HardDriveDownload size={15} /> {t('settings.backup.download')}
          </button>
          <button className="btn" disabled={!!busy} onClick={saveOnServer}>
            <Save size={15} /> {t('settings.backup.saveOnServer')}
          </button>
        </div>
      </Card>

      <Card title={t('settings.backup.restoreTitle')}>
        <div className="backup-actions">
          <button className="btn" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> {t('settings.backup.chooseFile')}
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
          <span className="muted small">{t('settings.backup.orPick')}</span>
        </div>

        {inspection && (
          <div className="backup-inspect">
            <p>
              <strong>{inspection.label}</strong>
              <span className="muted small">
                {' · '}
                {v
                  ? t('settings.backup.madeBy', { date: dateTime(m?.createdAt), version: v })
                  : t('settings.backup.made', { date: dateTime(m?.createdAt) })}
                {' · '}
                {inspection.logs ? t('settings.backup.logs', { count: inspection.logs }) : t('settings.backup.noLogs')}
              </span>
            </p>
            <table className="backup-counts small">
              <thead>
                <tr><th /><th>{t('settings.backup.inBackup')}</th><th>{t('settings.backup.now')}</th></tr>
              </thead>
              <tbody>
                {COUNTS.map((c) => (
                  <tr key={c.key} className={!c.config && scope === 'config' ? 'off' : ''}>
                    <td>{t(c.labelKey)}</td>
                    <td>{inspection.counts[c.key]}</td>
                    <td>{inspection.current[c.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {backupWarnings(inspection).map((w) => <p key={w} className="warn-text">{w}</p>)}
            <div className="backup-scope">
              <label className="radio">
                <input type="radio" name="scope" checked={scope === 'config'} onChange={() => setScope('config')} />
                <span>
                  {t('settings.backup.configOnly')}
                  <span className="muted small">{t('settings.backup.configOnlyHint')}</span>
                </span>
              </label>
              <label className="radio">
                <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} disabled={!!inspection.busy} />
                <span>
                  {t('settings.backup.everything')}
                  <span className="muted small">
                    {inspection.busy ? t('settings.backup.notPossible', { reason: backupBusy(inspection) }) : t('settings.backup.everythingHint')}
                  </span>
                </span>
              </label>
            </div>
            <div className="backup-actions">
              <button className="btn primary danger-solid" disabled={!!busy} onClick={restore}>
                <ArchiveRestore size={15} /> {t('settings.backup.restoreButton')}
              </button>
              <button className="btn ghost" onClick={() => setInspection(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title={t('settings.backup.onServerTitle')}>
        {snapshots?.length === 0 && <p className="set-hint">{t('settings.backup.noneOnServer')}</p>}
        {snapshots?.length > 0 && (
          <ul className="backup-list">
            {snapshots.map((s) => (
              <li key={s.name}>
                {s.reason === 'before-restore' ? <RotateCcw size={15} className="muted" /> : <Save size={15} className="muted" />}
                <span className="file-name" title={s.name}>
                  {s.reason === 'before-restore' ? t('settings.backup.beforeRestore') : t('settings.backup.byHand')} · {dateTime(s.createdAt)}
                </span>
                <span className="muted small">{bytes(s.size)}</span>
                <SnapshotButtons
                  name={s.name}
                  busy={busy}
                  onRestore={() => inspectSnapshot(s)}
                  onDownload={() => startDownload(api.backupSnapshotUrl(s.name))}
                  onDelete={() => removeSnapshot(s)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {scheduled && (scheduled.enabled || scheduled.backups.length > 0) && (
        <Card title={t('settings.backup.keptTitle')}>
          <p className="set-hint">
            {rich('settings.backup.inFolder', { folder: <code>{scheduled.folder}</code> })}
            {scheduled.backups.length ? ` · ${t('settings.backup.kept', { count: scheduled.backups.length })}` : ''}
          </p>
          {scheduled.backups.length === 0 ? (
            <p className="set-hint">{t('settings.backup.noneYet')}</p>
          ) : (
            <ul className="backup-list">
              {scheduled.backups.map((s) => (
                <li key={s.name}>
                  <CalendarClock size={15} className="muted" />
                  <span className="file-name" title={s.name}>{t('settings.backup.scheduled')} · {dateTime(s.createdAt)}</span>
                  <span className="muted small">{bytes(s.size)}</span>
                  <SnapshotButtons
                    name={s.name}
                    busy={busy}
                    onRestore={() => inspectSnapshot(s)}
                    onDownload={() => startDownload(api.scheduledBackupUrl(s.name))}
                    onDelete={() => removeScheduled(s)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

/** Restore / download / delete buttons of one backup in a list. */
function SnapshotButtons({ name, busy, onRestore, onDownload, onDelete }) {
  return (
    <>
      <button className="icon-btn" title={t('settings.backup.restoreFrom')} aria-label={t('settings.backup.restoreNamed', { name })} disabled={!!busy} onClick={onRestore}>
        <ArchiveRestore size={15} />
      </button>
      <button className="icon-btn" title={t('common.download')} aria-label={t('settings.backup.downloadNamed', { name })} onClick={onDownload}>
        <Download size={15} />
      </button>
      <button className="icon-btn danger" title={t('common.delete')} aria-label={t('settings.backup.deleteNamed', { name })} onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </>
  );
}
