// Scheduled backups: a backup ZIP every day or week, into a chosen folder (which can be
// a network share mounted on the server), keeping the newest N.
//
// No state is stored: the newest "scheduled-*.zip" in the folder says whether the most
// recent due time has been covered. So a backup missed while the server was off is made
// once when it comes back, and changing the folder starts a fresh series there.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { badRequest } from './errors.js';
import { minutesOf } from './schedule.js';

export const DEFAULT_BACKUP_SCHEDULE = {
  enabled: false,
  frequency: 'daily', // daily | weekly
  time: '03:00',
  weekday: 0, // for weekly: 0 = Sunday … 6 = Saturday
  folder: '', // empty = the app's own data/backups folder
  keep: 14,
  logs: true,
};

const CHECK_MS = 60_000;
// After a failure (e.g. the share is not mounted), wait this long before trying again.
const RETRY_MS = 30 * 60_000;

/** Validates the settings; an enabled schedule needs a folder that exists and can be written. */
export async function normalizeBackupSchedule(v) {
  const b = { ...DEFAULT_BACKUP_SCHEDULE, ...(v ?? {}) };
  for (const k of ['enabled', 'logs']) if (typeof b[k] !== 'boolean') throw badRequest(`backupSchedule.${k} must be true or false`);
  if (!['daily', 'weekly'].includes(b.frequency)) throw badRequest('Backups run daily or weekly');
  if (minutesOf(b.time) == null) throw badRequest('The backup time must look like 03:00');
  const weekday = Number(b.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('The backup day must be 0–6');
  const keep = Number(b.keep);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw badRequest('Keep between 1 and 365 backups');
  const raw = String(b.folder ?? '').trim();
  if (raw && !path.isAbsolute(raw)) throw badRequest(`The backup folder must be an absolute path on the server: ${raw}`);
  const folder = raw ? path.resolve(raw) : '';
  if (b.enabled && folder) {
    const st = await fs.stat(folder).catch(() => null);
    if (!st?.isDirectory()) throw badRequest(`The backup folder does not exist on the server (is the share mounted?): ${folder}`);
    await fs.access(folder, constants.W_OK).catch(() => {
      throw badRequest(`The app cannot write to the backup folder: ${folder}`);
    });
  }
  return { enabled: b.enabled, frequency: b.frequency, time: b.time, weekday, folder, keep, logs: b.logs };
}

/** The most recent time a backup was due, at or before `now`. */
export function lastDue(cfg, now = new Date()) {
  const m = minutesOf(cfg.time);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(m / 60), m % 60);
  if (cfg.frequency === 'weekly') {
    let back = (at.getDay() - cfg.weekday + 7) % 7;
    if (back === 0 && at > now) back = 7;
    at.setDate(at.getDate() - back);
  } else if (at > now) {
    at.setDate(at.getDate() - 1);
  }
  return at;
}

/** The next due time after the most recent one. */
export function nextDue(cfg, now = new Date()) {
  const d = lastDue(cfg, now);
  d.setDate(d.getDate() + (cfg.frequency === 'weekly' ? 7 : 1));
  return d;
}

export class BackupScheduler {
  constructor({ settings, backups, notifier, events, log, now = () => new Date() }) {
    Object.assign(this, { settings, backups, notifier, events, log, now });
    this.timer = null;
    this.running = null;
    this.newest = undefined; // createdAt of the newest scheduled backup in the folder (undefined = not read yet)
    this.last = null; // { at, ok, error, name, size, folder }
    this.failedAt = 0;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick().catch((err) => this.log?.error(err, 'Scheduled backup check failed')), CHECK_MS);
    this.timer.unref?.();
    return this.reconfigure();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** The settings changed (or the app started): look at the folder again, then check. */
  async reconfigure() {
    this.newest = undefined;
    this.failedAt = 0;
    await this.tick();
    this.emit();
  }

  async refreshNewest() {
    const list = await this.backups.listScheduled();
    this.newest = list[0]?.createdAt ?? null;
  }

  /** Makes the backup when the most recent due time has no backup yet. */
  async tick() {
    const cfg = this.settings.get('backupSchedule');
    if (!cfg?.enabled || this.running) return null;
    const now = this.now();
    if (this.failedAt && now.getTime() - this.failedAt < RETRY_MS) return null;
    if (this.newest === undefined) await this.refreshNewest();
    if (this.newest != null && this.newest >= lastDue(cfg, now).getTime()) return null;
    return this.run();
  }

  /** Makes a scheduled backup now (also "Back up now" in Settings). */
  run() {
    this.running ??= this.doRun().finally(() => {
      this.running = null;
      this.emit();
    });
    return this.running;
  }

  async doRun() {
    const cfg = this.settings.get('backupSchedule');
    const folder = this.backups.scheduledDir();
    this.emit({ running: true });
    try {
      if (cfg.folder) {
        const st = await fs.stat(cfg.folder).catch(() => null);
        if (!st?.isDirectory()) throw new Error(`The backup folder is not there (is the share mounted?): ${cfg.folder}`);
      }
      const r = await this.backups.saveSnapshot({ logs: cfg.logs, reason: 'scheduled', dir: folder });
      await this.backups.pruneScheduled(cfg.keep);
      this.newest = Date.now();
      this.failedAt = 0;
      this.last = { at: Date.now(), ok: true, error: null, name: r.name, size: r.size, folder };
      this.log?.info(`Scheduled backup saved: ${path.join(folder, r.name)}`);
    } catch (err) {
      this.failedAt = this.now().getTime();
      this.last = { at: Date.now(), ok: false, error: err.message, name: null, size: null, folder };
      this.log?.warn(`Scheduled backup failed: ${err.message}`);
      this.notifier?.notify('backupFailed', { folder, error: err.message });
    }
    return this.last;
  }

  async status() {
    const cfg = this.settings.get('backupSchedule');
    const backups = await this.backups.listScheduled().catch(() => []);
    return {
      enabled: !!cfg?.enabled,
      folder: this.backups.scheduledDir(),
      running: !!this.running,
      nextAt: cfg?.enabled ? nextDue(cfg, this.now()).getTime() : null,
      last: this.last,
      retryAt: this.failedAt ? this.failedAt + RETRY_MS : null,
      backups,
    };
  }

  emit(extra) {
    if (!this.events) return;
    this.status().then((s) => this.events.emit('backupSchedule', { ...s, ...extra }), () => {});
  }
}
