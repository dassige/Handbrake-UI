import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { badRequest } from './errors.js';
import { parseName, sanitizeFileName, tokenize } from './rename/parse.js';

/** True when child is root itself or somewhere below it (lexical check). */
export function isInside(root, child) {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves a user-supplied absolute path and checks that it really lives under
 * root, following symlinks so a link cannot escape the root.
 */
export async function resolveUnder(root, p) {
  if (typeof p !== 'string' || !p) throw badRequest('Missing path');
  const abs = path.resolve(p);
  if (!isInside(root, abs)) throw badRequest(`Path is outside ${root}: ${p}`);
  const [realRoot, realPath] = await Promise.all([
    fs.realpath(root),
    fs.realpath(abs).catch(() => null),
  ]);
  if (!realPath) throw badRequest(`Path not found: ${p}`);
  if (!isInside(realRoot, realPath)) throw badRequest(`Path is outside ${root}: ${p}`);
  return abs;
}

/** The root (of several) that contains p, preferring the deepest one; null when none does. */
export function rootOf(roots, p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(p);
  let best = null;
  for (const r of roots ?? []) if (isInside(r, abs) && (!best || r.length > best.length)) best = r;
  return best;
}

/** Like resolveUnder, but the path may be under any of several roots. Returns { root, path }. */
export async function resolveUnderAny(roots, p) {
  if (typeof p !== 'string' || !p) throw badRequest('Missing path');
  const root = rootOf(roots, p);
  if (!root) throw badRequest(`Path is outside the configured folders: ${p}`);
  return { root, path: await resolveUnder(root, p) };
}

const SKIP_DIRS = new Set(['@eaDir', '#recycle', '#snapshot', '.Trash-1000', 'lost+found']);

export function isHiddenName(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name);
}

export function makeFileMatcher(settings) {
  const exts = new Set(settings.get('videoExtensions'));
  const patterns = settings.get('excludePatterns').map(
    (p) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`, 'i'),
  );
  const excluded = (name) => patterns.some((re) => re.test(name));
  return {
    isVideo: (name) => exts.has(path.extname(name).slice(1).toLowerCase()),
    excluded,
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a, b) => collator.compare(a, b);

/**
 * Lists video files under dir (recursively when asked), in natural order.
 * onDir(found, dir) is called after each folder is read (for progress); when signal.aborted
 * turns true the walk stops with an error whose code is 'ABORTED'.
 */
export async function collectVideos(dir, { recursive, matcher, onDir = null, signal = null }) {
  const out = [];
  async function walk(current) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { code: 'ABORTED' });
    const entries = await fs.readdir(current, { withFileTypes: true });
    onDir?.(out.length, current);
    entries.sort((a, b) => naturalCompare(a.name, b.name));
    for (const e of entries) {
      if (isHiddenName(e.name) || matcher.excluded(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (recursive) await walk(full);
      } else if (e.isFile() && matcher.isVideo(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

// HandBrake's container names: the muxers (av_*) and the generic names newer presets may use.
const FORMAT_EXT = {
  av_mkv: '.mkv', mkv: '.mkv', libmkv: '.mkv',
  av_mp4: '.mp4', mp4: '.mp4', mp4v2: '.mp4', m4v: '.m4v',
  av_webm: '.webm', webm: '.webm',
  av_mov: '.mov', mov: '.mov',
};

export function extensionForFormat(format) {
  return FORMAT_EXT[format] ?? '.mkv';
}

const SEASON_WORD = '(?:seasons?|stagion[ei]|staffel[n]?|saisons?|temporadas?)';
// "S01", "Season 1", "Stagione 1"... as a word of the (tokenized) folder name.
const FOLDER_SEASON = [
  /(?:^| )S(\d{1,2})(?= |$)/i,
  new RegExp(`(?:^| )${SEASON_WORD} ?(\\d{1,2})(?= |$)`, 'i'),
];
// An episode's own folder ("Show.S01E05.1080p") also names its season.
const FOLDER_EPISODE = /(?:^| )S(\d{1,2}) ?E\d{1,3}/i;
// Several seasons in one folder: "S01-S03", "S01-03", "Seasons 1-3".
const FOLDER_SEASONS = new RegExp(`(?:^| )(?:S\\d{1,2} ?- ?S?\\d{1,2}|${SEASON_WORD} ?\\d{1,2} ?- ?\\d{1,2})(?= |$)`, 'i');

/** "Show 2019" / "Show (2019)" -> "Show (2019)"; trims separators. */
function cleanShowName(s) {
  const show = s.replace(/^[\s\-–—:,.]+|[\s\-–—:,.(]+$/g, '').trim();
  const y = /^(.+?)\s+\(?((?:19|20)\d\d)\)?$/.exec(show);
  return sanitizeFileName(y ? `${y[1]} (${y[2]})` : show);
}

/**
 * For the 'season' layout: the show and season folders ("Show", "S01") of a source in
 * relDir (relative to its sources folder), or null when its folder isn't a season folder.
 * The show is the folder text before the season ("Show.S01.1080p" -> "Show"), or the
 * folder above for a bare "Season 1" / "S01" folder.
 */
export function seasonFolders(relDir, fileBase) {
  const parts = relDir.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return null;
  const folder = tokenize(parts[parts.length - 1]);
  let m = null;
  let season = null;
  if (FOLDER_SEASONS.test(folder)) {
    // A multi-season folder: the file's own S01E02 marker says which season.
    m = FOLDER_SEASONS.exec(folder);
    const ep = parseName(fileBase, { mode: 'tv' });
    if (ep.season == null) return null;
    season = ep.season;
  } else {
    m = FOLDER_EPISODE.exec(folder);
    for (const re of FOLDER_SEASON) m ??= re.exec(folder);
    if (!m) return null;
    season = Number(m[1]);
  }
  let show = cleanShowName(folder.slice(0, m.index));
  if (!show && parts.length > 1) show = sanitizeFileName(parts[parts.length - 2]);
  if (!show) return null;
  return [show, `S${String(season).padStart(2, '0')}`];
}

/** Where a source file should be written, before collision handling. */
export function plannedOutputPath(source, settings, format) {
  const sourceRoot = rootOf(settings.get('sourceRoots'), source);
  const targetRoot = settings.get('targetRoot');
  const { name: base } = path.parse(source);
  const name = base + extensionForFormat(format);
  const relDir = sourceRoot ? path.relative(sourceRoot, path.dirname(source)) : '';
  const layout = settings.get('outputLayout');
  let dir = targetRoot;
  if (sourceRoot && relDir) {
    const season = layout === 'season' ? seasonFolders(relDir, base) : null;
    if (season) dir = path.join(targetRoot, ...season);
    else if (layout === 'mirror') dir = path.join(targetRoot, relDir);
    else if (layout === 'parent' || layout === 'season') dir = path.join(targetRoot, path.basename(relDir));
  }
  return path.join(dir, name);
}

const exists = (p) => fs.access(p).then(() => true, () => false);

/** Returns p, or "name (1).ext", "name (2).ext"... if p (or its .part) already exists. */
export async function uniquePath(p) {
  const { dir, name, ext } = path.parse(p);
  let candidate = p;
  for (let i = 1; (await exists(candidate)) || (await exists(candidate + '.part')); i++) {
    candidate = path.join(dir, `${name} (${i})${ext}`);
  }
  return candidate;
}

/**
 * Copies a file's bytes to a new file. Not fs.copyFile: that also gives the copy the source's
 * mode (fchmod), which NFS shares that map users to another owner (Synology) refuse with
 * EPERM, so the copy failed although the file could be written.
 */
export async function copyBytes(from, to, onProgress = null) {
  const read = createReadStream(from, { highWaterMark: 1 << 20 });
  if (onProgress) {
    let done = 0;
    read.on('data', (chunk) => onProgress((done += chunk.length)));
  }
  await pipeline(read, createWriteStream(to));
}
