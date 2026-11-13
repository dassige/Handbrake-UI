// Replacing an original with its conversion, for jobs added from the quality check (origin "quality").
//
// The converted file takes the original's place: same folder, same name, the converted file's
// extension (Film.avi → Film.mkv). The original is kept in the originals folder chosen in
// Settings → Quality check (same path as under its sources folder), or deleted.
// Subtitle copies written next to the converted file go with it, renamed after the original;
// an original subtitle file of the same name goes with the original. The original's other
// subtitle files stay: they still match the video's name.
//
// Nothing is lost on the way: the converted file is first put next to the original under a
// hidden name, the original is moved or copied to the originals folder, and only then does the
// converted file take its name. A step that fails undoes the ones before it. Moves between
// disks or shares are copies, and the copied-from file is removed last.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, badRequest, conflict } from './errors.js';
import { copyBytes, isInside, rootOf, uniquePath } from './paths.js';

export const REPLACE_ORIGIN = 'quality';

const exists = (p) => fs.access(p).then(() => true, () => false);

/**
 * Validates Settings → Quality check → originals folder: '' (none) or an existing, writable
 * folder outside the sources folders (else watch folders and checks would pick the originals up).
 */
export async function normalizeOriginalsFolder(value, sourceRoots) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!path.isAbsolute(raw)) throw badRequest(`The originals folder must be an absolute path on the server: ${raw}`);
  const folder = path.resolve(raw);
  for (const r of sourceRoots) {
    if (folder === r || isInside(r, folder)) throw badRequest(`The originals folder cannot be inside the sources folder ${r}`);
  }
  const st = await fs.stat(folder).catch(() => null);
  if (!st?.isDirectory()) throw badRequest(`The originals folder does not exist on the server (is the share mounted?): ${folder}`);
  await fs.access(folder, constants.W_OK).catch(() => {
    throw badRequest(`The app cannot write to the originals folder: ${folder}`);
  });
  return folder;
}

const PART = '.encforge-part';

/** The hidden name a file is written under until it is complete: dir/.name.encforge-part */
export const partName = (to) => path.join(path.dirname(to), `.${path.basename(to)}${PART}`);

/**
 * Moves a file, also between disks or shares: rename, or a copy of its bytes (under a hidden
 * name, then renamed) when rename cannot cross. A `to` that is already a hidden part name is
 * copied to directly. keepSource: after a copy, leave the source for the caller to remove.
 * onProgress(bytes): during a copy. Returns { copied }.
 */
export async function moveFile(from, to, { keepSource = false, rename = fs.rename, onProgress = null } = {}) {
  try {
    await rename(from, to);
    return { copied: false };
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  const part = to.endsWith(PART) ? to : partName(to);
  try {
    await copyBytes(from, part, onProgress);
    if (part !== to) await fs.rename(part, to);
  } catch (err) {
    await fs.rm(part, { force: true }).catch(() => {});
    throw err;
  }
  if (!keepSource) await fs.rm(from, { force: true });
  return { copied: true };
}

/** How often progress goes out to the browsers (ms). */
const PROGRESS_EVERY = 500;

export class Replacer {
  /** rename: replaceable for tests (to act as if folders were on different disks). */
  constructor({ db, settings, queue, subtitles = null, events, log, rename = fs.rename, progressEvery = PROGRESS_EVERY }) {
    Object.assign(this, { db, settings, queue, subtitles, events, log, rename, progressEvery });
    this.busy = new Set();
    // The originals being replaced in the background (one at a time): see add().
    this.batch = null;
    this.lastProgress = 0;
  }

  // ---------------------------------------------------------------- in the background

  /**
   * The list: { running, stopping, startedAt, finishedAt, items: [{ id, name, backup, status, error, code }],
   * current: { id, step, done, total } | null }. status: waiting | replacing | done | failed | skipped.
   * null when there is none (never started, or cleared).
   */
  state() {
    const b = this.batch;
    if (!b) return null;
    return { ...b, items: b.items.map((i) => ({ ...i })), current: b.current && { ...b.current } };
  }

  emit() {
    this.lastProgress = Date.now();
    this.events.emit('replace', this.state());
  }

  /**
   * Adds jobs to the list and starts working through it, one at a time, in the background (it
   * goes on with no browser open). A job already waiting or being replaced is not added twice.
   * Jobs that turn out not to be replaceable fail one by one, with the reason.
   */
  add(ids, { backup = false } = {}) {
    if (!Array.isArray(ids) || !ids.length) throw badRequest('Choose the jobs whose originals to replace');
    if (backup === true && !this.settings.get('replaceBackupFolder')) {
      throw badRequest('Choose a folder for the originals first (Settings → Quality check)', 'noBackupFolder');
    }
    const jobs = ids.map((id) => this.queue.get(Number(id)));
    if (!this.batch?.running) {
      this.batch = { running: true, stopping: false, startedAt: Date.now(), finishedAt: null, items: [], current: null };
    }
    const pending = new Set(this.batch.items.filter((i) => ['waiting', 'replacing'].includes(i.status)).map((i) => i.id));
    for (const job of jobs) {
      if (pending.has(job.id)) continue;
      pending.add(job.id);
      this.batch.items.push({ id: job.id, name: path.basename(job.sourcePath), backup: backup === true, status: 'waiting', error: null, code: null });
    }
    this.emit();
    this.work();
    return this.state();
  }

  /** Finishes the file being replaced, and skips the rest. */
  stop() {
    if (!this.batch?.running) throw conflict('Nothing is being replaced');
    this.batch.stopping = true;
    this.emit();
    return this.state();
  }

  /** Forgets a finished list (its summary in the app). */
  clear() {
    if (this.batch?.running) throw conflict('Originals are being replaced; stop first');
    this.batch = null;
    this.emit();
  }

  async work() {
    if (this.working) return;
    this.working = true;
    const b = this.batch;
    try {
      for (let item = b.items.find((i) => i.status === 'waiting'); item && !b.stopping; item = b.items.find((i) => i.status === 'waiting')) {
        item.status = 'replacing';
        b.current = { id: item.id, step: null, done: 0, total: null };
        this.emit();
        try {
          await this.replace(item.id, {
            backup: item.backup,
            onProgress: (p) => {
              b.current = { id: item.id, ...p };
              if (p.done === 0 || Date.now() - this.lastProgress >= this.progressEvery) this.emit();
            },
          });
          item.status = 'done';
        } catch (err) {
          item.status = 'failed';
          item.error = err.message;
          item.code = err.errorCode ?? null;
          this.log?.warn(`Replacing the original of job ${item.id} failed: ${err.message}`);
        }
        b.current = null;
        this.emit();
      }
    } finally {
      for (const i of b.items) if (i.status === 'waiting') i.status = 'skipped';
      b.running = false;
      b.stopping = false;
      b.current = null;
      b.finishedAt = Date.now();
      this.working = false;
      this.emit();
    }
  }

  /**
   * At start-up: a replace cut short by a restart may have left the converted file's hidden copy
   * next to its original. With the original still there it is removed (nothing was replaced);
   * without it, the original had already gone to the originals folder, so the copy takes its place.
   */
  async recover() {
    const rows = this.db.prepare(`SELECT id FROM jobs WHERE origin = ? AND status = 'done' AND replaced IS NULL`).all(REPLACE_ORIGIN);
    for (const { id } of rows) {
      const job = this.queue.get(id);
      const dest = destinationOf(job);
      const part = partName(dest);
      if (!(await exists(part))) continue;
      if (await exists(job.sourcePath)) {
        await fs.rm(part, { force: true }).catch(() => {});
        this.log?.info(`Job ${id}: removed an unfinished copy left by a restart: ${part}`);
      } else {
        await fs.rename(part, dest).catch((err) => this.log?.warn(`Job ${id}: could not finish a replace cut short: ${err.message}`));
        this.log?.warn(`Job ${id}: finished a replace cut short by a restart: ${dest}`);
      }
    }
  }

  /** Why this job's original cannot be replaced now, or null. */
  async problem(job) {
    if (job.origin !== REPLACE_ORIGIN) return { code: 'notQuality', reason: 'Only jobs added from the quality check replace their original' };
    if (job.replaced) return { code: 'alreadyReplaced', reason: 'The original was already replaced' };
    if (job.status !== 'done') return { code: 'notDone', reason: 'The job is not converted (yet)' };
    if (job.verifyStatus === 'running') return { code: 'checking', reason: 'The converted file is being checked; wait for the check' };
    if (job.verifyStatus === 'error') return { code: 'checkFailed', reason: 'The check after conversion failed: fix that (or check again) first' };
    if (!(await exists(job.outputPath))) return { code: 'noOutput', reason: `The converted file is gone: ${job.outputPath}` };
    const root = rootOf(this.settings.get('sourceRoots'), job.sourcePath);
    if (!root) return { code: 'outsideSources', reason: `The original is no longer in a sources folder: ${job.sourcePath}` };
    if (this.settings.get('protectedRoots').includes(root)) {
      return { code: 'protected', reason: `Files in ${root} are protected from deletion (Settings → Folders)` };
    }
    if (this.queue.pendingSourcesUnder(job.sourcePath).length) {
      return { code: 'pending', reason: 'The original is queued or converting again; remove it from the queue first' };
    }
    const dest = destinationOf(job);
    if (dest !== job.sourcePath && (await exists(dest))) {
      return { code: 'nameTaken', reason: `${path.basename(dest)} already exists next to the original` };
    }
    return null;
  }

  /**
   * Replaces the original of job id. backup: keep it in the originals folder (which must be set).
   * onProgress({ step, done, total }) while files are copied: step 'converted' (the converted file
   * to the original's folder) or 'original' (the original to the originals folder), in bytes.
   * Returns the updated job; its `replaced` says what happened.
   */
  async replace(id, { backup = false, onProgress = null } = {}) {
    if (this.busy.has(id)) throw conflict('This original is being replaced already');
    this.busy.add(id);
    try {
      return await this.run(this.queue.get(id), backup === true, onProgress);
    } finally {
      this.busy.delete(id);
    }
  }

  async run(job, backup, onProgress = null) {
    const sizeOf = (p) => fs.stat(p).then((s) => s.size, () => null);
    const progress = async (step, file) => {
      if (!onProgress) return null;
      const total = await sizeOf(file);
      onProgress({ step, done: 0, total });
      return (done) => onProgress({ step, done, total });
    };
    const problem = await this.problem(job);
    if (problem) throw new HttpError(409, problem.reason, problem.code);
    const folder = this.settings.get('replaceBackupFolder');
    if (backup && !folder) throw badRequest('Choose a folder for the originals first (Settings → Quality check)', 'noBackupFolder');

    const original = job.sourcePath;
    const converted = job.outputPath;
    const dest = destinationOf(job);
    const root = rootOf(this.settings.get('sourceRoots'), original);
    const originalThere = await exists(original);
    // Where the original goes, under the same path as in its sources folder.
    const backupPath = backup && originalThere ? await uniquePath(path.join(folder, path.relative(root, original))) : null;
    const companions = (await this.subtitles?.companions(converted).catch(() => [])) ?? [];
    const warnings = [];

    // 1. The converted file next to the original, under a hidden name.
    const part = partName(dest);
    const moved = await moveFile(converted, part, { keepSource: true, rename: this.rename, onProgress: await progress('converted', converted) });
    const undoPart = () => (moved.copied ? fs.rm(part, { force: true }) : fs.rename(part, converted));

    // 2. The original into the originals folder.
    try {
      if (backupPath) {
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await moveFile(original, backupPath, { rename: this.rename, onProgress: await progress('original', original) });
      }
    } catch (err) {
      await undoPart().catch((e) => this.log?.warn(`Job ${job.id}: could not undo: ${e.message}`));
      throw new Error(`Could not move the original to ${folder}: ${err.message}`);
    }

    // 3. The converted file takes its name (replacing the original when the name is the same).
    try {
      await fs.rename(part, dest);
    } catch (err) {
      if (backupPath) await moveFile(backupPath, original, { rename: this.rename }).catch((e) => this.log?.warn(`Job ${job.id}: could not put the original back: ${e.message}`));
      await undoPart().catch((e) => this.log?.warn(`Job ${job.id}: could not undo: ${e.message}`));
      throw new Error(`Could not put the converted file in place: ${err.message}`);
    }
    // From here on the replacement stands; what fails now is reported, not undone.
    if (!backupPath && originalThere && dest !== original) {
      await fs.rm(original, { force: true }).catch((err) => warnings.push(`The original could not be deleted: ${err.message}`));
    }
    if (moved.copied) await fs.rm(converted, { force: true }).catch((err) => warnings.push(`${converted} could not be removed: ${err.message}`));

    // 4. Subtitle copies follow the converted file, named after the original.
    const subtitles = [];
    const base = path.join(path.dirname(original), path.parse(original).name);
    for (const c of companions) {
      const to = base + c.suffix;
      const entry = { from: c.path, to, backup: null };
      try {
        if (await exists(to)) {
          if (backupPath) {
            entry.backup = await uniquePath(path.join(path.dirname(backupPath), path.parse(backupPath).name + c.suffix));
            await moveFile(to, entry.backup, { rename: this.rename });
          } else {
            await fs.rm(to, { force: true });
          }
        }
        await moveFile(c.path, to, { rename: this.rename });
        subtitles.push(entry);
      } catch (err) {
        warnings.push(`${path.basename(c.path)}: ${err.message}`);
      }
    }

    const replaced = { at: Date.now(), original, converted, path: dest, backup: backupPath, subtitles, warnings };
    this.db.prepare('UPDATE jobs SET replaced = ?, output_path = ? WHERE id = ?').run(JSON.stringify(replaced), dest, job.id);
    this.log?.info(`Job ${job.id}: replaced ${original} with ${dest}${backupPath ? ` (original kept as ${backupPath})` : ''}`);
    this.queue.emitJob(job.id);
    this.events.emit('files');
    return this.queue.get(job.id);
  }
}

/** Where the converted file goes: the original's folder and name, the converted file's extension. */
export function destinationOf(job) {
  const { dir, name } = path.parse(job.sourcePath);
  return path.join(dir, name + path.extname(job.outputPath));
}
