import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderSearch, Play, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { ago, bytes, clockTime } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { FolderPicker } from '../components/FolderPicker.jsx';
import { BackupPanel } from './BackupPanel.jsx';
import { Card, Check, Field, NumberInput, Switch } from './fields.jsx';

// Indexed by Date.getDay() (Sunday = 0); names: settings.backup.weekday.<id>.
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
    const r = await run(() => api.runScheduledBackup(), (x) => t('settings.backup.savedToast', { name: x.last.name }));
    if (r) setStatus(r.status);
    else load();
    setRunning(false);
  }

  const last = status?.last;
  const saved = base.backupSchedule;

  return (
    <>
      <Card
        title={t('settings.backup.scheduleTitle')}
        help="backup.schedule"
        aside={<Switch checked={b.enabled} onChange={(v) => setB('enabled', v)} label={b.enabled ? t('common.on') : t('common.off')} />}
      >
        <p className="set-hint">{t('settings.backup.scheduleHint')}</p>
        <fieldset className="set-fieldset" disabled={!b.enabled}>
          <div className="set-row">
            <Field label={t('settings.backup.howOften')}>
              <select value={b.frequency} onChange={(e) => setB('frequency', e.target.value)}>
                <option value="daily">{t('settings.backup.daily')}</option>
                <option value="weekly">{t('settings.backup.weekly')}</option>
              </select>
            </Field>
            {b.frequency === 'weekly' && (
              <Field label={t('settings.backup.on')}>
                <select value={b.weekday} onChange={(e) => setB('weekday', Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{t(`settings.backup.weekday.${d}`)}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('settings.backup.at')}>
              <input type="time" value={b.time} onChange={(e) => setB('time', e.target.value)} required />
            </Field>
            <Field label={t('settings.backup.keep')}>
              <NumberInput min="1" max="365" value={b.keep} onChange={(v) => setB('keep', v)} className="narrow" />
            </Field>
          </div>
          <Field label={t('settings.backup.folder')} hint={rich('settings.backup.folderHint')}>
            <div className="inline-form">
              <input value={b.folder} onChange={(e) => setB('folder', e.target.value)} placeholder={t('settings.backup.folderPlaceholder')} spellCheck={false} />
              <button type="button" className="btn small" onClick={() => setPicking(true)} title={t('settings.backup.browseTitle')}>
                <FolderSearch size={14} /> {t('settings.browse')}
              </button>
            </div>
          </Field>
          <Check checked={b.logs} onChange={(v) => setB('logs', v)}>{t('settings.backup.includeLogs')}</Check>
        </fieldset>
        {picking && (
          <FolderPicker
            settings={draft}
            title={t('settings.backup.pickTitle')}
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
                <p className="ok-line">
                  <CheckCircle2 size={14} className="text-good" />{' '}
                  {t('settings.backup.lastOk', { ago: ago(last.at), name: last.name, size: bytes(last.size) })}
                </p>
              ) : (
                <p className="text-bad">
                  <TriangleAlert size={14} /> {t('settings.backup.lastFailed', { ago: ago(last.at), error: last.error })}
                  {status.retryAt ? ` ${t('settings.backup.retryAt', { time: clockTime(status.retryAt) })}` : ''}
                </p>
              )
            ) : status.backups[0] ? (
              <p className="ok-line">
                <CheckCircle2 size={14} className="text-good" /> {t('settings.backup.newest', { ago: ago(status.backups[0].createdAt) })}
              </p>
            ) : null}
            <p className="set-hint">
              {status.nextAt ? t('settings.backup.nextAt', { time: clockTime(status.nextAt) }) : ''}
              {dirty ? ` · ${t('settings.saveFirst')}` : ''}
            </p>
          </div>
        )}
        <div className="set-actions">
          <button type="button" className="btn small" onClick={runNow} disabled={!saved.enabled || running || status?.running || dirty}>
            <Play size={14} /> {running || status?.running ? t('settings.backup.backingUp') : t('settings.backup.backUpNow')}
          </button>
        </div>
      </Card>

      <BackupPanel run={run} onError={onError} onNotice={onNotice} scheduled={status} onScheduledChange={load} />
    </>
  );
}
