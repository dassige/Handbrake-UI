// Installs and files made before the rename from Handbrake-UI to EncForge keep working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adoptDbFile, openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Renamer } from '../src/rename/renamer.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'encforge-legacy-'));

test('legacy names: handbrake-ui.db and its WAL file become encforge.db, data intact', async () => {
  const dir = await tmp();
  try {
    const legacy = path.join(dir, 'handbrake-ui.db');
    const live = path.join(dir, 'live.db');
    const old = openDb(live);
    old.prepare(`INSERT INTO settings (key, value) VALUES ('marker', '"kept"')`).run();
    // Copy the files while the database is open, so the -wal file still holds the write
    // (as after a crash or a container kill).
    for (const ext of ['', '-wal', '-shm']) {
      if (existsSync(live + ext)) await fs.copyFile(live + ext, legacy + ext);
    }
    assert.ok(existsSync(`${legacy}-wal`), 'the test needs a -wal file');
    old.close();

    const r = adoptDbFile(dir);
    assert.equal(r.file, path.join(dir, 'encforge.db'));
    assert.equal(r.renamedFrom, legacy);
    assert.ok(!existsSync(legacy) && !existsSync(`${legacy}-wal`) && !existsSync(`${legacy}-shm`));
    const db = new DatabaseSync(r.file);
    assert.equal(db.prepare(`SELECT value FROM settings WHERE key = 'marker'`).get().value, '"kept"');
    db.close();

    // Second start: nothing left to move.
    assert.equal(adoptDbFile(dir).renamedFrom, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy names: an existing encforge.db wins, a fresh folder gets encforge.db', async () => {
  const dir = await tmp();
  try {
    assert.deepEqual(adoptDbFile(dir), { file: path.join(dir, 'encforge.db'), renamedFrom: null });
    await fs.writeFile(path.join(dir, 'encforge.db'), 'new');
    await fs.writeFile(path.join(dir, 'handbrake-ui.db'), 'old');
    assert.equal(adoptDbFile(dir).renamedFrom, null);
    assert.equal(await fs.readFile(path.join(dir, 'encforge.db'), 'utf8'), 'new');
    assert.ok(existsSync(path.join(dir, 'handbrake-ui.db')), 'the old file is left alone');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy names: rename rule sets exported before the rename still import', () => {
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: os.tmpdir(), initialTargetRoot: os.tmpdir() });
  const renamer = new Renamer({ db, settings, events: { emit() {} }, log: console });
  const steps = [{ type: 'smart' }];
  const { rule } = renamer.importRule('old.json', JSON.stringify({ type: 'handbrake-ui-rename-rules', version: 1, name: 'Old set', steps }));
  assert.equal(rule.name, 'Old set');
  assert.equal(renamer.exportRule(rule.id).type, 'encforge-rename-rules');
  const again = renamer.importRule('new.json', JSON.stringify(renamer.exportRule(rule.id)));
  assert.equal(again.rule.name, 'Old set');
  assert.throws(() => renamer.importRule('x.json', JSON.stringify({ type: 'something-else', steps })), /Unknown JSON file/);
});
