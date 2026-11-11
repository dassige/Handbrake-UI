import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { isInside } from './paths.js';
import { VERIFY_MODES } from './verify.js';
import { DEFAULT_QUALITY, normalizeQuality } from './quality.js';
import { DEFAULT_SCHEDULE, normalizeSchedule } from './schedule.js';
import { DEFAULT_WATCH, normalizeWatch } from './watch.js';
import { DEFAULT_BACKUP_SCHEDULE, normalizeBackupSchedule } from './backupSchedule.js';
import { DEFAULT_NOTIFICATIONS, mergeNotifications, normalizeNotifications, publicNotifications } from './notify.js';

export const MAX_SOURCE_ROOTS = 20;

export const OUTPUT_LAYOUTS = ['parent', 'mirror', 'flat'];

// Web app language; 'auto' follows each browser's language. Notifications stay in English.
export const LANGUAGES = ['auto', 'en', 'it', 'de', 'fr', 'es'];

export const DEFAULT_VIDEO_EXTENSIONS = [
  'mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'flv', 'webm', 'vob', '3gp', 'divx', 'ogm',
];

function defaults(config) {
  return {
    sourceRoots: [config.initialSourceRoot],
    // Sources folders whose files can't be deleted from the app (e.g. still seeding).
    protectedRoots: [],
    // Friendly names shown instead of the paths: { "/mnt/downloads": "Downloads" }.
    sourceNames: {},
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
    schedule: DEFAULT_SCHEDULE,
    watch: DEFAULT_WATCH,
    notifications: DEFAULT_NOTIFICATIONS,
    backupSchedule: DEFAULT_BACKUP_SCHEDULE,
    language: 'auto',
  };
}

export class Settings {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.reload();
  }

  /** (Re)reads every setting from the database, e.g. after a restore. */
  reload() {
    const { db } = this;
    this.values = defaults(this.config);
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
    this.values.schedule = { ...DEFAULT_SCHEDULE, ...this.values.schedule };
    this.values.watch = { ...DEFAULT_WATCH, ...this.values.watch };
    this.values.notifications = mergeNotifications(this.values.notifications);
    this.values.backupSchedule = { ...DEFAULT_BACKUP_SCHEDULE, ...this.values.backupSchedule };
    // Normalise separators and trailing slashes so path comparisons work.
    this.values.sourceRoots = this.values.sourceRoots.map((r) => path.resolve(r));
    this.values.protectedRoots = this.values.protectedRoots.map((r) => path.resolve(r));
    this.values.targetRoot = path.resolve(this.values.targetRoot);
    this.values.sourceNames = Object.fromEntries(
      Object.entries(this.values.sourceNames ?? {}).map(([k, v]) => [path.resolve(k), v]).filter(([k]) => this.values.sourceRoots.includes(k)),
    );
  }

  get(key) {
    return this.values[key];
  }

  all() {
    return { ...this.values };
  }

  /** What the browser gets: everything but the e-mail password. */
  public() {
    return { ...this.values, notifications: publicNotifications(this.values.notifications) };
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
    next.sourceNames = normalizeNames(next.sourceNames, next.sourceRoots);
    next.quality = normalizeQuality(next.quality);
    try {
      next.schedule = normalizeSchedule(next.schedule);
    } catch (err) {
      throw badRequest(err.message);
    }
    next.watch = await normalizeWatch(next.watch, next.sourceRoots);
    next.notifications = normalizeNotifications(next.notifications, this.values.notifications);
    next.backupSchedule = await normalizeBackupSchedule(next.backupSchedule);
    if (!OUTPUT_LAYOUTS.includes(next.outputLayout)) {
      throw badRequest(`outputLayout must be one of ${OUTPUT_LAYOUTS.join(', ')}`);
    }
    if (!LANGUAGES.includes(next.language)) throw badRequest(`language must be one of ${LANGUAGES.join(', ')}`);
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

export const MAX_NAME = 40;

/** Friendly names for the sources folders: only listed folders, trimmed, unique, none empty. */
function normalizeNames(names, roots) {
  if (names == null) return {};
  if (typeof names !== 'object' || Array.isArray(names)) throw badRequest('sourceNames must be an object');
  const out = {};
  const used = new Map();
  for (const [key, value] of Object.entries(names)) {
    const root = path.resolve(String(key).trim());
    if (!roots.includes(root)) continue;
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > MAX_NAME) throw badRequest(`A folder name can be at most ${MAX_NAME} characters: ${name}`);
    const lower = name.toLowerCase();
    if (used.has(lower)) throw badRequest(`Two sources folders are both called "${name}"`);
    used.set(lower, root);
    out[root] = name;
  }
  return out;
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
