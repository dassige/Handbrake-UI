import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { isInside } from './paths.js';
import { VERIFY_MODES } from './verify.js';

export const OUTPUT_LAYOUTS = ['parent', 'mirror', 'flat'];

export const DEFAULT_VIDEO_EXTENSIONS = [
  'mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'flv', 'webm', 'vob', '3gp', 'divx', 'ogm',
];

function defaults(config) {
  return {
    sourceRoot: config.initialSourceRoot,
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
  };
}

export class Settings {
  constructor(db, config) {
    this.db = db;
    this.values = defaults(config);
    for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
      if (key in this.values) this.values[key] = JSON.parse(value);
    }
    // Normalise separators and trailing slashes so path comparisons work.
    this.values.sourceRoot = path.resolve(this.values.sourceRoot);
    this.values.targetRoot = path.resolve(this.values.targetRoot);
    this.upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
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

    for (const key of ['sourceRoot', 'targetRoot']) {
      if (typeof next[key] !== 'string' || !path.isAbsolute(next[key])) {
        throw badRequest(`${key} must be an absolute path`);
      }
      next[key] = path.resolve(next[key]);
      const stat = await fs.stat(next[key]).catch(() => null);
      if (!stat?.isDirectory()) throw badRequest(`${key} is not an existing folder: ${next[key]}`);
    }
    if (next.sourceRoot === next.targetRoot) {
      throw badRequest('Source and target folders must be different');
    }
    if (isInside(next.sourceRoot, next.targetRoot)) {
      throw badRequest('The target folder cannot be inside the source folder');
    }
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

function cleanList(value, name) {
  if (!Array.isArray(value)) throw badRequest(`${name} must be a list`);
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
}
