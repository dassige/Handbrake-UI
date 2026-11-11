import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, notFound } from '../errors.js';
import { collectVideos, makeFileMatcher, resolveUnder } from '../paths.js';
import { sanitizeFileName } from './parse.js';
import { importAren, normalizeSteps, runSteps } from './steps.js';

const MAX_FILES = 5000;

const BUILTINS = [
  {
    name: 'Auto: TV series and movies',
    description: 'Recognises episodes (S01E02, 1x02) and movies (title + year); removes release tags.',
    steps: [{ type: 'smart', mode: 'auto' }],
  },
  {
    name: 'TV series',
    description: 'Show S01e02 - Episode title',
    steps: [{ type: 'smart', mode: 'tv' }],
  },
  {
    name: 'Movies',
    description: 'Title (Year)',
    steps: [{ type: 'smart', mode: 'movie' }],
  },
];

const EXPORT_TYPE = 'handbrake-ui-rename-rules';

function splitName(fileName) {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? [fileName.slice(0, i), fileName.slice(i + 1)] : [fileName, ''];
}

const joinName = (base, ext) => (ext ? `${base}.${ext}` : base);

function rowToRule(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    steps: JSON.parse(r.steps),
    builtin: !!r.builtin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class Renamer {
  constructor({ db, settings, events, log }) {
    this.db = db;
    this.settings = settings;
    this.events = events;
    this.log = log;
    this.seed();
  }

  seed() {
    const has = this.db.prepare('SELECT COUNT(*) AS n FROM rename_rules WHERE builtin = 1').get().n;
    if (has) return;
    const now = Date.now();
    const insert = this.db.prepare(
      'INSERT INTO rename_rules (name, description, steps, builtin, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    );
    for (const b of BUILTINS) insert.run(b.name, b.description, JSON.stringify(normalizeSteps(b.steps)), now, now);
  }

  // ---------------------------------------------------------------- rule sets

  listRules() {
    return this.db.prepare('SELECT * FROM rename_rules ORDER BY builtin DESC, id').all().map(rowToRule);
  }

  getRule(id) {
    const r = this.db.prepare('SELECT * FROM rename_rules WHERE id = ?').get(id);
    if (!r) throw notFound(`Rename rule set ${id} not found`);
    return rowToRule(r);
  }

  createRule({ name, description = '', steps }) {
    if (!String(name ?? '').trim()) throw badRequest('The rule set needs a name');
    const clean = normalizeSteps(steps);
    const now = Date.now();
    const r = this.db
      .prepare('INSERT INTO rename_rules (name, description, steps, builtin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(String(name).trim(), String(description), JSON.stringify(clean), now, now);
    this.events.emit('renameRules');
    return this.getRule(Number(r.lastInsertRowid));
  }

  updateRule(id, { name, description, steps }) {
    const rule = this.getRule(id);
    if (rule.builtin) throw conflict('Built-in rule sets cannot be changed; duplicate it first');
    if (name != null && !String(name).trim()) throw badRequest('The rule set needs a name');
    this.db
      .prepare('UPDATE rename_rules SET name = ?, description = ?, steps = ?, updated_at = ? WHERE id = ?')
      .run(
        name != null ? String(name).trim() : rule.name,
        description != null ? String(description) : rule.description,
        JSON.stringify(steps != null ? normalizeSteps(steps) : rule.steps),
        Date.now(),
        id,
      );
    this.events.emit('renameRules');
    return this.getRule(id);
  }

  deleteRule(id) {
    const rule = this.getRule(id);
    if (rule.builtin) throw conflict('Built-in rule sets cannot be deleted');
    this.db.prepare('DELETE FROM rename_rules WHERE id = ?').run(id);
    if (this.settings.get('autoRenameRuleId') === id) this.settings.set('autoRenameRuleId', null);
    this.events.emit('renameRules');
  }

  /** Imports an Advanced Renamer .aren preset or a rule set exported by this app. */
  importRule(fileName, content) {
    if (typeof content !== 'string' || !content.trim()) throw badRequest('Empty file');
    const baseName = String(fileName ?? 'Imported').replace(/\.[^.]+$/, '');
    let data = null;
    try {
      data = JSON.parse(content);
    } catch {
      // not JSON: try Advanced Renamer
    }
    if (data) {
      if (data.type !== EXPORT_TYPE) throw badRequest('Unknown JSON file: expected a rename rule set exported from this app');
      return { rule: this.createRule({ name: data.name || baseName, description: data.description, steps: data.steps }), skipped: [] };
    }
    const { steps, skipped } = importAren(content);
    const rule = this.createRule({
      name: baseName,
      description: `Imported from Advanced Renamer (${fileName})`,
      steps,
    });
    return { rule, skipped };
  }

  exportRule(id) {
    const r = this.getRule(id);
    return { type: EXPORT_TYPE, version: 1, name: r.name, description: r.description, steps: r.steps };
  }

  /** Runs steps over plain names (rule editor "try it" box). */
  test({ steps, names, showOverride = '', showOverrideAll = false }) {
    const clean = normalizeSteps(steps);
    return (Array.isArray(names) ? names : []).slice(0, 200).map((n) => {
      const [base, ext] = splitName(String(n));
      const r = runSteps(base, ext, clean, { showOverride: String(showOverride).trim(), showOverrideAll: !!showOverrideAll });
      return { from: n, to: joinName(sanitizeFileName(r.name) || base, r.ext), info: r.info, warnings: r.warnings };
    });
  }

  // ---------------------------------------------------------------- preview / apply

  /** Expands files and folders (under the target root) into a list of files. */
  async expand(paths) {
    if (!Array.isArray(paths) || !paths.length) return [];
    const root = this.settings.get('targetRoot');
    const matcher = makeFileMatcher(this.settings);
    const out = [];
    for (const p of paths) {
      const abs = await resolveUnder(root, p);
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) out.push(...(await collectVideos(abs, { recursive: true, matcher: { ...matcher, excluded: () => false } })));
      else if (stat.isFile()) out.push(abs);
      if (out.length > MAX_FILES) throw badRequest(`Too many files (more than ${MAX_FILES})`);
    }
    return [...new Set(out)];
  }

  stepsFor({ ruleId, steps }) {
    if (steps) return { steps: normalizeSteps(steps), ruleName: 'custom' };
    const rule = this.getRule(ruleId);
    return { steps: rule.steps, ruleName: rule.name };
  }

  /**
   * Proposes new names. edits maps a path to a name typed by the user.
   * Returns rows in input order.
   */
  async preview({ paths, ruleId, steps, showOverride = '', showOverrideAll = false, edits = {} }) {
    const files = await this.expand(paths);
    const { steps: list } = this.stepsFor({ ruleId, steps });
    const ctx = { showOverride: String(showOverride ?? '').trim(), showOverrideAll: !!showOverrideAll };
    const rows = files.map((file) => {
      const oldName = path.basename(file);
      const [base, ext] = splitName(oldName);
      const r = runSteps(base, ext, list, ctx);
      const proposed = joinName(sanitizeFileName(r.name) || base, r.ext);
      const edit = edits?.[file];
      return {
        path: file,
        dir: path.dirname(file),
        oldName,
        proposed,
        wanted: edit != null ? cleanEdit(edit, ext) : proposed,
        edited: edit != null,
        info: r.info,
        warnings: r.warnings,
      };
    });
    await this.resolveCollisions(rows);
    // Date and size, for sorting the list in the web app.
    await Promise.all(rows.map(async (row) => {
      const st = await fs.stat(row.path).catch(() => null);
      row.mtime = st?.mtimeMs ?? null;
      row.size = st?.size ?? null;
    }));
    return rows;
  }

  /**
   * Sets row.newName and row.status for each row ('unchanged' | 'rename'),
   * adding "_1", "_2"... when the wanted name is taken.
   */
  async resolveCollisions(rows) {
    const sep = this.settings.get('renameSeparator');
    const byDir = Map.groupBy(rows, (r) => r.dir);
    for (const [dir, list] of byDir) {
      const existing = new Set((await fs.readdir(dir).catch(() => [])).map((n) => n.toLowerCase()));
      // Files renamed in this batch free up their old names.
      for (const r of list) if (r.wanted !== r.oldName) existing.delete(r.oldName.toLowerCase());
      const assigned = new Set();
      for (const r of list) {
        if (r.wanted === r.oldName) {
          r.newName = r.oldName;
          r.status = 'unchanged';
          assigned.add(r.oldName.toLowerCase());
          continue;
        }
        const [base, ext] = splitName(r.wanted);
        let candidate = r.wanted;
        const free = (c) => {
          const k = c.toLowerCase();
          return !assigned.has(k) && (!existing.has(k) || k === r.oldName.toLowerCase());
        };
        for (let i = 1; !free(candidate); i++) candidate = joinName(`${base}${sep}${i}`, ext);
        if (candidate !== r.wanted) r.warnings = [...r.warnings, `name already taken; using “${candidate}”`];
        assigned.add(candidate.toLowerCase());
        r.newName = candidate;
        r.status = candidate === r.oldName ? 'unchanged' : 'rename';
      }
    }
  }

  /**
   * Renames files. items: [{ path, newName }]. Names are re-checked for
   * collisions on the server. Returns { renamed: [{ from, to }], errors }.
   */
  async apply({ items, ruleName = null, auto = false }) {
    if (!Array.isArray(items) || !items.length) throw badRequest('Nothing to rename');
    const root = this.settings.get('targetRoot');
    const rows = [];
    for (const it of items) {
      const abs = await resolveUnder(root, it.path);
      const oldName = path.basename(abs);
      const [, ext] = splitName(oldName);
      rows.push({ path: abs, dir: path.dirname(abs), oldName, wanted: cleanEdit(it.newName, ext), warnings: [] });
    }
    await this.resolveCollisions(rows);
    const pairs = rows.filter((r) => r.status === 'rename').map((r) => ({ from: r.path, to: path.join(r.dir, r.newName) }));
    const result = await this.renameMany(pairs);
    if (result.renamed.length) {
      this.db
        .prepare('INSERT INTO rename_history (created_at, rule_name, auto, items) VALUES (?, ?, ?, ?)')
        .run(Date.now(), ruleName, auto ? 1 : 0, JSON.stringify(result.renamed));
      this.events.emit('renameHistory');
    }
    return result;
  }

  /** Renames in two phases (via temporary names) so names can be swapped safely. */
  async renameMany(pairs) {
    const renamed = [];
    const errors = [];
    const staged = [];
    const stamp = Date.now().toString(36);
    for (const [i, p] of pairs.entries()) {
      const tmp = path.join(path.dirname(p.from), `.hbui-rename-${stamp}-${i}.tmp`);
      try {
        await fs.rename(p.from, tmp);
        staged.push({ ...p, tmp });
      } catch (err) {
        errors.push({ path: p.from, error: err.message });
      }
    }
    for (const s of staged) {
      try {
        const clash = await fs.access(s.to).then(() => true, () => false);
        if (clash) throw new Error(`${path.basename(s.to)} appeared meanwhile`);
        await fs.rename(s.tmp, s.to);
        renamed.push({ from: s.from, to: s.to });
      } catch (err) {
        errors.push({ path: s.from, error: err.message });
        await fs.rename(s.tmp, s.from).catch((e) => this.log.error(e, `Could not restore ${s.from} from ${s.tmp}`));
      }
    }
    if (renamed.length) {
      const stmt = this.db.prepare('UPDATE jobs SET output_path = ?, rename_note = NULL WHERE output_path = ?');
      for (const r of renamed) stmt.run(r.to, r.from);
      this.events.emit('jobs');
    }
    return { renamed, errors };
  }

  // ---------------------------------------------------------------- history

  history(limit = 100) {
    return this.db
      .prepare('SELECT * FROM rename_history ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        ruleName: r.rule_name,
        auto: !!r.auto,
        items: JSON.parse(r.items),
        undoneAt: r.undone_at,
      }));
  }

  async undo(id) {
    const h = this.db.prepare('SELECT * FROM rename_history WHERE id = ?').get(id);
    if (!h) throw notFound(`Rename batch ${id} not found`);
    if (h.undone_at) throw conflict('This batch was already undone');
    const pairs = [];
    const errors = [];
    for (const it of JSON.parse(h.items)) {
      const [toExists, fromExists] = await Promise.all(
        [it.to, it.from].map((p) => fs.access(p).then(() => true, () => false)),
      );
      if (!toExists) errors.push({ path: it.to, error: 'file no longer exists' });
      else if (fromExists) errors.push({ path: it.from, error: 'the original name is in use again' });
      else pairs.push({ from: it.to, to: it.from });
    }
    const result = await this.renameMany(pairs);
    this.db.prepare('UPDATE rename_history SET undone_at = ? WHERE id = ?').run(Date.now(), id);
    this.events.emit('renameHistory');
    return { restored: result.renamed.length, errors: [...errors, ...result.errors] };
  }

  // ---------------------------------------------------------------- after conversion

  /**
   * Renames a freshly converted file with the automatic rule set, but only
   * when the rules recognise it without warnings. Returns a note for the job.
   */
  async autoRename(file) {
    const ruleId = this.settings.get('autoRenameRuleId') ?? this.listRules()[0]?.id;
    const rule = this.getRule(ruleId);
    const [row] = await this.preview({ paths: [file], ruleId: rule.id });
    if (!row) return { path: file, note: null };
    const real = row.warnings.filter((w) => !w.startsWith('name already taken'));
    if (real.length) return { path: file, note: `Needs rename: ${real.join('; ')}` };
    if (row.status === 'unchanged') return { path: file, note: null };
    const result = await this.apply({ items: [{ path: file, newName: row.newName }], ruleName: rule.name, auto: true });
    if (result.errors.length) return { path: file, note: `Automatic rename failed: ${result.errors[0].error}` };
    return { path: result.renamed[0].to, note: null };
  }
}

/** Cleans a name typed by the user; puts back the original extension if it was removed. */
function cleanEdit(name, ext) {
  const raw = String(name ?? '').trim();
  if (!raw || /[/\\]/.test(raw)) throw badRequest(`Invalid file name: “${raw}”`);
  const [base, e] = splitName(raw);
  const hasExt = /^[a-z0-9]{1,5}$/i.test(e);
  const cleanBase = sanitizeFileName(hasExt ? base : raw);
  if (!cleanBase) throw badRequest(`Invalid file name: “${raw}”`);
  return joinName(cleanBase, hasExt ? e : ext);
}
