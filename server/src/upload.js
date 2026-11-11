// Uploads from the browser into a source folder. Files arrive in chunks and are
// appended to a hidden ".<name>.<size>.hbui-upload" file in the destination
// folder; the size on disk is the resume point, so an interrupted upload
// continues where it stopped when the same file is sent to the same folder.
// When the last byte arrives the file gets its real name ("name (1).mkv" if the
// name is taken: existing files are never replaced).
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { badRequest, conflict } from './errors.js';
import { makeFileMatcher, resolveUnderAny, uniquePath } from './paths.js';

export const MAX_CHUNK = 64 * 1024 * 1024;
const STALE_MS = 7 * 24 * 3600 * 1000;

/** A plain file or folder name: no path parts, not hidden, nothing a shell or NAS would choke on. */
export function checkName(name, what = 'File name') {
  if (typeof name !== 'string') throw badRequest(`${what} is missing`);
  const n = name.trim();
  if (!n) throw badRequest(`${what} is missing`);
  if (/[/\\\0]/.test(n)) throw badRequest(`${what} cannot contain slashes: ${n}`);
  if (n.startsWith('.')) throw badRequest(`${what} cannot start with a dot: ${n}`);
  if (Buffer.byteLength(n) > 240) throw badRequest(`${what} is too long: ${n}`);
  return n;
}

export class Uploads {
  constructor({ db, settings, events, log }) {
    this.db = db;
    this.settings = settings;
    this.events = events;
    this.log = log;
    this.writing = new Set(); // part files with a chunk being written
  }

  /** Destination folder (under a source root) and the checked file name. */
  async target(dir, name) {
    const { path: abs } = await resolveUnderAny(this.settings.get('sourceRoots'), dir);
    if (!(await fs.stat(abs)).isDirectory()) throw badRequest(`Not a folder: ${dir}`);
    if (name === undefined) return { dir: abs };
    const clean = checkName(name);
    // Videos, and subtitle files to go with them (with the .sub data of VobSub .idx files).
    const subExts = this.settings.get('subtitleExtensions') ?? [];
    const ext = path.extname(clean).slice(1).toLowerCase();
    const isSubtitle = subExts.includes(ext) || (ext === 'sub' && subExts.includes('idx'));
    if (!makeFileMatcher(this.settings).isVideo(clean) && !isSubtitle) {
      throw badRequest(`${clean}: not a video or subtitle file (see the video and subtitle extensions in Settings)`);
    }
    return { dir: abs, name: clean };
  }

  partPath(dir, name, size) {
    return path.join(dir, `.${name}.${size}.hbui-upload`);
  }

  /** What is already there for each file: same name, or a partial upload to resume. */
  async check({ dir, files }) {
    if (!Array.isArray(files) || !files.length) throw badRequest('No files');
    const { dir: abs } = await this.target(dir);
    const out = [];
    for (const f of files) {
      const size = checkSize(f.size);
      let name;
      try {
        ({ name } = await this.target(abs, f.name));
      } catch (err) {
        out.push({ name: f.name, size, error: err.message });
        continue;
      }
      const exists = await fs.stat(path.join(abs, name)).then(() => true, () => false);
      const partial = await fs.stat(this.partPath(abs, name, size)).then((s) => s.size, () => 0);
      out.push({ name, size, exists, partial });
    }
    const fsInfo = await fs.statfs(abs).catch(() => null);
    return { dir: abs, freeBytes: fsInfo ? fsInfo.bavail * fsInfo.bsize : null, files: out };
  }

  /** Appends one chunk; returns { offset } or, after the last byte, { done, path }. */
  async chunk({ dir, name, size, offset }, stream, contentLength) {
    const t = await this.target(dir, name);
    size = checkSize(size);
    offset = Number(offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > size) throw badRequest('Invalid offset');
    if (contentLength != null && Number(contentLength) > MAX_CHUNK) throw badRequest('Chunk too large');
    const part = this.partPath(t.dir, t.name, size);
    if (this.writing.has(part)) throw conflict('This file is already being uploaded');
    this.writing.add(part);
    try {
      const have = await fs.stat(part).then((s) => s.size, () => 0);
      if (have !== offset) throw conflict(`Upload is at ${have} bytes, not ${offset}`);
      this.track(part, t, size);
      const limit = Math.min(MAX_CHUNK, size - offset);
      let received = 0;
      const counter = new Transform({
        transform(buf, enc, cb) {
          received += buf.length;
          cb(received > limit ? badRequest('More data than the file size') : null, buf);
        },
      });
      await pipeline(stream, counter, createWriteStream(part, { flags: 'a' }));
      const now = (await fs.stat(part)).size;
      if (now < size) return { offset: now };
      const final = await uniquePath(path.join(t.dir, t.name));
      await fs.rename(part, final);
      this.db.prepare('DELETE FROM uploads WHERE part_path = ?').run(part);
      this.events.emit('files', { dir: t.dir });
      this.log.info(`Uploaded ${final} (${size} bytes)`);
      return { done: true, path: final, offset: size };
    } finally {
      this.writing.delete(part);
    }
  }

  track(part, t, size) {
    this.db
      .prepare(`INSERT INTO uploads (part_path, dir, name, size, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(part_path) DO UPDATE SET updated_at = excluded.updated_at`)
      .run(part, t.dir, t.name, size, Date.now());
  }

  /** Throws away a partial upload. */
  async discard({ dir, name, size }) {
    const t = await this.target(dir, name);
    const part = this.partPath(t.dir, t.name, checkSize(size));
    if (this.writing.has(part)) throw conflict('A chunk is still being written; try again in a moment');
    await fs.rm(part, { force: true });
    this.db.prepare('DELETE FROM uploads WHERE part_path = ?').run(part);
    return { ok: true };
  }

  /** Removes partial uploads nobody touched for a week. */
  async cleanup() {
    const old = this.db.prepare('SELECT part_path FROM uploads WHERE updated_at < ?').all(Date.now() - STALE_MS);
    for (const { part_path: p } of old) {
      await fs.rm(p, { force: true }).catch((err) => this.log.warn(`Cannot remove ${p}: ${err.message}`));
      this.db.prepare('DELETE FROM uploads WHERE part_path = ?').run(p);
    }
    if (old.length) this.log.info(`Removed ${old.length} abandoned upload(s)`);
  }

  /** Creates a sub-folder under a source root. */
  async mkdir({ parent, name }) {
    const { dir } = await this.target(parent);
    const full = path.join(dir, checkName(name, 'Folder name'));
    try {
      await fs.mkdir(full);
    } catch (err) {
      if (err.code === 'EEXIST') throw conflict(`${path.basename(full)} already exists`);
      throw err;
    }
    this.events.emit('files', { dir });
    return { path: full };
  }
}

function checkSize(size) {
  const n = Number(size);
  if (!Number.isSafeInteger(n) || n <= 0) throw badRequest('Invalid file size');
  return n;
}
