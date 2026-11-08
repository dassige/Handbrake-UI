import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';

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

/** Lists video files under dir (recursively when asked), in natural order. */
export async function collectVideos(dir, { recursive, matcher }) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
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

const FORMAT_EXT = { av_mkv: '.mkv', av_mp4: '.mp4', av_webm: '.webm' };

export function extensionForFormat(format) {
  return FORMAT_EXT[format] ?? '.mkv';
}

/** Where a source file should be written, before collision handling. */
export function plannedOutputPath(source, settings, format) {
  const sourceRoot = settings.get('sourceRoot');
  const targetRoot = settings.get('targetRoot');
  const name = path.parse(source).name + extensionForFormat(format);
  const relDir = path.relative(sourceRoot, path.dirname(source));
  let dir = targetRoot;
  if (relDir && isInside(sourceRoot, source)) {
    if (settings.get('outputLayout') === 'mirror') dir = path.join(targetRoot, relDir);
    else if (settings.get('outputLayout') === 'parent') dir = path.join(targetRoot, path.basename(relDir));
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
