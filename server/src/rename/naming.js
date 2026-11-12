// Naming check results: each check (renamer.check) is saved, the newest KEEP_CHECKS are kept.
// A saved result lists only the files that needed a look; when it is read again, files that
// are gone (renamed since, moved or deleted) are marked, so they are not offered for fixing.
import fs from 'node:fs/promises';
import { notFound } from '../errors.js';

const KEEP_CHECKS = 20;
const META_COLUMNS = 'id, created_at, rule_id, rule_name, paths, total, flagged';

function rowToMeta(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    paths: JSON.parse(r.paths),
    total: r.total,
    flagged: r.flagged,
  };
}

export class NamingChecks {
  constructor({ db, renamer, events }) {
    this.db = db;
    this.renamer = renamer;
    this.events = events;
  }

  list() {
    return this.db.prepare(`SELECT ${META_COLUMNS} FROM naming_checks ORDER BY id DESC`).all().map(rowToMeta);
  }

  /** Checks the folders, saves the result and returns it as get() does. */
  async run({ paths, ruleId }) {
    const r = await this.renamer.check({ paths, ruleId });
    const rows = r.rows.map(({ path, dir, oldName, expected, info, warnings }) => ({ path, dir, oldName, expected, info, warnings }));
    const ins = this.db
      .prepare('INSERT INTO naming_checks (created_at, rule_id, rule_name, paths, total, flagged, rows) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.checkedAt, r.ruleId, r.ruleName, JSON.stringify(r.paths), r.total, rows.length, JSON.stringify(rows));
    this.prune();
    this.events.emit('namingChecks');
    return this.get(Number(ins.lastInsertRowid));
  }

  /** One result with its rows; each row gets the file's date and size, or gone: true. */
  async get(id) {
    const r = this.db.prepare(`SELECT ${META_COLUMNS}, rows FROM naming_checks WHERE id = ?`).get(id);
    if (!r) throw notFound(`Naming check ${id} not found`);
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
    return { ...rowToMeta(r), rows };
  }

  remove(id) {
    this.db.prepare('DELETE FROM naming_checks WHERE id = ?').run(id);
    this.events.emit('namingChecks');
  }

  /** Keeps the newest checks only. */
  prune() {
    this.db
      .prepare('DELETE FROM naming_checks WHERE id NOT IN (SELECT id FROM naming_checks ORDER BY id DESC LIMIT ?)')
      .run(KEEP_CHECKS);
  }
}
