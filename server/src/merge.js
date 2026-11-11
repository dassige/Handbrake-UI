// Merges converted files into one MKV with mkvmerge, keeping every part's chapters
// (shifted to where the part starts) and checking first that the parts can be joined.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, notFound } from './errors.js';
import { collectVideos, makeFileMatcher, naturalCompare, resolveUnder } from './paths.js';
import { sanitizeFileName } from './rename/parse.js';

export const CHAPTER_MODES = ['keep', 'perFile'];
const MAX_PARTS = 100;
const GENERIC_TITLE = /^(chapter|capitolo|chapitre|kapitel|cap[ií]tulo)\s*\d+$/i;

// ------------------------------------------------------------------ pure helpers (unit tested)

/** Summary of one part from `mkvmerge -J` and `ffprobe -show_chapters` output. */
export function describePart(file, identify, chaptersProbe) {
  const durationNs = Number(identify?.container?.properties?.duration ?? 0);
  const duration = durationNs / 1e9;
  const tracks = (identify?.tracks ?? []).map((t) => ({
    type: t.type === 'subtitles' ? 'subtitle' : t.type,
    codec: t.codec,
    codecId: t.properties?.codec_id ?? t.codec,
    lang: t.properties?.language_ietf ?? t.properties?.language ?? 'und',
    size: t.properties?.pixel_dimensions ?? null,
    channels: t.properties?.audio_channels ?? null,
    rate: t.properties?.audio_sampling_frequency ?? null,
    privateData: t.properties?.codec_private_data ?? null,
  }));
  const chapters = (chaptersProbe?.chapters ?? [])
    .map((c) => ({
      start: Number(c.start_time),
      end: Number(c.end_time),
      title: (c.tags?.title ?? '').trim(),
    }))
    .filter((c) => Number.isFinite(c.start) && c.start < Math.max(duration, 0.001))
    .sort((a, b) => a.start - b.start);
  return { path: file, name: path.basename(file), duration, tracks, chapters };
}

const typeLabel = { video: 'video', audio: 'audio', subtitle: 'subtitle' };
const countOf = (tracks, type) => tracks.filter((t) => t.type === type).length;
const plural = (n, w) => `${n} ${w} track${n === 1 ? '' : 's'}`;

/**
 * Can these parts be appended? Returns [{ level: 'error'|'warning', message, code, params }]
 * (code + params let the web app show the message in its own language).
 * Errors block the merge: the result would not play properly.
 */
export function compatibility(parts) {
  const problems = [];
  if (parts.length < 2) problems.push({ level: 'error', code: 'tooFew', params: {}, message: 'Choose at least two files to merge.' });
  const first = parts[0];
  if (!first) return problems;
  for (const [i, p] of parts.entries()) {
    if (!p.duration) problems.push({ level: 'error', code: 'noLength', params: { name: p.name }, message: `${p.name}: cannot read its length.` });
    if (!p.tracks.some((t) => t.type === 'video')) problems.push({ level: 'error', code: 'noVideo', params: { name: p.name }, message: `${p.name}: has no video.` });
    if (i === 0) continue;
    const label = `${p.name} (part ${i + 1})`;
    const at = { name: p.name, part: i + 1 };
    const layout = (ts) => ts.map((t) => t.type).join(',');
    if (layout(p.tracks) !== layout(first.tracks)) {
      const types = ['video', 'audio', 'subtitle'].filter((ty) => countOf(p.tracks, ty) !== countOf(first.tracks, ty));
      const diff = types.map((ty) => `${plural(countOf(p.tracks, ty), typeLabel[ty])} instead of ${countOf(first.tracks, ty)}`);
      problems.push({
        level: 'error',
        code: types.length ? 'layout' : 'layoutOrder',
        params: { ...at, diff: types.map((type) => ({ type, count: countOf(p.tracks, type), expected: countOf(first.tracks, type) })) },
        message: `${label} has a different track layout: ${diff.join(', ') || 'tracks in a different order'}. Every part needs the same tracks (convert them with the same preset).`,
      });
      continue;
    }
    p.tracks.forEach((t, k) => {
      const f = first.tracks[k];
      const track = countOf(p.tracks.slice(0, k + 1), t.type);
      const what = `${typeLabel[t.type]} track ${track}`;
      const tr = { ...at, type: t.type, track };
      if (t.codecId !== f.codecId) {
        problems.push({ level: 'error', code: 'codec', params: { ...tr, codec: t.codec, firstCodec: f.codec }, message: `${label}: ${what} is ${t.codec}, part 1 has ${f.codec}.` });
      } else if (t.type === 'audio' && (t.channels !== f.channels || t.rate !== f.rate)) {
        problems.push({
          level: 'error',
          code: 'audioFormat',
          params: { ...tr, channels: t.channels, rate: t.rate, firstChannels: f.channels, firstRate: f.rate },
          message: `${label}: ${what} has ${t.channels} channels at ${t.rate} Hz, part 1 has ${f.channels} at ${f.rate} Hz.`,
        });
      } else if (t.type === 'video' && t.size !== f.size) {
        problems.push({ level: 'warning', code: 'pictureSize', params: { ...at, size: t.size, firstSize: f.size }, message: `${label}: the picture is ${t.size}, part 1 is ${f.size}. Players usually cope, but some may glitch where the parts join.` });
      } else if (t.type === 'video' && t.privateData && f.privateData && t.privateData !== f.privateData) {
        problems.push({ level: 'warning', code: 'videoSettings', params: at, message: `${label}: the video was encoded with slightly different settings. Most players cope; check the joins after merging.` });
      }
      if (t.lang !== f.lang && t.type !== 'video') {
        problems.push({ level: 'warning', code: 'language', params: { ...tr, lang: t.lang, firstLang: f.lang }, message: `${label}: ${what} is “${t.lang}”, part 1 is “${f.lang}”. The merged track keeps part 1's language.` });
      }
    });
  }
  return problems;
}

/** File name without extension, release dots turned into spaces: a chapter title. */
function partTitle(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Chapters of the merged file. mode 'keep': every part's chapters, shifted to where the part
 * starts; generic titles ("Chapter 3") are renumbered, a part without chapters gets one named
 * after the file. mode 'perFile': one chapter per part, named after the file.
 */
export function buildChapters(parts, mode = 'keep') {
  const out = [];
  let offset = 0;
  for (const p of parts) {
    const end = offset + p.duration;
    if (mode === 'perFile' || !p.chapters.length) {
      out.push({ start: offset, end, title: partTitle(p.name), generic: false });
    } else {
      for (const c of p.chapters) {
        out.push({
          start: offset + c.start,
          end: Math.min(end, offset + (Number.isFinite(c.end) && c.end > c.start ? c.end : p.duration)),
          title: c.title,
          generic: !c.title || GENERIC_TITLE.test(c.title),
        });
      }
    }
    offset = end;
  }
  let n = 0;
  return out.map((c) => {
    n++;
    return { start: c.start, end: c.end, title: c.generic ? `Chapter ${n}` : c.title };
  });
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function timestamp(seconds) {
  const ns = Math.max(0, Math.round(seconds * 1e9));
  const h = Math.floor(ns / 3.6e12);
  const m = Math.floor((ns % 3.6e12) / 6e10);
  const s = Math.floor((ns % 6e10) / 1e9);
  const frac = String(ns % 1e9).padStart(9, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${frac}`;
}

/** Matroska chapter XML for mkvmerge --chapters. */
export function chaptersXml(chapters) {
  const atoms = chapters
    .map(
      (c) => `    <ChapterAtom>
      <ChapterTimeStart>${timestamp(c.start)}</ChapterTimeStart>
      <ChapterTimeEnd>${timestamp(c.end)}</ChapterTimeEnd>
      <ChapterDisplay>
        <ChapterString>${xmlEscape(c.title)}</ChapterString>
        <ChapterLanguage>und</ChapterLanguage>
      </ChapterDisplay>
    </ChapterAtom>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">
<Chapters>
  <EditionEntry>
${atoms}
  </EditionEntry>
</Chapters>
`;
}

/** A name for the merged file: what the parts' names have in common, else the first name. */
export function suggestName(names) {
  const bases = names.map((n) => n.replace(/\.[^.]+$/, ''));
  if (!bases.length) return 'Merged';
  let prefix = bases[0];
  for (const b of bases.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < b.length && prefix[i].toLowerCase() === b[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  // Don't cut a word or a number in half; drop separators and an unfinished "Disc"/"Part".
  if (prefix.length < bases[0].length && /[\p{L}\p{N}]$/u.test(prefix)) prefix = prefix.replace(/[\p{L}\p{N}]+$/u, '');
  prefix = prefix.replace(/[\s._\-–(]*(disc|disco|cd|dvd|part|parte|pt|episode|ep|vol|volume)?[\s._\-–(]*$/iu, '').trim();
  return sanitizeFileName(prefix.length >= 3 ? prefix : `${bases[0]} - merged`);
}

// ------------------------------------------------------------------ running tools

function run(cmd, args, { onLine, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    onChild?.(child);
    let stdout = '';
    let stderr = '';
    let rest = '';
    child.stdout.setEncoding('utf8').on('data', (d) => {
      if (stdout.length < 32 << 20) stdout += d;
      if (onLine) {
        const lines = (rest + d).split(/\r?\n/);
        rest = lines.pop();
        lines.forEach(onLine);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (d) => {
      if (stderr.length < 1 << 20) stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function rowToMerge(r) {
  if (!r) return r;
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    parts: JSON.parse(r.parts),
    output: r.output,
    options: JSON.parse(r.options),
    progress: r.progress,
    phase: r.phase,
    error: r.error,
    warnings: r.warnings ? JSON.parse(r.warnings) : [],
    chapters: r.chapters,
    duration: r.duration,
    outputSize: r.output_size,
    verifyStatus: r.verify_status,
    verify: r.verify ? JSON.parse(r.verify) : null,
    partsRemoved: !!r.parts_removed,
  };
}

export class Merger {
  constructor({ db, settings, events, verifier, log, tmpDir, mkvmerge = 'mkvmerge', ffprobe = 'ffprobe' }) {
    this.db = db;
    this.settings = settings;
    this.events = events;
    this.verifier = verifier;
    this.log = log;
    this.tmpDir = tmpDir;
    this.mkvmerge = mkvmerge;
    this.ffprobe = ffprobe;
    this.chain = Promise.resolve();
    this.active = null; // { id, child, cancelled }
  }

  /** Merges interrupted by a restart failed; their partial files are removed. */
  async recover() {
    for (const r of this.db.prepare(`SELECT id, output FROM merges WHERE status IN ('queued', 'running')`).all()) {
      await fs.rm(`${r.output}.part`, { force: true }).catch(() => {});
      this.db
        .prepare(`UPDATE merges SET status = 'failed', phase = NULL, error = 'Interrupted by a restart', finished_at = ? WHERE id = ?`)
        .run(Date.now(), r.id);
    }
  }

  list(limit = 30) {
    return this.db.prepare('SELECT * FROM merges ORDER BY id DESC LIMIT ?').all(limit).map(rowToMerge);
  }

  get(id) {
    const m = rowToMerge(this.db.prepare('SELECT * FROM merges WHERE id = ?').get(id));
    if (!m) throw notFound(`Merge ${id} not found`);
    return m;
  }

  /** Files (and folders, expanded) under the target root, in the order given. */
  async expand(paths) {
    if (!Array.isArray(paths) || !paths.length) return [];
    const root = this.settings.get('targetRoot');
    const matcher = makeFileMatcher(this.settings);
    const out = [];
    for (const p of paths) {
      const abs = await resolveUnder(root, p);
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        const found = await collectVideos(abs, { recursive: false, matcher: { ...matcher, excluded: () => false } });
        out.push(...found.sort((a, b) => naturalCompare(path.basename(a), path.basename(b))));
      } else if (st.isFile()) out.push(abs);
    }
    const unique = [...new Set(out)];
    if (unique.length > MAX_PARTS) throw badRequest(`Too many files (more than ${MAX_PARTS})`);
    return unique;
  }

  async describe(file) {
    const id = await run(this.mkvmerge, ['-J', file]).catch((err) => {
      throw err.code === 'ENOENT' ? conflict('mkvmerge is not installed') : err;
    });
    let identify;
    try {
      identify = JSON.parse(id.stdout);
    } catch {
      throw badRequest(`${path.basename(file)}: cannot be read (${id.stderr.trim() || `mkvmerge exit ${id.code}`})`);
    }
    if (!identify.container?.recognized) throw badRequest(`${path.basename(file)}: not a format mkvmerge can read`);
    const ch = await run(this.ffprobe, ['-v', 'error', '-show_chapters', '-of', 'json', file]).catch(() => ({ stdout: '{}' }));
    let chapters = {};
    try {
      chapters = JSON.parse(ch.stdout || '{}');
    } catch {
      // no chapters
    }
    const st = await fs.stat(file);
    return { ...describePart(file, identify, chapters), size: st.size, mtime: st.mtimeMs };
  }

  /** Everything the UI shows before merging. */
  async inspect({ paths, chapterMode = 'keep', outputName }) {
    if (!CHAPTER_MODES.includes(chapterMode)) throw badRequest('Unknown chapter mode');
    const files = await this.expand(paths);
    const parts = [];
    for (const f of files) parts.push(await this.describe(f));
    const problems = compatibility(parts);
    const chapters = buildChapters(parts, chapterMode);
    const name = outputName ? cleanName(outputName) : suggestName(parts.map((p) => p.name));
    const dir = parts[0] ? path.dirname(parts[0].path) : null;
    let exists = false;
    if (dir) exists = await fs.access(path.join(dir, `${name}.mkv`)).then(() => true, () => false);
    return {
      parts: parts.map(({ tracks, chapters: c, ...p }) => ({
        ...p,
        chapters: c.length,
        tracks: tracks.map(({ privateData, ...t }) => t),
      })),
      problems,
      chapters,
      duration: parts.reduce((s, p) => s + p.duration, 0),
      size: parts.reduce((s, p) => s + (p.size ?? 0), 0),
      outputName: name,
      outputDir: dir,
      outputExists: exists,
      canMerge: !problems.some((p) => p.level === 'error'),
    };
  }

  /** Queues a merge (merges run one at a time, next to the conversion queue). */
  async start({ paths, outputName, chapterMode = 'keep', removeParts = false }) {
    const info = await this.inspect({ paths, chapterMode, outputName });
    if (!info.canMerge) throw badRequest(info.problems.find((p) => p.level === 'error').message);
    const files = info.parts.map((p) => p.path);
    const busy = this.db
      .prepare(`SELECT parts FROM merges WHERE status IN ('queued','running')`)
      .all()
      .some((r) => JSON.parse(r.parts).some((p) => files.includes(p)));
    if (busy) throw conflict('Some of these files are already being merged');
    const output = await uniqueMkv(path.join(info.outputDir, `${info.outputName}.mkv`), this.settings.get('renameSeparator'));
    const r = this.db
      .prepare(`INSERT INTO merges (status, created_at, parts, output, options, progress, warnings, chapters, duration)
        VALUES ('queued', ?, ?, ?, ?, 0, ?, ?, ?)`)
      .run(
        Date.now(),
        JSON.stringify(files),
        output,
        JSON.stringify({ chapterMode, removeParts: !!removeParts }),
        JSON.stringify(info.problems.filter((p) => p.level === 'warning').map((p) => p.message)),
        info.chapters.length,
        info.duration,
      );
    const id = Number(r.lastInsertRowid);
    this.emit(id);
    this.chain = this.chain.then(() => this.run(id)).catch((err) => this.log.error(err, `Merge ${id} failed`));
    return this.get(id);
  }

  cancel(id) {
    const m = this.get(id);
    if (m.status === 'queued') {
      this.db.prepare(`UPDATE merges SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(Date.now(), id);
      this.emit(id);
      return;
    }
    if (this.active?.id !== id) throw conflict('This merge is not running');
    this.active.cancelled = true;
    this.active.child?.kill('SIGTERM');
  }

  remove(id) {
    const m = this.get(id);
    if (m.status === 'queued' || m.status === 'running') throw conflict('Cancel the merge first');
    this.db.prepare('DELETE FROM merges WHERE id = ?').run(id);
    this.events.emit('merges');
  }

  emit(id) {
    const row = this.db.prepare('SELECT * FROM merges WHERE id = ?').get(id);
    if (row) this.events.emit('merge', rowToMerge(row));
  }

  set(id, fields) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE merges SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  }

  async run(id) {
    const m = this.get(id);
    if (m.status !== 'queued') return;
    const active = { id, cancelled: false, child: null };
    this.active = active;
    const part = `${m.output}.part`;
    const chaptersFile = path.join(this.tmpDir, `merge-${id}-chapters.xml`);
    try {
      this.set(id, { status: 'running', phase: 'reading' });
      this.emit(id);
      // Read the parts again: they may have changed since they were added.
      const parts = [];
      for (const f of m.parts) parts.push(await this.describe(f));
      const errors = compatibility(parts).filter((p) => p.level === 'error');
      if (errors.length) throw new Error(errors[0].message);
      const chapters = buildChapters(parts, m.options.chapterMode);
      await fs.writeFile(chaptersFile, chaptersXml(chapters));

      const title = path.basename(m.output, '.mkv');
      const args = ['--gui-mode', '-o', part, '--title', title, '--chapters', chaptersFile];
      m.parts.forEach((f, i) => args.push(...(i ? ['+'] : []), '--no-chapters', f));
      this.set(id, { phase: 'merging', progress: 0 });
      this.emit(id);
      let last = 0;
      const warnings = [];
      const r = await run(this.mkvmerge, args, {
        onChild: (c) => (active.child = c),
        onLine: (line) => {
          const p = /^#GUI#progress (\d+)%/.exec(line);
          if (p) {
            const v = Number(p[1]) / 100;
            if (Date.now() - last > 800) {
              last = Date.now();
              this.set(id, { progress: v });
              this.events.emit('progress', { mergeId: id, progress: v });
            }
          }
          const w = /^#GUI#warning (.*)$/.exec(line);
          if (w) warnings.push(w[1]);
          const e = /^#GUI#error (.*)$/.exec(line);
          if (e) warnings.push(`Error: ${e[1]}`);
        },
      });
      if (active.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      // mkvmerge: 0 = OK, 1 = finished with warnings, 2 = error.
      if (r.code !== 0 && r.code !== 1) {
        throw new Error(warnings.find((w) => w.startsWith('Error:'))?.slice(7) ?? (r.stderr.trim() || `mkvmerge exited with code ${r.code}`));
      }
      await fs.rename(part, m.output);
      const size = (await fs.stat(m.output)).size;
      const total = parts.reduce((s, p) => s + p.duration, 0);
      this.set(id, {
        output_size: size,
        warnings: JSON.stringify([...m.warnings, ...warnings.filter((w) => !/codec's private data does not match/.test(w))]),
      });

      // Check the result: length = sum of the parts, same tracks as part 1.
      let verify = null;
      const mode = this.settings.get('verifyMode');
      if (this.verifier && mode !== 'off') {
        this.set(id, { phase: 'verifying', progress: 0 });
        this.emit(id);
        const first = parts[0].tracks;
        verify = await this.verifier.verify({
          output: m.output,
          sourceLength: total,
          sourceLabel: 'parts',
          expected: {
            found: true,
            audioTracks: countOf(first, 'audio'),
            subtitleTracks: countOf(first, 'subtitle'),
            burnedSubtitles: 0,
            decoderErrors: 0,
          },
          mode,
          nice: this.settings.get('niceLevel'),
          onChild: (c) => (active.child = c),
          isStopped: () => active.cancelled,
          onProgress: (p) => {
            if (Date.now() - last > 800) {
              last = Date.now();
              this.events.emit('progress', { mergeId: id, progress: p, phase: 'verifying' });
            }
          },
        });
      }

      let removed = false;
      if (m.options.removeParts && verify?.status !== 'error' && verify?.status !== 'skipped') {
        for (const f of m.parts) await fs.rm(f, { force: true });
        removed = true;
        this.db.prepare('UPDATE jobs SET rename_note = ? WHERE output_path IN (SELECT value FROM json_each(?))')
          .run(`Merged into ${path.basename(m.output)}; this part was removed`, JSON.stringify(m.parts));
        this.events.emit('jobs');
      }
      this.set(id, {
        status: 'done',
        phase: null,
        progress: 1,
        finished_at: Date.now(),
        verify_status: verify?.status ?? null,
        verify: verify ? JSON.stringify(verify) : null,
        parts_removed: removed ? 1 : 0,
      });
      this.log.info(`Merge ${id}: ${m.parts.length} parts -> ${m.output}`);
    } catch (err) {
      await fs.rm(part, { force: true }).catch(() => {});
      this.set(id, {
        status: err.cancelled ? 'cancelled' : 'failed',
        phase: null,
        error: err.cancelled ? null : err.message,
        finished_at: Date.now(),
      });
    } finally {
      await fs.rm(chaptersFile, { force: true }).catch(() => {});
      this.active = null;
      this.emit(id);
    }
  }
}

function cleanName(name) {
  const n = sanitizeFileName(String(name ?? '').replace(/\.mkv$/i, ''));
  if (!n) throw badRequest('Give the merged file a name');
  return n;
}

async function uniqueMkv(p, sep = '_') {
  const { dir, name } = path.parse(p);
  let candidate = p;
  const exists = (f) => fs.access(f).then(() => true, () => false);
  for (let i = 1; (await exists(candidate)) || (await exists(`${candidate}.part`)); i++) {
    candidate = path.join(dir, `${name}${sep}${i}.mkv`);
  }
  return candidate;
}
