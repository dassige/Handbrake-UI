// Watch folders: new videos that appear in them are added to the queue by themselves.
//
// Polling, not inotify: the sources are usually NFS/SMB mounts, where file system
// events from other machines never arrive. A file is added once it has stopped
// changing: same size as on the previous scan and not modified for `settleMinutes`.
// Each file is handled once (table watch_seen). When a folder is added to the list,
// the files already in it are recorded as "existing" and left alone.
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { collectVideos, isInside, makeFileMatcher } from './paths.js';

export const DEFAULT_WATCH = {
  enabled: false,
  // [{ path, presetId (null = default preset), recursive }]
  folders: [],
  settleMinutes: 10,
  intervalMinutes: 2,
  // Start the queue after adding files (it still waits for the conversion window).
  autoStart: true,
};

const MAX_FOLDERS = 20;
const KEEP_SEEN_DAYS = 30;

/** Validates watch settings; folders must exist and be inside one of the sources folders. */
export async function normalizeWatch(w, sourceRoots) {
  const v = { ...DEFAULT_WATCH, ...(w ?? {}) };
  for (const k of ['enabled', 'autoStart']) if (typeof v[k] !== 'boolean') throw badRequest(`watch.${k} must be true or false`);
  const settle = Number(v.settleMinutes);
  if (!Number.isFinite(settle) || settle < 1 || settle > 1440) throw badRequest('The quiet time before adding must be 1–1440 minutes');
  const interval = Number(v.intervalMinutes);
  if (!Number.isFinite(interval) || interval < 1 || interval > 60) throw badRequest('The scan interval must be 1–60 minutes');
  if (!Array.isArray(v.folders)) throw badRequest('watch.folders must be a list');
  if (v.folders.length > MAX_FOLDERS) throw badRequest(`At most ${MAX_FOLDERS} watch folders`);

  const folders = [];
  for (const f of v.folders) {
    const raw = String(f?.path ?? '').trim();
    if (!raw) continue;
    if (!path.isAbsolute(raw)) throw badRequest(`A watch folder must be an absolute path: ${raw}`);
    const abs = path.resolve(raw);
    if (!sourceRoots.some((r) => isInside(r, abs))) throw badRequest(`The watch folder ${abs} is not inside a sources folder`);
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isDirectory()) throw badRequest(`The watch folder is not an existing folder: ${abs}`);
    if (folders.some((x) => x.path === abs)) continue;
    const overlap = folders.find((x) => isInside(x.path, abs) || isInside(abs, x.path));
    if (overlap) throw badRequest(`Watch folders cannot be inside each other: ${overlap.path} and ${abs}`);
    const presetId = f.presetId == null || f.presetId === '' ? null : Number(f.presetId);
    if (presetId != null && !Number.isInteger(presetId)) throw badRequest('A watch folder preset must be a preset id');
    folders.push({ path: abs, presetId, recursive: f.recursive !== false });
  }
  if (v.enabled && !folders.length) throw badRequest('Add at least one watch folder, or turn watching off');
  return { enabled: v.enabled, folders, settleMinutes: settle, intervalMinutes: interval, autoStart: v.autoStart };
}

export class Watcher {
  constructor({ db, settings, queue, presets, notifier, events, log, now = () => Date.now() }) {
    Object.assign(this, { db, settings, queue, presets, notifier, events, log, now });
    this.timer = null;
    this.scanning = null;
    this.lastScanAt = null;
    this.nextScanAt = null;
    this.errors = {}; // folder → message
    this.pending = new Map(); // path → { size, mtime, firstSeen, folder }
  }

  start() {
    this.schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.nextScanAt = null;
  }

  /** (Re)arms the timer from the current settings. */
  schedule() {
    this.stop();
    const w = this.settings.get('watch');
    if (!w?.enabled || !w.folders.length) return;
    const ms = w.intervalMinutes * 60_000;
    this.nextScanAt = this.now() + ms;
    this.timer = setTimeout(() => {
      this.scan().catch((err) => this.log?.error(err, 'Watch folder scan failed')).finally(() => this.schedule());
    }, ms);
    this.timer.unref?.();
  }

  /** Called after the settings change: records the files already in newly added folders, re-arms the timer. */
  async reconfigure() {
    const w = this.settings.get('watch');
    const baselined = new Set(this.db.prepare('SELECT path FROM watch_folders').all().map((r) => r.path));
    for (const f of w.folders) if (!baselined.has(f.path)) await this.baseline(f);
    // A folder taken off the list starts afresh if it is added again.
    const del = this.db.prepare('DELETE FROM watch_folders WHERE path = ?');
    for (const p of baselined) if (!w.folders.some((f) => f.path === p)) del.run(p);
    for (const p of [...this.pending.keys()]) {
      if (!w.folders.some((f) => isInside(f.path, p))) this.pending.delete(p);
    }
    this.schedule();
    this.emit();
  }

  async baseline(folder) {
    const files = await this.list(folder).catch(() => []);
    const now = this.now();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO watch_seen (path, folder, seen_at, action) VALUES (?, ?, ?, 'existing')`,
    );
    for (const f of files) insert.run(f, folder.path, now);
    this.db.prepare('INSERT OR REPLACE INTO watch_folders (path, baselined_at) VALUES (?, ?)').run(folder.path, now);
    this.log?.info(`Watch folder ${folder.path}: ${files.length} existing file(s) left alone`);
  }

  list(folder) {
    return collectVideos(folder.path, { recursive: folder.recursive, matcher: makeFileMatcher(this.settings) });
  }

  /** One pass over every watch folder. Concurrent calls share the running pass. */
  scan() {
    this.scanning ??= this.doScan().finally(() => {
      this.scanning = null;
      this.emit();
    });
    return this.scanning;
  }

  async doScan() {
    const w = this.settings.get('watch');
    if (!w?.enabled) return { added: [] };
    const settleMs = w.settleMinutes * 60_000;
    const seen = this.db.prepare('SELECT 1 FROM watch_seen WHERE path = ?');
    const allAdded = [];
    this.emit({ scanning: true });

    for (const folder of w.folders) {
      let files;
      try {
        if (!this.db.prepare('SELECT 1 FROM watch_folders WHERE path = ?').get(folder.path)) await this.baseline(folder);
        files = await this.list(folder);
        delete this.errors[folder.path];
      } catch (err) {
        this.errors[folder.path] = err.code === 'ENOENT' ? 'Folder not found' : err.message;
        continue;
      }

      const ready = [];
      const now = this.now();
      for (const f of files) {
        if (seen.get(f)) continue;
        const st = await fs.stat(f).catch(() => null);
        if (!st?.isFile()) continue;
        const prev = this.pending.get(f);
        const still = prev && prev.size === st.size && prev.mtime === st.mtimeMs;
        if (still && now - st.mtimeMs >= settleMs && st.size > 0) ready.push(f);
        else this.pending.set(f, { size: st.size, mtime: st.mtimeMs, firstSeen: prev?.firstSeen ?? now, folder: folder.path });
      }
      this.prune(folder, files);
      if (!ready.length) continue;

      let presetId = folder.presetId;
      if (presetId != null) {
        try {
          this.presets.get(presetId);
        } catch {
          presetId = null; // deleted since: use the default preset
        }
      }
      let result;
      try {
        result = await this.queue.add({ paths: ready, presetId, position: 'end', origin: 'watch' });
      } catch (err) {
        // e.g. no preset yet: try again on the next scan.
        this.errors[folder.path] = `Could not add files: ${err.message}`;
        continue;
      }
      const ids = new Map();
      result.added.forEach((id) => {
        const row = this.db.prepare('SELECT source_path FROM jobs WHERE id = ?').get(id);
        if (row) ids.set(row.source_path, id);
      });
      const skipped = new Map(result.skipped.map((s) => [s.path, s.reason]));
      const record = this.db.prepare(
        'INSERT OR REPLACE INTO watch_seen (path, folder, seen_at, action, job_id, note) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const added = [];
      for (const f of ready) {
        this.pending.delete(f);
        if (ids.has(f)) {
          record.run(f, folder.path, now, 'added', ids.get(f), null);
          added.push(f);
        } else {
          record.run(f, folder.path, now, 'skipped', null, skipped.get(f) ?? 'not added');
        }
      }
      if (added.length) {
        this.log?.info(`Watch folder ${folder.path}: added ${added.length} file(s)`);
        allAdded.push(...added);
        this.notifier?.notify('watchAdded', { folder: folder.path, added });
      }
    }

    this.lastScanAt = this.now();
    if (allAdded.length && w.autoStart && !this.settings.get('queueRunning')) this.queue.setRunning(true);
    return { added: allAdded };
  }

  /** Forgets files that are gone from the folder (after a while) and pending entries for them. */
  prune(folder, files) {
    const present = new Set(files);
    for (const [p, v] of this.pending) if (v.folder === folder.path && !present.has(p)) this.pending.delete(p);
    const old = this.now() - KEEP_SEEN_DAYS * 86_400_000;
    const rows = this.db.prepare('SELECT path FROM watch_seen WHERE folder = ? AND seen_at < ?').all(folder.path, old);
    const del = this.db.prepare('DELETE FROM watch_seen WHERE path = ?');
    for (const r of rows) if (!present.has(r.path)) del.run(r.path);
  }

  status() {
    const w = this.settings.get('watch');
    const settleMs = (w?.settleMinutes ?? 10) * 60_000;
    return {
      enabled: !!w?.enabled,
      scanning: !!this.scanning,
      lastScanAt: this.lastScanAt,
      nextScanAt: this.nextScanAt,
      errors: this.errors,
      pending: [...this.pending.entries()].map(([p, v]) => ({
        path: p, folder: v.folder, size: v.size, firstSeen: v.firstSeen, readyAt: v.mtime + settleMs,
      })),
      recent: this.db
        .prepare(`SELECT path, folder, seen_at AS at, action, job_id AS jobId, note FROM watch_seen
          WHERE action != 'existing' ORDER BY seen_at DESC LIMIT 20`)
        .all(),
    };
  }

  emit(extra) {
    this.events?.emit('watch', { ...this.status(), ...extra });
  }
}
