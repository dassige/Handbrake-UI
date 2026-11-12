// Backup and restore of the configuration and the database.
//
// A backup is a ZIP: manifest.json, encforge.db (a consistent copy made with
// VACUUM INTO, safe while the app runs) and, optionally, logs/ (the HandBrake log
// of each job). It can be downloaded or kept on the server in DATA_DIR/backups.
//
// A restore copies tables from the backup into the live database (ATTACH + one
// transaction), so the app does not need a restart:
// - scope "config": settings, presets and rename rules; jobs and history stay.
// - scope "all": everything, plus the job logs. Refused while something runs.
// Before every restore the current data is saved on the server, so it can be undone.
// Scheduled backups (backupSchedule.js) go to a chosen folder, possibly a network share.
// Backups made before the rename to EncForge (app "handbrake-ui", handbrake-ui.db) still restore.
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { tx } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import { attachment, planZip, zipStream } from './download.js';
import { ZipError, extractEntry, readZipEntries } from './zipReader.js';

export const FORMAT = 1;
export const CONFIG_TABLES = ['settings', 'presets', 'rename_rules'];
export const ALL_TABLES = [...CONFIG_TABLES, 'jobs', 'rename_history', 'merges', 'quality_scans', 'naming_checks', 'job_history', 'watch_seen', 'watch_folders'];
const KEEP_SNAPSHOTS = 10;
const MAX_UPLOAD = 1024 * 1024 * 1024;
const SNAPSHOT_NAME = /^[\w.-]+\.zip$/;
const LOG_NAME = /^logs\/[\w.-]+\.log$/;
const APP = 'encforge';
const DB_NAME = 'encforge.db';
// What backups made before the rename to EncForge used instead.
const LEGACY_APP = 'handbrake-ui';
const LEGACY_DB_NAME = 'handbrake-ui.db';

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** What a database holds, for the restore summary. */
export function countRows(db, schema = 'main') {
  const has = (t) => !!db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`).get(t);
  const n = (sql, t) => (has(t) ? db.prepare(sql).get().n : 0);
  return {
    presets: n(`SELECT COUNT(*) AS n FROM ${schema}.presets`, 'presets'),
    renameRules: n(`SELECT COUNT(*) AS n FROM ${schema}.rename_rules WHERE builtin = 0`, 'rename_rules'),
    jobs: n(`SELECT COUNT(*) AS n FROM ${schema}.jobs`, 'jobs'),
    renameHistory: n(`SELECT COUNT(*) AS n FROM ${schema}.rename_history`, 'rename_history'),
    merges: n(`SELECT COUNT(*) AS n FROM ${schema}.merges`, 'merges'),
    qualityScans: n(`SELECT COUNT(*) AS n FROM ${schema}.quality_scans`, 'quality_scans'),
    namingChecks: n(`SELECT COUNT(*) AS n FROM ${schema}.naming_checks`, 'naming_checks'),
  };
}

const columns = (db, schema, table) => db.prepare(`PRAGMA ${schema}.table_info(${table})`).all().map((c) => c.name);

export class Backups {
  constructor({ db, dataDir, settings, queue, merger, quality, naming = null, uploads, renamer, watcher, events, log, versions }) {
    Object.assign(this, { db, settings, queue, merger, quality, naming, uploads, renamer, watcher, events, log, versions });
    this.dir = path.join(dataDir, 'backups');
    this.logDir = path.join(dataDir, 'logs');
    this.tmpDir = path.join(dataDir, 'tmp');
    this.restoring = false;
  }

  // ---------------------------------------------------------------- making backups

  /** Copies the database and lists the files of a backup in a temporary folder. */
  async build({ logs = true } = {}) {
    const work = path.join(this.tmpDir, `backup-${randomUUID()}`);
    await fs.mkdir(work, { recursive: true });
    const dbFile = path.join(work, DB_NAME);
    this.db.prepare('VACUUM INTO ?').run(dbFile);
    const logFiles = logs
      ? (await fs.readdir(this.logDir).catch(() => [])).filter((f) => /^[\w.-]+\.log$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : [];
    const manifest = {
      app: APP,
      format: FORMAT,
      createdAt: Date.now(),
      versions: this.versions,
      logs: logs ? logFiles.length : null,
      counts: countRows(this.db),
    };
    const manifestFile = path.join(work, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    const entry = async (file, name) => {
      const st = await fs.stat(file);
      return { path: file, name, size: st.size, mtime: st.mtimeMs };
    };
    const entries = [await entry(manifestFile, 'manifest.json'), await entry(dbFile, DB_NAME)];
    for (const f of logFiles) {
      const e = await entry(path.join(this.logDir, f), `logs/${f}`).catch(() => null); // a log may vanish meanwhile
      if (e) entries.push(e);
    }
    return { work, plan: planZip(entries), manifest };
  }

  /** GET /api/backup: streams a fresh backup to the browser. */
  async send(req, reply) {
    const { work, plan } = await this.build({ logs: req.query.logs !== '0' });
    reply.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(`encforge-backup-${stamp()}.zip`),
      'Content-Length': plan.size,
      'Cache-Control': 'no-store',
    });
    const stream = zipStream(plan);
    stream.on('close', () => fs.rm(work, { recursive: true, force: true }).catch(() => {}));
    return reply.send(stream);
  }

  /**
   * Keeps a backup on the server; reason goes into the file name (manual, before-restore, scheduled).
   * dir: another folder (scheduled backups). The file is written as a hidden .part and renamed
   * when complete, so a half-written backup never shows up (e.g. on a network share).
   */
  async saveSnapshot({ logs = true, reason = 'manual', dir = this.dir } = {}) {
    await fs.mkdir(dir, { recursive: true });
    const { work, plan } = await this.build({ logs });
    const name = `${reason}-${stamp()}.zip`;
    const part = path.join(dir, `.${name}.part`);
    try {
      await pipeline(zipStream(plan), createWriteStream(part));
      await fs.rename(part, path.join(dir, name));
    } catch (err) {
      await fs.rm(part, { force: true }).catch(() => {});
      throw err;
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
    if (dir === this.dir) await this.prune();
    return { name, size: plan.size, dir };
  }

  async listSnapshots(dir = this.dir) {
    const names = (await fs.readdir(dir).catch(() => [])).filter((n) => SNAPSHOT_NAME.test(n));
    const out = await Promise.all(
      names.map(async (name) => {
        const st = await fs.stat(path.join(dir, name)).catch(() => null);
        const reason = name.startsWith('before-restore') ? 'before-restore' : name.startsWith('scheduled-') ? 'scheduled' : 'manual';
        return st && { name, size: st.size, createdAt: st.mtimeMs, reason };
      }),
    );
    return out.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The folder scheduled backups go to: the chosen one, or DATA_DIR/backups. */
  scheduledDir() {
    return this.settings.get('backupSchedule')?.folder || this.dir;
  }

  async listScheduled() {
    return (await this.listSnapshots(this.scheduledDir())).filter((s) => s.reason === 'scheduled');
  }

  scheduledPath(name) {
    if (typeof name !== 'string' || !/^scheduled-[\w.-]+\.zip$/.test(name)) throw badRequest('Invalid backup name');
    return path.join(this.scheduledDir(), name);
  }

  async sendScheduled(name, reply) {
    const file = this.scheduledPath(name);
    const st = await fs.stat(file).catch(() => null);
    if (!st) throw notFound(`Backup ${name} not found`);
    reply.headers({ 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Content-Length': st.size });
    return reply.send(createReadStream(file));
  }

  async deleteScheduled(name) {
    await fs.rm(this.scheduledPath(name), { force: true });
    return { ok: true };
  }

  /** Keeps the newest `keep` scheduled backups in their folder; other files there are not touched. */
  async pruneScheduled(keep) {
    const dir = this.scheduledDir();
    for (const s of (await this.listScheduled()).slice(keep)) await fs.rm(path.join(dir, s.name), { force: true });
  }

  snapshotPath(name) {
    if (typeof name !== 'string' || !SNAPSHOT_NAME.test(name)) throw badRequest('Invalid backup name');
    return path.join(this.dir, name);
  }

  async sendSnapshot(name, reply) {
    const file = this.snapshotPath(name);
    const st = await fs.stat(file).catch(() => null);
    if (!st) throw notFound(`Backup ${name} not found`);
    reply.headers({ 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Content-Length': st.size });
    return reply.send(createReadStream(file));
  }

  async deleteSnapshot(name) {
    await fs.rm(this.snapshotPath(name), { force: true });
    return { ok: true };
  }

  /** Keeps the newest snapshots of each kind. */
  async prune() {
    const list = await this.listSnapshots();
    for (const reason of ['manual', 'before-restore']) {
      for (const s of list.filter((x) => x.reason === reason).slice(KEEP_SNAPSHOTS)) {
        await fs.rm(path.join(this.dir, s.name), { force: true });
      }
    }
  }

  // ---------------------------------------------------------------- reading backups

  /** Saves an uploaded backup in the temporary folder; returns its source id. */
  async receive(stream) {
    await fs.mkdir(this.tmpDir, { recursive: true });
    const id = randomUUID();
    const file = path.join(this.tmpDir, `restore-${id}.zip`);
    let n = 0;
    const limit = new Transform({
      transform(buf, enc, cb) {
        n += buf.length;
        cb(n > MAX_UPLOAD ? badRequest('The file is too large to be a backup') : null, buf);
      },
    });
    try {
      await pipeline(stream, limit, createWriteStream(file));
    } catch (err) {
      await fs.rm(file, { force: true });
      throw err;
    }
    // Uploaded files that are never restored are removed after a day.
    setTimeout(() => fs.rm(file, { force: true }).catch(() => {}), 24 * 3600 * 1000).unref();
    return `upload:${id}`;
  }

  sourcePath(source) {
    const m = /^(upload|snapshot|scheduled):(.+)$/.exec(String(source ?? ''));
    if (!m) throw badRequest('Invalid backup source');
    if (m[1] === 'snapshot') return this.snapshotPath(m[2]);
    if (m[1] === 'scheduled') return this.scheduledPath(m[2]);
    if (!/^[0-9a-f-]{36}$/.test(m[2])) throw badRequest('Invalid backup source');
    return path.join(this.tmpDir, `restore-${m[2]}.zip`);
  }

  /** Unpacks a backup into a new temporary folder and checks it. Returns { work, manifest, dbFile, logs }. */
  async unpack(source) {
    const file = this.sourcePath(source);
    if (!(await fs.stat(file).catch(() => null))) throw notFound('The backup file is gone; choose it again');
    let entries;
    try {
      entries = await readZipEntries(file);
    } catch (err) {
      throw badRequest(err instanceof ZipError ? `Not an EncForge backup: ${err.message}` : err.message);
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    const dbEntry = byName.get(DB_NAME) ?? byName.get(LEGACY_DB_NAME);
    if (!byName.has('manifest.json') || !dbEntry) {
      throw badRequest(`Not an EncForge backup (manifest.json or ${DB_NAME} is missing)`);
    }
    const work = path.join(this.tmpDir, `unpack-${randomUUID()}`);
    await fs.mkdir(path.join(work, 'logs'), { recursive: true });
    try {
      await extractEntry(file, byName.get('manifest.json'), path.join(work, 'manifest.json'));
      let manifest;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(work, 'manifest.json'), 'utf8'));
      } catch {
        throw badRequest('The backup manifest is damaged');
      }
      if (manifest.app !== APP && manifest.app !== LEGACY_APP) throw badRequest('Not an EncForge backup');
      if (manifest.format > FORMAT) throw badRequest('This backup was made by a newer version of the app; update first');
      const dbFile = path.join(work, DB_NAME);
      await extractEntry(file, dbEntry, dbFile);
      const logs = [];
      for (const e of entries.filter((x) => LOG_NAME.test(x.name))) {
        const dest = path.join(work, e.name);
        await extractEntry(file, e, dest);
        logs.push(dest);
      }
      this.checkDb(dbFile);
      return { work, manifest, dbFile, logs, file };
    } catch (err) {
      await fs.rm(work, { recursive: true, force: true });
      if (err instanceof ZipError) throw badRequest(`The backup is damaged: ${err.message}`);
      throw err;
    }
  }

  checkDb(dbFile) {
    let bk;
    try {
      bk = new DatabaseSync(dbFile, { readOnly: true });
      const ok = bk.prepare('PRAGMA integrity_check').get();
      if (Object.values(ok)[0] !== 'ok') throw badRequest('The database in the backup is damaged');
      const tables = new Set(bk.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
      const missing = CONFIG_TABLES.filter((t) => !tables.has(t));
      if (missing.length) throw badRequest(`The database in the backup has no ${missing.join(', ')} table`);
    } catch (err) {
      if (err.statusCode) throw err;
      throw badRequest(`The database in the backup cannot be read: ${err.message}`);
    } finally {
      bk?.close();
    }
  }

  /** What a backup holds, compared with the current data, plus things to know before restoring. */
  async inspect(source) {
    const u = await this.unpack(source);
    try {
      const bk = new DatabaseSync(u.dbFile, { readOnly: true });
      let counts;
      let settings;
      try {
        counts = countRows(bk);
        settings = Object.fromEntries(bk.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]));
      } finally {
        bk.close();
      }
      const warnings = [];
      const missingFolders = [];
      const folders = [...(settings.sourceRoots ?? (settings.sourceRoot ? [settings.sourceRoot] : [])), settings.targetRoot].filter(Boolean);
      for (const f of folders) {
        if (!(await fs.stat(f).then((s) => s.isDirectory(), () => false))) {
          warnings.push(`The folder ${f} does not exist on this server; fix it in Settings after restoring.`);
          missingFolders.push(f);
        }
      }
      return {
        source,
        manifest: u.manifest,
        counts,
        logs: u.logs.length,
        current: countRows(this.db),
        warnings,
        // The same as `warnings` and `busy`, as data the web app words in its own language.
        missingFolders,
        busy: this.busyReason(),
        busyCode: this.busyCode(),
      };
    } finally {
      await fs.rm(u.work, { recursive: true, force: true });
    }
  }

  /** Why a full restore cannot run now, or null: 'conversion' | 'merge' | 'quality' | 'naming' | 'upload'. */
  busyCode() {
    if (this.queue.active) return 'conversion';
    if (this.merger.active) return 'merge';
    if (this.quality.active) return 'quality';
    if (this.naming?.active) return 'naming';
    if (this.uploads.writing.size) return 'upload';
    return null;
  }

  /** Why a full restore cannot run now, in English, or null. */
  busyReason() {
    if (this.queue.active) return 'a conversion is running';
    if (this.merger.active) return 'a merge is running';
    if (this.quality.active) return 'a quality check is running';
    if (this.naming?.active) return 'a naming check is running';
    if (this.uploads.writing.size) return 'an upload is in progress';
    return null;
  }

  // ---------------------------------------------------------------- restoring

  async restore({ source, scope }) {
    if (!['config', 'all'].includes(scope)) throw badRequest('scope must be config or all');
    if (this.restoring) throw conflict('A restore is already running');
    const busy = this.busyReason();
    if (scope === 'all' && busy) throw conflict(`Cannot restore everything while ${busy}; wait for it or stop it first`);
    this.restoring = true;
    let u;
    try {
      u = await this.unpack(source);
      // Undo point: the current data, logs included.
      const saved = await this.saveSnapshot({ logs: true, reason: 'before-restore' });
      const wasRunning = this.settings.get('queueRunning');
      const tables = scope === 'all' ? ALL_TABLES : CONFIG_TABLES;

      this.db.prepare('ATTACH DATABASE ? AS bk').run(u.dbFile);
      const restored = [];
      try {
        tx(this.db, () => {
          for (const t of tables) {
            const theirs = columns(this.db, 'bk', t);
            if (!theirs.length) continue; // older backup without this table
            const shared = columns(this.db, 'main', t).filter((c) => theirs.includes(c));
            const list = shared.map((c) => `"${c}"`).join(', ');
            this.db.exec(`DELETE FROM main.${t}`);
            this.db.exec(`INSERT INTO main.${t} (${list}) SELECT ${list} FROM bk.${t}`);
            restored.push(t);
          }
        });
      } finally {
        this.db.exec('DETACH DATABASE bk');
      }

      // A restore never starts the queue: keep its state (config) or stop it (everything).
      this.settings.reload();
      this.settings.set('queueRunning', scope === 'all' ? false : wasRunning);
      this.renamer?.seed();
      await this.watcher?.reconfigure();
      this.scheduler?.reconfigure().catch(() => {});
      this.queue.scheduleChanged?.();

      if (scope === 'all') {
        await fs.mkdir(this.logDir, { recursive: true });
        for (const f of await fs.readdir(this.logDir)) await fs.rm(path.join(this.logDir, f), { force: true, recursive: true });
        for (const f of u.logs) await fs.copyFile(f, path.join(this.logDir, path.basename(f)));
        await this.merger.recover();
        this.quality.recover();
        this.naming?.recover();
        await this.queue.recover();
      }

      for (const e of ['jobs', 'presets', 'renameRules', 'merges', 'qualityScans', 'namingChecks']) this.events.emit(e);
      this.events.emit('settings', this.settings.public());
      this.events.emit('queue', this.queue.state());
      this.log.info(`Restored ${scope === 'all' ? 'everything' : 'the configuration'} from ${source}; previous data saved as ${saved.name}`);
      if (source.startsWith('upload:')) await fs.rm(u.file, { force: true });
      return { scope, tables: restored, logs: scope === 'all' ? u.logs.length : 0, savedAs: saved.name };
    } finally {
      this.restoring = false;
      if (u) await fs.rm(u.work, { recursive: true, force: true });
    }
  }
}
