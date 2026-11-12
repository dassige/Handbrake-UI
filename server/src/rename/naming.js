// Naming check results: each check (renamer.check) runs in the background, one at a time, and
// is saved; the newest KEEP_CHECKS are kept. While it runs, 'namingProgress' events say how far
// it is ('listing': folders being read, 'checking': names being compared).
// A saved result lists only the files that needed a look; when it is read again, files that
// are gone (renamed since, moved or deleted) are marked, so they are not offered for fixing.
import fs from 'node:fs/promises';
import { badRequest, conflict, notFound } from '../errors.js';
import { resolveUnderAny } from '../paths.js';

const KEEP_CHECKS = 20;
const META_COLUMNS = 'id, created_at, rule_id, rule_name, paths, total, flagged, status, finished_at, error';

function rowToMeta(r) {
  return {
    id: r.id,
    status: r.status, // running | done | cancelled | failed
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    paths: JSON.parse(r.paths),
    total: r.total,
    flagged: r.flagged,
    error: r.error,
  };
}

export class NamingChecks {
  constructor({ db, renamer, events, log = console }) {
    this.db = db;
    this.renamer = renamer;
    this.events = events;
    this.log = log;
    this.active = null; // { id, signal, phase, found, checked, total, current }
    this.done = Promise.resolve(); // the running check (tests wait for it)
    this.lastEmit = 0;
  }

  /** Checks interrupted by a restart keep what they had (nothing, as rows are saved at the end). */
  recover() {
    this.db
      .prepare(`UPDATE naming_checks SET status = 'cancelled', error = 'Interrupted by a restart', finished_at = ? WHERE status = 'running'`)
      .run(Date.now());
  }

  list() {
    return this.db.prepare(`SELECT ${META_COLUMNS} FROM naming_checks ORDER BY id DESC`).all().map((r) => {
      const meta = rowToMeta(r);
      if (this.active?.id === meta.id) Object.assign(meta, this.progress());
      return meta;
    });
  }

  progress() {
    const { phase, found, checked, total, current } = this.active;
    return { phase, found, checked, total, current };
  }

  /** Starts a check in the background; returns { id } straight away. */
  async start({ paths, ruleId }) {
    if (this.active) throw conflict('A naming check is already running');
    if (!Array.isArray(paths) || !paths.length) throw badRequest('Choose at least one folder or file');
    const rule = this.renamer.getRule(Number(ruleId));
    // Bad paths are refused now, not after the check has started.
    for (const p of paths) await resolveUnderAny(this.renamer.roots(), p);
    const ins = this.db
      .prepare(`INSERT INTO naming_checks (created_at, rule_id, rule_name, paths, total, flagged, rows, status)
        VALUES (?, ?, ?, ?, 0, 0, '[]', 'running')`)
      .run(Date.now(), rule.id, rule.name, JSON.stringify(paths));
    const id = Number(ins.lastInsertRowid);
    this.active = { id, signal: { aborted: false }, phase: 'listing', found: 0, checked: 0, total: null, current: null };
    this.prune();
    this.events.emit('namingChecks');
    this.done = this.run(id, { paths, ruleId: rule.id }).catch((err) => this.log.error(err));
    return { id };
  }

  async run(id, { paths, ruleId }) {
    const a = this.active;
    let status = 'done';
    let error = null;
    let r = null;
    try {
      r = await this.renamer.check({ paths, ruleId }, {
        signal: a.signal,
        onProgress: (p) => {
          Object.assign(a, p);
          this.emitProgress(p.phase !== a.lastPhase);
          a.lastPhase = p.phase;
        },
      });
      if (r.checked < r.total) status = 'cancelled';
    } catch (err) {
      status = err.code === 'ABORTED' ? 'cancelled' : 'failed';
      error = err.code === 'ABORTED' ? null : err.message;
    }
    const rows = (r?.rows ?? []).map(({ path, dir, oldName, expected, info, warnings }) => ({ path, dir, oldName, expected, info, warnings }));
    this.db
      .prepare('UPDATE naming_checks SET status = ?, error = ?, finished_at = ?, total = ?, flagged = ?, rows = ? WHERE id = ?')
      .run(status, error, Date.now(), r?.checked ?? a.found ?? 0, rows.length, JSON.stringify(rows), id);
    this.active = null;
    this.events.emit('namingChecks');
    this.events.emit('namingCheck', { id, status });
  }

  emitProgress(force) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 500) return;
    this.lastEmit = now;
    this.events.emit('namingProgress', { id: this.active.id, ...this.progress() });
  }

  cancel(id) {
    if (this.active?.id !== id) throw conflict('This naming check is not running');
    this.active.signal.aborted = true;
  }

  /** One result with its rows; each row gets the file's date and size, or gone: true. */
  async get(id) {
    const r = this.db.prepare(`SELECT ${META_COLUMNS}, rows FROM naming_checks WHERE id = ?`).get(id);
    if (!r) throw notFound(`Naming check ${id} not found`);
    const meta = rowToMeta(r);
    if (this.active?.id === id) return { ...meta, ...this.progress(), rows: [] };
    const rows = JSON.parse(r.rows);
    // A few at a time: libraries are often on a network share.
    for (let i = 0; i < rows.length; i += 32) {
      await Promise.all(rows.slice(i, i + 32).map(async (row) => {
        const st = await fs.stat(row.path).catch(() => null);
        row.gone = !st;
        // In a protected folder, or queued since the check: shown, but not offered for fixing.
        row.blocked = st ? this.renamer.blockReason(row.path) : null;
        row.mtime = st?.mtimeMs ?? null;
        row.size = st?.size ?? null;
      }));
    }
    return { ...meta, rows };
  }

  remove(id) {
    if (this.active?.id === id) throw conflict('Stop the naming check first');
    this.db.prepare('DELETE FROM naming_checks WHERE id = ?').run(id);
    this.events.emit('namingChecks');
  }

  /** Keeps the newest checks only. */
  prune() {
    this.db
      .prepare(`DELETE FROM naming_checks WHERE status != 'running' AND id NOT IN (SELECT id FROM naming_checks ORDER BY id DESC LIMIT ?)`)
      .run(KEEP_CHECKS);
  }
}
