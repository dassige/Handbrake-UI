// Downloads to the browser, from any sources folder or the target folder.
// - One file: sent as is, with Range support so the browser can resume it.
// - Several files or folders: one ZIP built on the fly. Entries are stored
//   (videos don't compress), so the exact size is known before the first
//   byte and the browser can show progress. ZIP64 is used where sizes or
//   offsets pass 4 GB.
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { badRequest, notFound } from './errors.js';
import { isHiddenName, naturalCompare, resolveUnderAny } from './paths.js';

const MAX_FILES = 10_000;
const TOKEN_TTL = 6 * 3600 * 1000;
const MAX_TOKENS = 50;

// ------------------------------------------------------------------ ZIP writer

const LIMIT32 = 0xffffffff;
const enc = (s) => Buffer.from(s, 'utf8');

function dosDateTime(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Lays out the archive: where each entry starts and how long everything is.
 * entries: [{ name, size, mtime }]. Pure, so the size can be sent up front.
 */
export function planZip(entries, { forceZip64 = false } = {}) {
  let offset = 0;
  let central = 0;
  const items = entries.map((e) => {
    const name = enc(e.name);
    const zip64 = forceZip64 || e.size >= LIMIT32 || offset >= LIMIT32;
    const local = 30 + name.length + (zip64 ? 20 : 0);
    const descriptor = zip64 ? 24 : 16;
    const item = { ...e, nameBuf: name, zip64, offset };
    offset += local + e.size + descriptor;
    central += 46 + name.length + (zip64 ? 28 : 0);
    return item;
  });
  const needEnd64 = forceZip64 || items.length >= 0xffff || offset >= LIMIT32 || central >= LIMIT32 || items.some((i) => i.zip64);
  return { items, centralOffset: offset, centralSize: central, end64: needEnd64, size: offset + central + (needEnd64 ? 56 + 20 : 0) + 22 };
}

function localHeader(it) {
  const { time, date } = dosDateTime(it.mtime);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(it.zip64 ? 45 : 20, 4);
  h.writeUInt16LE(0x0808, 6); // sizes in the data descriptor; UTF-8 names
  h.writeUInt16LE(0, 8); // stored
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  h.writeUInt32LE(0, 14);
  h.writeUInt32LE(it.zip64 ? LIMIT32 : 0, 18);
  h.writeUInt32LE(it.zip64 ? LIMIT32 : 0, 22);
  h.writeUInt16LE(it.nameBuf.length, 26);
  h.writeUInt16LE(it.zip64 ? 20 : 0, 28);
  const parts = [h, it.nameBuf];
  if (it.zip64) {
    const x = Buffer.alloc(20);
    x.writeUInt16LE(0x0001, 0);
    x.writeUInt16LE(16, 2); // sizes are in the descriptor; zero here
    parts.push(x);
  }
  return Buffer.concat(parts);
}

function descriptor(it, crc) {
  const d = Buffer.alloc(it.zip64 ? 24 : 16);
  d.writeUInt32LE(0x08074b50, 0);
  d.writeUInt32LE(crc, 4);
  if (it.zip64) {
    d.writeBigUInt64LE(BigInt(it.size), 8);
    d.writeBigUInt64LE(BigInt(it.size), 16);
  } else {
    d.writeUInt32LE(it.size, 8);
    d.writeUInt32LE(it.size, 12);
  }
  return d;
}

function centralEntry(it) {
  const { time, date } = dosDateTime(it.mtime);
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE((3 << 8) | 45, 4); // made by: Unix, 4.5
  h.writeUInt16LE(it.zip64 ? 45 : 20, 6);
  h.writeUInt16LE(0x0808, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(time, 12);
  h.writeUInt16LE(date, 14);
  h.writeUInt32LE(it.crc, 16);
  h.writeUInt32LE(it.zip64 ? LIMIT32 : it.size, 20);
  h.writeUInt32LE(it.zip64 ? LIMIT32 : it.size, 24);
  h.writeUInt16LE(it.nameBuf.length, 28);
  h.writeUInt16LE(it.zip64 ? 28 : 0, 30);
  h.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // regular file, rw-r--r--
  h.writeUInt32LE(it.zip64 ? LIMIT32 : it.offset, 42);
  const parts = [h, it.nameBuf];
  if (it.zip64) {
    const x = Buffer.alloc(28);
    x.writeUInt16LE(0x0001, 0);
    x.writeUInt16LE(24, 2);
    x.writeBigUInt64LE(BigInt(it.size), 4);
    x.writeBigUInt64LE(BigInt(it.size), 12);
    x.writeBigUInt64LE(BigInt(it.offset), 20);
    parts.push(x);
  }
  return Buffer.concat(parts);
}

function endRecords(plan) {
  const n = plan.items.length;
  const parts = [];
  if (plan.end64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE((3 << 8) | 45, 12);
    z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(n), 24);
    z.writeBigUInt64LE(BigInt(n), 32);
    z.writeBigUInt64LE(BigInt(plan.centralSize), 40);
    z.writeBigUInt64LE(BigInt(plan.centralOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(plan.centralOffset + plan.centralSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  // Real values where they fit; the ZIP64 record above has them all.
  e.writeUInt16LE(Math.min(n, 0xffff), 8);
  e.writeUInt16LE(Math.min(n, 0xffff), 10);
  e.writeUInt32LE(Math.min(plan.centralSize, LIMIT32), 12);
  e.writeUInt32LE(Math.min(plan.centralOffset, LIMIT32), 16);
  parts.push(e);
  return Buffer.concat(parts);
}

/** The archive as a stream of exactly plan.size bytes. entries need { path }. */
export function zipStream(plan) {
  async function* generate() {
    for (const it of plan.items) {
      yield localHeader(it);
      let crc = 0;
      let read = 0;
      if (it.size > 0) {
        for await (const chunk of createReadStream(it.path, { start: 0, end: it.size - 1, highWaterMark: 1 << 20 })) {
          crc = crc32(chunk, crc);
          read += chunk.length;
          yield chunk;
        }
      }
      if (read !== it.size) throw new Error(`${it.name} changed while it was being downloaded`);
      it.crc = crc;
      yield descriptor(it, crc);
    }
    for (const it of plan.items) yield centralEntry(it);
    yield endRecords(plan);
  }
  return Readable.from(generate(), { objectMode: false });
}

// ------------------------------------------------------------------ HTTP helpers

/** Content-Disposition with an ASCII fallback and the real UTF-8 name. */
export function attachment(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** Parses a single "bytes=a-b" range. Returns { start, end }, 'invalid' or null (no range). */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

// ------------------------------------------------------------------ the service

export class Downloads {
  constructor({ settings, log }) {
    this.settings = settings;
    this.log = log;
    this.tokens = new Map(); // id -> { name, entries, plan, expires }
  }

  roots() {
    return [...this.settings.get('sourceRoots'), this.settings.get('targetRoot')];
  }

  /** Sends one file; honours Range and If-Range so downloads can resume. */
  async sendFile(req, reply) {
    const { path: abs } = await resolveUnderAny(this.roots(), req.query.path);
    const st = await fs.stat(abs);
    if (!st.isFile()) throw badRequest('Only files can be downloaded this way; folders come as a ZIP');
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const lastModified = new Date(st.mtimeMs).toUTCString();
    reply.headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachment(path.basename(abs)),
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': lastModified,
      'Cache-Control': 'no-store',
    });
    const ifRange = req.headers['if-range'];
    const range = ifRange && ifRange !== etag && ifRange !== lastModified ? null : parseRange(req.headers.range, st.size);
    if (range === 'invalid') {
      reply.code(416).header('Content-Range', `bytes */${st.size}`);
      return reply.send();
    }
    if (st.size === 0) {
      reply.header('Content-Length', 0);
      return reply.send('');
    }
    const { start, end } = range ?? { start: 0, end: st.size - 1 };
    if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${st.size}`);
    reply.header('Content-Length', end - start + 1);
    return reply.send(createReadStream(abs, { start, end, highWaterMark: 1 << 20 }));
  }

  /** Expands the chosen files and folders and remembers them under a token for the GET that follows. */
  async prepareZip({ paths, name }) {
    if (!Array.isArray(paths) || !paths.length) throw badRequest('Choose files or folders to download');
    const roots = this.roots();
    const chosen = [];
    for (const p of paths) chosen.push((await resolveUnderAny(roots, p)).path);
    const base = commonParent(chosen);

    const entries = [];
    const add = async (file, st) => {
      if (entries.length >= MAX_FILES) throw badRequest(`Too many files (more than ${MAX_FILES}); download fewer folders at a time`);
      entries.push({ path: file, name: path.relative(base, file).split(path.sep).join('/'), size: st.size, mtime: st.mtimeMs });
    };
    const walk = async (dir) => {
      const list = await fs.readdir(dir, { withFileTypes: true });
      list.sort((a, b) => naturalCompare(a.name, b.name));
      for (const e of list) {
        if (isHiddenName(e.name) || e.name.endsWith('.part')) continue;
        const full = path.join(dir, e.name);
        const st = await fs.stat(full).catch(() => null);
        if (st?.isDirectory()) await walk(full);
        else if (st?.isFile()) await add(full, st);
      }
    };
    for (const p of [...new Set(chosen)]) {
      const st = await fs.stat(p);
      if (st.isDirectory()) await walk(p);
      else if (st.isFile()) await add(p, st);
    }
    if (!entries.length) throw badRequest('There are no files in what you chose');

    const zipName = `${cleanZipName(name) ?? (chosen.length === 1 ? path.basename(chosen[0]) : path.basename(base) || 'download')}.zip`;
    const plan = planZip(entries);
    this.prune();
    const id = randomUUID();
    this.tokens.set(id, { name: zipName, plan, expires: Date.now() + TOKEN_TTL });
    return { id, name: zipName, files: entries.length, size: plan.size, contentSize: entries.reduce((s, e) => s + e.size, 0) };
  }

  /** Streams a prepared ZIP. The token stays valid for a while, so a failed download can be started again. */
  sendZip(req, reply) {
    const t = this.tokens.get(req.params.id);
    if (!t || t.expires < Date.now()) throw notFound('This download has expired; start it again');
    // A fresh copy of the plan: the CRCs are filled in while streaming.
    const plan = { ...t.plan, items: t.plan.items.map((i) => ({ ...i })) };
    reply.headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': attachment(t.name),
      'Content-Length': plan.size,
      'Cache-Control': 'no-store',
    });
    const stream = zipStream(plan);
    stream.on('error', (err) => this.log.warn(`ZIP download ${t.name} stopped: ${err.message}`));
    return reply.send(stream);
  }

  prune() {
    const now = Date.now();
    for (const [id, t] of this.tokens) if (t.expires < now) this.tokens.delete(id);
    while (this.tokens.size >= MAX_TOKENS) this.tokens.delete(this.tokens.keys().next().value);
  }
}

/** Deepest folder that holds every path (a file's own folder when only one is chosen). */
function commonParent(paths) {
  let base = path.dirname(paths[0]);
  for (const p of paths) {
    while (base !== path.dirname(base) && path.relative(base, p).startsWith('..')) base = path.dirname(base);
  }
  return base;
}

function cleanZipName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\.zip$/i, '').replace(/[/\\:*?"<>|\0]/g, '_');
  return n || null;
}
