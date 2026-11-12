// Finds the subtitle files that come with a video ("sidecars"):
//   Movie.srt, Movie.en.srt, Movie.ita.forced.srt   same folder, named after the video
//   Subs/2_English.srt                               a Subs folder next to the only video
//   Subs/Movie/3_Italian.srt                         a folder per episode (TV packs)
//   english.srt                                      the only video in the folder: any subtitle
// When several videos share a prefix ("Movie" and "Movie Extended"), a file belongs to the
// longest name it starts with.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readTags } from './languages.js';

// .sub alone may be MicroDVD text or VobSub pictures: it is only taken as the data file of an .idx.
export const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt', 'idx', 'sup'];
export const KNOWN_SUBTITLE_EXTENSIONS = DEFAULT_SUBTITLE_EXTENSIONS;
const SUBS_DIRS = new Set(['subs', 'subtitles', 'sub', 'subtitle', 'sottotitoli', 'untertitel']);
const SEP = /[.\s_-]/;

export const extOf = (name) => path.extname(name).slice(1).toLowerCase();
export const baseOf = (name) => name.slice(0, name.length - path.extname(name).length);

/** The longest video base name that a subtitle's base name starts with (then a separator or the end). */
export function ownerOf(subBase, videoBases) {
  const s = subBase.toLowerCase();
  let best = null;
  for (const v of videoBases) {
    const b = v.toLowerCase();
    if ((s === b || (s.startsWith(b) && SEP.test(s[b.length]))) && (best == null || b.length > best.length)) best = v;
  }
  return best;
}

const readDir = (dir) => fs.readdir(dir, { withFileTypes: true }).catch(() => []);
const hidden = (name) => name.startsWith('.') || name.startsWith('@');

/**
 * Subtitle files for every video in dir. entries: the folder's Dirents when already read.
 * Returns Map(video file name → [{ path, name, format, match, lang, forced, sdh, default, extra }]),
 * name relative to dir; extra: the .sub data file of an .idx.
 */
export async function scanFolder(dir, { extensions = DEFAULT_SUBTITLE_EXTENSIONS, isVideo, entries } = {}) {
  entries ??= await readDir(dir);
  const exts = new Set(extensions.filter((e) => e !== 'sub'));
  const videos = entries.filter((e) => e.isFile() && isVideo(e.name) && !hidden(e.name)).map((e) => e.name);
  const out = new Map(videos.map((v) => [v, []]));
  if (!videos.length) return out;
  const vbases = [...new Set(videos.map(baseOf))];
  const videosWith = (base) => videos.filter((v) => baseOf(v) === base);
  const subsIn = (list) => list.filter((e) => e.isFile() && !hidden(e.name) && exts.has(extOf(e.name)));

  const add = (targets, folder, list, e, rest, match) => {
    const format = extOf(e.name);
    const extra = [];
    if (format === 'idx') {
      const data = list.find((x) => x.isFile() && baseOf(x.name) === baseOf(e.name) && extOf(x.name) === 'sub');
      if (!data) return; // pictures missing: nothing usable
      extra.push(path.join(folder, data.name));
    }
    const full = path.join(folder, e.name);
    for (const v of targets) {
      out.get(v).push({ path: full, name: path.relative(dir, full), format, match, ...readTags(rest), extra });
    }
  };

  for (const e of subsIn(entries)) {
    const b = baseOf(e.name);
    const owner = ownerOf(b, vbases);
    if (owner != null) add(videosWith(owner), dir, entries, e, b.slice(owner.length), 'name');
    else if (videos.length === 1) add(videos, dir, entries, e, b, 'folder');
  }

  for (const d of entries.filter((e) => e.isDirectory() && SUBS_DIRS.has(e.name.toLowerCase()))) {
    const sdir = path.join(dir, d.name);
    const inner = await readDir(sdir);
    for (const e of subsIn(inner)) {
      const b = baseOf(e.name);
      const owner = ownerOf(b, vbases);
      if (owner != null) add(videosWith(owner), sdir, inner, e, b.slice(owner.length), 'subs');
      else if (videos.length === 1) add(videos, sdir, inner, e, b, 'subs');
    }
    for (const sd of inner.filter((e) => e.isDirectory())) {
      const owner = vbases.find((v) => v.toLowerCase() === sd.name.toLowerCase());
      if (owner == null) continue;
      const epDir = path.join(sdir, sd.name);
      const files = await readDir(epDir);
      for (const e of subsIn(files)) add(videosWith(owner), epDir, files, e, baseOf(e.name), 'subs');
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The sidecars of one video, with their sizes. */
export async function findSidecars(videoPath, opts) {
  const list = (await scanFolder(path.dirname(videoPath), opts)).get(path.basename(videoPath)) ?? [];
  await Promise.all(list.map(async (s) => {
    s.size = await fs.stat(s.path).then((st) => st.size, () => null);
  }));
  return list;
}

/**
 * Subtitle files named after a video in the same folder (for renaming and deleting them with it):
 * [{ path, suffix }] where suffix is what follows the video's base name (".en.forced.srt").
 * names: the file names in the video's folder.
 */
export function companionsOf(videoPath, names, options) {
  return companionsByVideo(path.dirname(videoPath), names, options).get(baseOf(path.basename(videoPath))) ?? [];
}

/**
 * The companions of every video in one folder, from the folder's names, in one pass:
 * Map(video base name → [{ path, suffix }]). Renaming many videos of a folder asks this once.
 */
export function companionsByVideo(dir, names, { extensions = DEFAULT_SUBTITLE_EXTENSIONS, isVideo }) {
  const exts = new Set([...extensions, ...(extensions.includes('idx') ? ['sub'] : [])]);
  const vbases = [...new Set(names.filter((n) => isVideo(n)).map(baseOf))];
  const idxBases = new Set(names.filter((n) => extOf(n) === 'idx').map(baseOf));
  const out = new Map();
  for (const n of names) {
    if (hidden(n) || isVideo(n) || !exts.has(extOf(n))) continue;
    if (extOf(n) === 'sub' && !idxBases.has(baseOf(n))) continue;
    const owner = ownerOf(baseOf(n), vbases);
    if (owner == null) continue;
    if (!out.has(owner)) out.set(owner, []);
    out.get(owner).push({ path: path.join(dir, n), suffix: n.slice(owner.length) });
  }
  return out;
}
