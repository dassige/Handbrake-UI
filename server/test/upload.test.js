import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Uploads, checkName } from '../src/upload.js';

async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-up-')));
  const src = path.join(dir, 'src');
  const src2 = path.join(dir, 'src2');
  const out = path.join(dir, 'out');
  for (const d of [src, src2, out]) await fs.mkdir(d);
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: out });
  await settings.update({ sourceRoots: [src, src2] });
  const emitted = [];
  const uploads = new Uploads({ db, settings, events: { emit: (t) => emitted.push(t) }, log: { info() {}, warn() {} } });
  const done = async () => {
    db.close();
    await fs.rm(dir, { recursive: true });
  };
  return { dir, src, src2, out, db, settings, uploads, emitted, done };
}

const body = (s) => Readable.from([Buffer.from(s)]);

test('settings: an old single sourceRoot becomes sourceRoots', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-set-'));
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('sourceRoot', ?)`).run(JSON.stringify(dir));
  const s = new Settings(db, { initialSourceRoot: '/x', initialTargetRoot: '/y' });
  assert.deepEqual(s.get('sourceRoots'), [path.resolve(dir)]);
  assert.equal(s.get('sourceRoot'), undefined);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'sourceRoot'`).get().n, 0);
  db.close();
  await fs.rm(dir, { recursive: true });
});

test('settings: nested or overlapping roots are rejected', async () => {
  const t = await setup();
  await assert.rejects(t.settings.update({ sourceRoots: [t.dir, t.src] }), /cannot be inside|already inside/);
  await assert.rejects(t.settings.update({ sourceRoots: [t.src, path.join(t.src, '..', 'src2')], targetRoot: t.src2 }), /cannot also be/);
  await assert.rejects(t.settings.update({ sourceRoots: [t.out] }), /cannot also be a sources folder/);
  await assert.rejects(t.settings.update({ sourceRoots: [] }), /At least one/);
  await assert.rejects(t.settings.update({ sourceRoots: [path.join(t.dir, 'missing')] }), /not an existing folder/);
  // Duplicates collapse.
  assert.deepEqual((await t.settings.update({ sourceRoots: [t.src, t.src + path.sep] })).sourceRoots, [t.src]);
  // Protected flags only for folders in the list; removing a folder drops its flag.
  let r = await t.settings.update({ sourceRoots: [t.src, t.src2], protectedRoots: [t.src2 + path.sep, t.out] });
  assert.deepEqual(r.protectedRoots, [t.src2]);
  r = await t.settings.update({ sourceRoots: [t.src] });
  assert.deepEqual(r.protectedRoots, []);
  await assert.rejects(t.settings.update({ protectedRoots: 'x' }), /must be a list/);
  await t.done();
});

test('upload: chunks append, resume from the size on disk, and finish under the real name', async () => {
  const t = await setup();
  const dest = path.join(t.src2, 'sub');
  await t.uploads.mkdir({ parent: t.src2, name: 'sub' });
  const file = { dir: dest, name: 'film.mkv', size: 10 };
  assert.deepEqual(await t.uploads.chunk({ ...file, offset: 0 }, body('01234')), { offset: 5 });
  const c = await t.uploads.check({ dir: dest, files: [{ name: 'film.mkv', size: 10 }] });
  assert.equal(c.files[0].partial, 5);
  assert.equal(c.files[0].exists, false);
  // A chunk sent from the wrong offset is refused.
  await assert.rejects(t.uploads.chunk({ ...file, offset: 0 }, body('01234')), /not 0/);
  const r = await t.uploads.chunk({ ...file, offset: 5 }, body('56789'));
  assert.equal(r.done, true);
  assert.equal(r.path, path.join(dest, 'film.mkv'));
  assert.equal(await fs.readFile(r.path, 'utf8'), '0123456789');
  assert.deepEqual((await fs.readdir(dest)).sort(), ['film.mkv']);
  assert.ok(t.emitted.includes('files'));
  await t.done();
});

test('upload: an existing name is never replaced', async () => {
  const t = await setup();
  await fs.writeFile(path.join(t.src, 'a.mp4'), 'old');
  const c = await t.uploads.check({ dir: t.src, files: [{ name: 'a.mp4', size: 3 }] });
  assert.equal(c.files[0].exists, true);
  const r = await t.uploads.chunk({ dir: t.src, name: 'a.mp4', size: 3, offset: 0 }, body('new'));
  assert.equal(r.path, path.join(t.src, 'a (1).mp4'));
  assert.equal(await fs.readFile(path.join(t.src, 'a.mp4'), 'utf8'), 'old');
  await t.done();
});

test('upload: refuses too much data, other folders, non-videos and odd names', async () => {
  const t = await setup();
  await assert.rejects(t.uploads.chunk({ dir: t.src, name: 'a.mkv', size: 3, offset: 0 }, body('toolong')), /More data/);
  await assert.rejects(t.uploads.chunk({ dir: t.out, name: 'a.mkv', size: 3, offset: 0 }, body('abc')), /outside/);
  await assert.rejects(t.uploads.chunk({ dir: t.src, name: 'a.txt', size: 3, offset: 0 }, body('abc')), /not a video/);
  await assert.rejects(t.uploads.chunk({ dir: t.src, name: '../a.mkv', size: 3, offset: 0 }, body('abc')), /slashes/);
  await assert.rejects(t.uploads.mkdir({ parent: t.src, name: '.hidden' }), /dot/);
  assert.throws(() => checkName('  '), /missing/);
  await t.uploads.discard({ dir: t.src, name: 'a.mkv', size: 3 });
  assert.deepEqual(await fs.readdir(t.src), []);
  await t.done();
});
