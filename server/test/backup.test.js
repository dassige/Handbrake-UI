import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Backups } from '../src/backup.js';
import { planZip, zipStream } from '../src/download.js';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const addPreset = (db, name) =>
  db.prepare(`INSERT INTO presets (name, json, summary, created_at) VALUES (?, '{}', '{}', ?)`).run(name, Date.now());
const addJob = (db, src) =>
  db.prepare(`INSERT INTO jobs (status, position, source_path, output_path, preset_name, preset_json, format, created_at)
    VALUES ('done', 1, ?, '/out/x.mkv', 'p', '{}', 'av_mkv', ?)`).run(src, Date.now());
const names = (db, table) => db.prepare(`SELECT ${table === 'jobs' ? 'source_path' : 'name'} AS n FROM ${table} ORDER BY id`).all().map((r) => r.n);

async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-bk-')));
  for (const d of ['src', 'out', 'data/logs', 'data/tmp', 'data/backups']) await fs.mkdir(path.join(dir, d), { recursive: true });
  const db = openDb(path.join(dir, 'data', 'db.sqlite'));
  const settings = new Settings(db, { initialSourceRoot: path.join(dir, 'src'), initialTargetRoot: path.join(dir, 'out') });
  const calls = [];
  const emitted = [];
  const fake = (name, extra = {}) => ({ active: null, recover: async () => calls.push(name), ...extra });
  const queue = fake('queue', { state: () => ({}) });
  const backups = new Backups({
    db,
    dataDir: path.join(dir, 'data'),
    settings,
    queue,
    merger: fake('merger'),
    quality: { active: null, recover: () => calls.push('quality') },
    uploads: { writing: new Set() },
    renamer: { seed: () => calls.push('seed') },
    events: { emit: (t) => emitted.push(t) },
    log: { info() {} },
    versions: { app: { version: '9.9.9' } },
  });
  const done = async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, db, settings, backups, queue, calls, emitted, done };
}

test('backup: snapshot, inspect and restore the configuration only', async () => {
  const t = await setup();
  addPreset(t.db, 'Original');
  addJob(t.db, '/src/a.mkv');
  await t.settings.update({ niceLevel: 5 });
  await fs.writeFile(path.join(t.dir, 'data', 'logs', '1.log'), 'log one');
  const snap = await t.backups.saveSnapshot({ logs: true });
  assert.match(snap.name, /^manual-.*\.zip$/);

  // Change things after the backup.
  addPreset(t.db, 'Later');
  addJob(t.db, '/src/b.mkv');
  await t.settings.update({ niceLevel: 15, queueRunning: true });

  const info = await t.backups.inspect(`snapshot:${snap.name}`);
  assert.equal(info.manifest.versions.app.version, '9.9.9');
  assert.equal(info.counts.presets, 1);
  assert.equal(info.current.presets, 2);
  assert.equal(info.logs, 1);
  assert.deepEqual(info.warnings, []);

  const r = await t.backups.restore({ source: `snapshot:${snap.name}`, scope: 'config' });
  assert.deepEqual(r.tables, ['settings', 'presets', 'rename_rules']);
  assert.match(r.savedAs, /^before-restore-/);
  assert.deepEqual(names(t.db, 'presets'), ['Original']);
  assert.equal(t.settings.get('niceLevel'), 5);
  assert.equal(t.settings.get('queueRunning'), true, 'config restore keeps the queue state');
  assert.deepEqual(names(t.db, 'jobs'), ['/src/a.mkv', '/src/b.mkv'], 'jobs are untouched');
  assert.ok(t.emitted.includes('settings') && t.emitted.includes('presets'));
  assert.ok(!t.calls.includes('queue'));

  // The undo point holds the state from just before.
  const undo = await t.backups.inspect(`snapshot:${r.savedAs}`);
  assert.equal(undo.counts.presets, 2);
  await t.done();
});

test('backup: restoring everything replaces jobs and logs, stops the queue and runs recovery', async () => {
  const t = await setup();
  addJob(t.db, '/src/a.mkv');
  await fs.writeFile(path.join(t.dir, 'data', 'logs', '1.log'), 'old log');
  const snap = await t.backups.saveSnapshot({ logs: true });
  addJob(t.db, '/src/b.mkv');
  await fs.writeFile(path.join(t.dir, 'data', 'logs', '1.log'), 'changed');
  await fs.writeFile(path.join(t.dir, 'data', 'logs', '2.log'), 'new log');
  await t.settings.update({ queueRunning: true });

  const r = await t.backups.restore({ source: `snapshot:${snap.name}`, scope: 'all' });
  assert.ok(r.tables.includes('jobs'));
  assert.deepEqual(names(t.db, 'jobs'), ['/src/a.mkv']);
  assert.deepEqual(await fs.readdir(path.join(t.dir, 'data', 'logs')), ['1.log']);
  assert.equal(await fs.readFile(path.join(t.dir, 'data', 'logs', '1.log'), 'utf8'), 'old log');
  assert.equal(t.settings.get('queueRunning'), false);
  assert.deepEqual(t.calls.filter((c) => c !== 'seed'), ['merger', 'quality', 'queue']);
  await t.done();
});

test('backup: everything is refused while a conversion runs; the configuration is not', async () => {
  const t = await setup();
  const snap = await t.backups.saveSnapshot({ logs: false });
  t.queue.active = { id: 1 };
  assert.equal((await t.backups.inspect(`snapshot:${snap.name}`)).busy, 'a conversion is running');
  await assert.rejects(t.backups.restore({ source: `snapshot:${snap.name}`, scope: 'all' }), /conversion is running/);
  await t.backups.restore({ source: `snapshot:${snap.name}`, scope: 'config' });
  await t.done();
});

test('backup: an older backup without newer columns or tables still restores', async () => {
  const t = await setup();
  addJob(t.db, '/src/old.mkv');
  // Build a backup by hand from a database that lacks jobs.verify and quality_scans, with the
  // names backups had before the rename to EncForge (app "handbrake-ui", handbrake-ui.db).
  const work = path.join(t.dir, 'old');
  await fs.mkdir(work);
  t.db.prepare('VACUUM INTO ?').run(path.join(work, 'handbrake-ui.db'));
  const old = new DatabaseSync(path.join(work, 'handbrake-ui.db'));
  old.exec('ALTER TABLE jobs DROP COLUMN verify; DROP TABLE quality_scans;');
  old.close();
  await fs.writeFile(path.join(work, 'manifest.json'), JSON.stringify({ app: 'handbrake-ui', format: 1 }));
  const entries = await Promise.all(['manifest.json', 'handbrake-ui.db'].map(async (n) => ({
    path: path.join(work, n), name: n, size: (await fs.stat(path.join(work, n))).size, mtime: Date.now(),
  })));
  await pipeline(zipStream(planZip(entries)), createWriteStream(path.join(t.dir, 'data', 'backups', 'manual-old.zip')));
  addJob(t.db, '/src/new.mkv');

  const r = await t.backups.restore({ source: 'snapshot:manual-old.zip', scope: 'all' });
  assert.ok(!r.tables.includes('quality_scans'));
  assert.deepEqual(names(t.db, 'jobs'), ['/src/old.mkv']);
  await t.done();
});

test('backup: refuses files that are not backups, and bad names', async () => {
  const t = await setup();
  const bad = path.join(t.dir, 'data', 'backups', 'manual-bad.zip');
  await fs.writeFile(bad, 'not a zip at all');
  await assert.rejects(t.backups.inspect('snapshot:manual-bad.zip'), /Not an EncForge backup: Not a ZIP/);
  // A real ZIP without a manifest.
  const f = path.join(t.dir, 'x.txt');
  await fs.writeFile(f, 'x');
  await pipeline(zipStream(planZip([{ path: f, name: 'x.txt', size: 1, mtime: Date.now() }])), createWriteStream(bad));
  await assert.rejects(t.backups.inspect('snapshot:manual-bad.zip'), /manifest.json or encforge.db is missing/);
  await assert.rejects(t.backups.inspect('snapshot:../../etc.zip'), /Invalid backup name/);
  await assert.rejects(t.backups.inspect('upload:../x'), /Invalid backup source/);
  await assert.rejects(t.backups.restore({ source: 'snapshot:manual-bad.zip', scope: 'nope' }), /scope/);
  await t.done();
});
