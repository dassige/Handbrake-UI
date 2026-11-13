// Sidecar subtitles of queue jobs: found when a job is added and again when it starts, embedded
// during the encode (text: HandBrakeCLI --srt-file/--ssa-file; pictures: mkvmerge afterwards,
// MKV only) and copied next to the output. The source files are never changed: edits made in
// the Subtitles tab are applied to the copies HandBrake gets and to the files written to the
// target folder.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from '../errors.js';
import { copyBytes, makeFileMatcher } from '../paths.js';
import { companionsByVideo, companionsOf, findSidecars, scanFolder } from './detect.js';
import { langFromWord } from './languages.js';
import { effectiveModes, handbrakeArgs, planSubtitles, targetName } from './plan.js';
import {
  applyEdits, decode, hasTextEdits, IMAGE_FORMATS, normalizeEdits, parse, serialize, toSrt, TEXT_FORMATS,
} from './text.js';

const MAX_CUES = 20_000;

/** A sidecar as stored with the job: what was found, plus the choices made in the Subtitles tab. */
function fromDetected(d) {
  return {
    path: d.path,
    name: d.name,
    format: d.format,
    match: d.match,
    size: d.size ?? null,
    extra: d.extra ?? [],
    detected: { lang: d.lang, forced: d.forced, sdh: d.sdh },
    include: true,
    lang: d.lang,
    forced: d.forced,
    sdh: d.sdh,
    edits: {},
  };
}

/** Found again: keeps the user's choices for files that are still there. */
export function mergeSidecars(old, detected) {
  const byPath = new Map((old ?? []).map((f) => [f.path, f]));
  return detected.map((d) => {
    const fresh = fromDetected(d);
    const prev = byPath.get(d.path);
    if (!prev) return fresh;
    return { ...fresh, include: prev.include, lang: prev.lang, forced: prev.forced, sdh: prev.sdh, edits: prev.edits ?? {} };
  });
}

export class Subtitles {
  constructor({ settings, tmpDir, mkvmerge = 'mkvmerge', log }) {
    this.settings = settings;
    this.tmpDir = tmpDir;
    this.mkvmerge = mkvmerge;
    this.log = log;
  }

  options() {
    return { extensions: this.settings.get('subtitleExtensions'), isVideo: makeFileMatcher(this.settings).isVideo };
  }

  enabled() {
    return this.settings.get('subtitleExtensions').length > 0;
  }

  /** The sidecars of a source video, merged with the choices already made for it. */
  async detect(videoPath, previous = null) {
    if (!this.enabled()) return [];
    return mergeSidecars(previous, await findSidecars(videoPath, this.options()));
  }

  /** For the source browser: languages and flags of each video's sidecars in one folder. */
  async folderSummary(dir, entries) {
    if (!this.enabled()) return new Map();
    const map = await scanFolder(dir, { ...this.options(), entries });
    return new Map([...map].filter(([, l]) => l.length).map(([v, l]) => [v, l.map((s) => ({ lang: s.lang, forced: s.forced, sdh: s.sdh, format: s.format }))]));
  }

  /** Subtitle files named after a video in its folder (renaming and deleting take them along). */
  async companions(videoPath) {
    if (!this.enabled()) return [];
    const names = await fs.readdir(path.dirname(videoPath)).catch(() => []);
    return companionsOf(videoPath, names, this.options());
  }

  /**
   * The companions of every video in a folder: Map(video base name → [{ path, suffix }]).
   * The folder is read once, however many of its videos are renamed.
   */
  async companionsInFolder(dir) {
    if (!this.enabled()) return new Map();
    const names = await fs.readdir(dir).catch(() => []);
    return companionsByVideo(dir, names, this.options());
  }

  /** Every sidecar of a source video (for deleting it), with the .sub data of .idx files. */
  async sidecarPaths(videoPath) {
    if (!this.enabled()) return [];
    const list = await findSidecars(videoPath, this.options());
    return [...new Set(list.flatMap((s) => [s.path, ...s.extra]))];
  }

  // ---------------------------------------------------------------- per-job choices

  /** Validates a change from the Subtitles tab. Returns the new list of sidecars. */
  applyChanges(files, changes) {
    if (!Array.isArray(changes)) throw badRequest('files must be a list');
    const byPath = new Map(changes.map((c) => [c?.path, c]));
    return (files ?? []).map((f) => {
      const c = byPath.get(f.path);
      if (!c) return f;
      const next = { ...f };
      if ('include' in c) next.include = !!c.include;
      if ('lang' in c) {
        const lang = c.lang ? langFromWord(c.lang) : null;
        if (c.lang && !lang) throw badRequest(`Unknown language: ${c.lang}`);
        next.lang = lang;
      }
      if ('forced' in c) next.forced = !!c.forced;
      if ('sdh' in c) next.sdh = !!c.sdh;
      if ('edits' in c) {
        try {
          next.edits = normalizeEdits(c.edits);
        } catch (err) {
          throw badRequest(err.message);
        }
      }
      return next;
    });
  }

  plan(job) {
    const modes = effectiveModes(job, this.settings);
    let preset = null;
    try {
      preset = JSON.parse(job.presetJson ?? 'null')?.PresetList?.[0] ?? null;
    } catch {
      // a broken snapshot: treat as "no subtitles kept"
    }
    return {
      ...modes,
      files: planSubtitles({
        files: job.subtitles, sourceSubs: job.sourceInfo?.subtitles, preset, format: job.format, embed: modes.embed, copy: modes.copy,
      }),
    };
  }

  // ---------------------------------------------------------------- reading with edits

  /** The text of a sidecar with its edits applied: { text, codeset, doc, removed }. */
  async readEdited(file, edits = file.edits ?? {}) {
    const buf = await fs.readFile(file.path);
    const { text, codeset } = decode(buf, { codeset: edits.codeset, fallback: this.settings.get('subtitleCodeset') });
    if (!hasTextEdits(edits)) return { text, codeset, doc: null, removed: 0 };
    const { doc, removed } = applyEdits(parse(text, file.format), edits);
    return { text: serialize(doc), codeset, doc, removed };
  }

  /** For the editor: cues before and after the edits. */
  async preview(file, edits) {
    if (!TEXT_FORMATS.includes(file.format)) return { image: true, format: file.format };
    let clean;
    try {
      clean = normalizeEdits(edits);
    } catch (err) {
      throw badRequest(err.message);
    }
    const buf = await fs.readFile(file.path);
    const { text, codeset } = decode(buf, { codeset: clean.codeset, fallback: this.settings.get('subtitleCodeset') });
    const original = parse(text, file.format);
    const { doc, removed } = applyEdits(original, clean);
    const strip = (cues) => cues.slice(0, MAX_CUES).map((c) => ({ start: c.start, end: c.end, text: c.text, src: c.src }));
    return {
      image: false,
      format: file.format,
      codeset,
      autoCodeset: !clean.codeset,
      original: strip(original.cues.map((c, i) => ({ ...c, src: i }))),
      edited: strip(doc.cues),
      removed,
    };
  }

  // ---------------------------------------------------------------- encoding

  /**
   * Writes the files HandBrake gets and returns { plan, args, images, tmpFiles }:
   * args for HandBrakeCLI, images: picture sidecars to add with mkvmerge after the encode.
   */
  async prepare(job) {
    const plan = this.plan(job);
    const items = [];
    const images = [];
    const tmpFiles = [];
    const notes = [];
    let n = 0;
    for (const f of plan.files.filter((x) => x.embed)) {
      if (IMAGE_FORMATS.includes(f.format)) {
        images.push(f);
        continue;
      }
      try {
        const { text } = await this.readEdited(f);
        // HandBrake reads SRT (VTT is turned into SRT) and SSA/ASS; it splits file lists on commas,
        // so the copies get plain names in the data folder.
        const isAss = f.format === 'ass' || f.format === 'ssa';
        const out = isAss ? text : f.format === 'vtt' ? toSrt(parse(text, 'vtt').cues) : text;
        const tmp = path.join(this.tmpDir, `job-${job.id}-sub-${++n}.${isAss ? f.format : 'srt'}`);
        await fs.writeFile(tmp, out.replace(/^﻿/, ''), 'utf8');
        tmpFiles.push(tmp);
        items.push({ file: f, tmp });
      } catch (err) {
        f.embed = false;
        notes.push({ name: f.name, code: 'readFailed', error: err.message });
      }
    }
    return { plan, args: handbrakeArgs(items), images, tmpFiles, notes };
  }

  /**
   * Adds picture subtitles (VobSub .idx/.sub, PGS .sup) to a finished MKV with mkvmerge.
   * Writes next to the file and replaces it. onChild gets the process (to cancel it).
   */
  async muxImages(file, images, { onChild } = {}) {
    const tmp = `${file}.subs.part`;
    const args = ['-o', tmp, file];
    for (const f of images) {
      if (f.lang) args.push('--language', `0:${f.lang}`);
      args.push('--default-track-flag', `0:${f.forced ? 'yes' : 'no'}`);
      if (f.forced) args.push('--forced-display-flag', '0:yes');
      args.push(f.path);
    }
    await new Promise((resolve, reject) => {
      const child = spawn(this.mkvmerge, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      onChild?.(child);
      let out = '';
      child.stdout.setEncoding('utf8').on('data', (d) => { out = (out + d).slice(-4000); });
      child.stderr.setEncoding('utf8').on('data', (d) => { out = (out + d).slice(-4000); });
      child.on('error', reject);
      // mkvmerge: 0 = ok, 1 = ok with warnings, 2 = error.
      child.on('close', (code) => (code === 0 || code === 1 ? resolve() : reject(new Error(lastError(out) || `mkvmerge exit code ${code}`))));
    }).catch(async (err) => {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    });
    await fs.rename(tmp, file);
  }

  // ---------------------------------------------------------------- copying

  /**
   * Writes the sidecars to copy next to the output (UTF-8, with the edits).
   * previous: the files written last time ("Write again"). Their names are free to be used again,
   * so each copy gets the name its current language and flags give (Video.it.srt becomes
   * Video.en.srt when the language changed); a previous copy that got another name is removed.
   * Previous copies of files not written this time stay, and stay listed.
   * Returns { copied: [{ name, from, to }], errors: [{ name, error }], removed: [paths] }.
   */
  async copy(planFiles, outputPath, { previous = [] } = {}) {
    const dir = path.dirname(outputPath);
    const copied = [];
    const errors = [];
    const subOf = (p) => `${p.slice(0, -4)}.sub`;
    const withData = (p) => (p.endsWith('.idx') ? [p, subOf(p)] : [p]);
    const prev = previous.filter((p) => path.dirname(p.to) === dir);
    const existing = new Set((await fs.readdir(dir).catch(() => [])).map((n) => n.toLowerCase()));
    for (const p of prev) for (const x of withData(p.to)) existing.delete(path.basename(x).toLowerCase());
    for (const f of planFiles.filter((x) => x.copy)) {
      const name = targetName(outputPath, f, existing);
      const to = path.join(dir, name);
      try {
        if (TEXT_FORMATS.includes(f.format)) {
          const { text } = await this.readEdited(f);
          await writeAtomic(to, Buffer.from(text.replace(/^﻿/, ''), 'utf8'));
        } else {
          await copyAtomic(f.path, to);
          if (f.format === 'idx' && f.extra[0]) await copyAtomic(f.extra[0], `${to.slice(0, -4)}.sub`);
        }
        copied.push({ name: f.name, from: f.path, to });
      } catch (err) {
        errors.push({ name: f.name, error: err.message });
      }
    }
    // Previous copies: replaced under another name → removed; not written again → kept.
    const written = new Set(copied.flatMap((c) => withData(c.to)).map((p) => p.toLowerCase()));
    const rewritten = new Set(copied.map((c) => c.from));
    const removed = [];
    for (const p of prev) {
      if (written.has(p.to.toLowerCase())) continue;
      if (!rewritten.has(p.from)) {
        if (await fs.access(p.to).then(() => true, () => false)) copied.push(p);
        continue;
      }
      for (const x of withData(p.to)) {
        if (written.has(x.toLowerCase())) continue;
        await fs.rm(x, { force: true }).then(() => removed.push(x), (err) => this.log?.warn?.(`Could not remove ${x}: ${err.message}`));
      }
    }
    return { copied, errors, removed };
  }
}

async function writeAtomic(to, data) {
  const tmp = path.join(path.dirname(to), `.${path.basename(to)}.hbui-tmp`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, to);
}

async function copyAtomic(from, to) {
  const tmp = path.join(path.dirname(to), `.${path.basename(to)}.hbui-tmp`);
  await copyBytes(from, tmp);
  await fs.rename(tmp, to);
}

function lastError(text) {
  return text.split('\n').reverse().find((l) => /error/i.test(l))?.trim() ?? null;
}
