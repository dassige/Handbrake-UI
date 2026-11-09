import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { isInside } from './paths.js';
import { VERIFY_MODES } from './verify.js';
import { DEFAULT_QUALITY, normalizeQuality } from './quality.js';

export const MAX_SOURCE_ROOTS = 20;

export const OUTPUT_LAYOUTS = ['parent', 'mirror', 'flat'];

export const DEFAULT_VIDEO_EXTENSIONS = [
  'mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'flv', 'webm', 'vob', '3gp', 'divx', 'ogm',
];

function defaults(config) {
  return {
    sourceRoots: [config.initialSourceRoot],
    // Sources folders whose files can't be deleted from the app (e.g. still seeding).
    protectedRoots: [],
    targetRoot: config.initialTargetRoot,
    outputLayout: 'parent',
    recursive: true,
    skipConverted: true,
    videoExtensions: DEFAULT_VIDEO_EXTENSIONS,
    excludePatterns: ['sample'],
    niceLevel: 10,
    defaultPresetId: null,
    // The queue never starts by itself: Start is always manual.
    queueRunning: false,
    autoRename: false,
    autoRenameRuleId: null,
    renameSeparator: '_',
    verifyMode: 'full',
    quality: DEFAULT_QUALITY,
  };
}

export class Settings {
  constructor(db, config) {
    this.db = db;
    this.values = defaults(config);
    this.upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const stored = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]));
    // Before 1.1 there was a single source folder.
    if (typeof stored.sourceRoot === 'string' && !stored.sourceRoots) {
      stored.sourceRoots = [stored.sourceRoot];
      this.upsert.run('sourceRoots', JSON.stringify(stored.sourceRoots));
      db.prepare(`DELETE FROM settings WHERE key = 'sourceRoot'`).run();
    }
    for (const [key, value] of Object.entries(stored)) {
      if (key in this.values) this.values[key] = value;
    }
    // Criteria added in later versions take their defaults.
    this.values.quality = { ...DEFAULT_QUALITY, ...this.values.quality, minKbps: { ...DEFAULT_QUALITY.minKbps, ...this.values.quality?.minKbps } };
    // Normalise separators and trailing slashes so path comparisons work.
    this.values.sourceRoots = this.values.sourceRoots.map((r) => path.resolve(r));
    this.values.protectedRoots = this.values.protectedRoots.map((r) => path.resolve(r));
    this.values.targetRoot = path.resolve(this.values.targetRoot);
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  /** Saves without validation (internal use). */
  set(key, value) {
    this.values[key] = value;
    this.upsert.run(key, JSON.stringify(value));
  }

  /** Validates and saves a partial update coming from the UI. */
  async update(patch) {
    const next = { ...this.values };
    const known = Object.keys(this.values);
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (!known.includes(key)) throw badRequest(`Unknown setting: ${key}`);
      next[key] = value;
    }

    if (!Array.isArray(next.sourceRoots) || !next.sourceRoots.length) throw badRequest('At least one sources folder is required');
    if (next.sourceRoots.length > MAX_SOURCE_ROOTS) throw badRequest(`At most ${MAX_SOURCE_ROOTS} sources folders`);
    next.sourceRoots = [...new Set(await Promise.all(next.sourceRoots.map((r) => existingFolder(r, 'Sources folder'))))];
    next.targetRoot = await existingFolder(next.targetRoot, 'Target folder');
    for (const root of next.sourceRoots) {
      if (root === next.targetRoot) throw badRequest(`The target folder cannot also be a sources folder: ${root}`);
      if (isInside(root, next.targetRoot)) throw badRequest(`The target folder cannot be inside the sources folder ${root}`);
      const outer = next.sourceRoots.find((r) => r !== root && isInside(r, root));
      if (outer) throw badRequest(`${root} is already inside the sources folder ${outer}`);
    }
    if (!Array.isArray(next.protectedRoots)) throw badRequest('protectedRoots must be a list');
    // Only folders that are in the list; a removed folder loses its flag.
    next.protectedRoots = [...new Set(next.protectedRoots.map((r) => path.resolve(String(r).trim())))]
      .filter((r) => next.sourceRoots.includes(r));
    next.quality = normalizeQuality(next.quality);
    if (!OUTPUT_LAYOUTS.includes(next.outputLayout)) {
      throw badRequest(`outputLayout must be one of ${OUTPUT_LAYOUTS.join(', ')}`);
    }
    if (!VERIFY_MODES.includes(next.verifyMode)) throw badRequest(`verifyMode must be one of ${VERIFY_MODES.join(', ')}`);
    if (next.autoRenameRuleId != null) {
      next.autoRenameRuleId = Number(next.autoRenameRuleId);
      if (!Number.isInteger(next.autoRenameRuleId)) throw badRequest('autoRenameRuleId must be a rule set id');
    }
    if (typeof next.renameSeparator !== 'string' || next.renameSeparator.length > 3 || /[/\\]/.test(next.renameSeparator)) {
      throw badRequest('renameSeparator must be at most 3 characters, without slashes');
    }
    for (const key of ['recursive', 'skipConverted', 'queueRunning', 'autoRename']) {
      if (typeof next[key] !== 'boolean') throw badRequest(`${key} must be true or false`);
    }
    next.videoExtensions = cleanList(next.videoExtensions, 'videoExtensions')
      .map((e) => e.replace(/^\./, '').toLowerCase());
    if (!next.videoExtensions.length) throw badRequest('At least one video extension is required');
    next.excludePatterns = cleanList(next.excludePatterns, 'excludePatterns');
    next.niceLevel = Number(next.niceLevel);
    if (!Number.isInteger(next.niceLevel) || next.niceLevel < 0 || next.niceLevel > 19) {
      throw badRequest('niceLevel must be a whole number between 0 and 19');
    }

    for (const key of known) {
      if (JSON.stringify(next[key]) !== JSON.stringify(this.values[key])) this.set(key, next[key]);
    }
    return this.all();
  }
}

async function existingFolder(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw badRequest(`${label} must be an absolute path: ${value}`);
  const abs = path.resolve(value.trim());
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) throw badRequest(`${label} is not an existing folder: ${abs}`);
  return abs;
}

function cleanList(value, name) {
  if (!Array.isArray(value)) throw badRequest(`${name} must be a list`);
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
}
