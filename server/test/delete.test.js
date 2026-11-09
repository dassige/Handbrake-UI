import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceFiles } from '../src/deleteFiles.js';

async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-del-')));
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  await fs.mkdir(path.join(src, 'Show', 'S01'), { recursive: true });
  await fs.mkdir(out);
  await fs.writeFile(path.join(src, 'Show', 'S01', 'e1.mkv'), '12345');
  await fs.writeFile(path.join(src, 'Show', 'e2.mkv'), '123');
  await fs.writeFile(path.join(src, 'film.mp4'), '1');
  await fs.writeFile(path.join(src, 'queued.mkv'), '1');
  await fs.writeFile(path.join(out, 'converted.mkv'), '1');
  const pending = [path.join(src, 'queued.mkv')];
  const queue = {
    pendingSourcesUnder: (p) => pending.filter((f) => f === p || f.startsWith(p + path.sep)).map((f) => ({ path: f, status: 'queued' })),
  };
  const emitted = [];
  const values = { sourceRoots: [src], targetRoot: out, protectedRoots: [] };
  const files = new SourceFiles({
    settings: { get: (k) => values[k] },
    queue,
    events: { emit: (t) => emitted.push(t) },
    log: { info() {} },
  });
  return { dir, src, out, files, pending, emitted, values, done: () => fs.rm(dir, { recursive: true }) };
}

const exists = (p) => fs.access(p).then(() => true, () => false);

test('delete: preview counts folders recursively and folds files inside chosen folders', async () => {
  const t = await setup();
  const r = await t.files.preview({ paths: [path.join(t.src, 'Show'), path.join(t.src, 'Show', 'e2.mkv'), path.join(t.src, 'film.mp4')] });
  assert.deepEqual(r.items.map((i) => [path.basename(i.path), i.type, i.files, i.bytes]), [['Show', 'dir', 2, 8], ['film.mp4', 'file', 1, 1]]);
  assert.equal(r.files, 3);
  assert.equal(r.bytes, 9);
  assert.deepEqual(r.blocked, []);
  // Nothing was deleted by the preview.
  assert.ok(await exists(path.join(t.src, 'Show', 'S01', 'e1.mkv')));
  await t.done();
});

test('delete: removes files and folders, and refuses roots, the target and queued files', async () => {
  const t = await setup();
  const r = await t.files.remove({
    paths: [path.join(t.src, 'Show'), path.join(t.src, 'film.mp4'), path.join(t.src, 'queued.mkv'), t.src, path.join(t.out, 'converted.mkv')],
  });
  assert.deepEqual(r.deleted.map((p) => path.basename(p)), ['Show', 'film.mp4']);
  assert.equal(r.blocked.length, 3);
  assert.match(r.blocked.find((b) => b.path.endsWith('queued.mkv')).reason, /queued or converting/);
  assert.match(r.blocked.find((b) => b.path === t.src).reason, /sources folder itself/);
  assert.match(r.blocked.find((b) => b.path.endsWith('converted.mkv')).reason, /outside/);
  assert.equal(await exists(path.join(t.src, 'Show')), false);
  assert.equal(await exists(path.join(t.src, 'film.mp4')), false);
  assert.ok(await exists(path.join(t.src, 'queued.mkv')));
  assert.ok(await exists(path.join(t.out, 'converted.mkv')));
  assert.ok(t.emitted.includes('files'));
  await t.done();
});

test('delete: a folder with a queued file inside is refused as a whole', async () => {
  const t = await setup();
  t.pending.push(path.join(t.src, 'Show', 'S01', 'e1.mkv'));
  const r = await t.files.remove({ paths: [path.join(t.src, 'Show')] });
  assert.deepEqual(r.deleted, []);
  assert.match(r.blocked[0].reason, /e1\.mkv is queued/);
  assert.ok(await exists(path.join(t.src, 'Show', 'e2.mkv')));
  await t.done();
});

test('delete: nothing in a protected sources folder can be deleted', async () => {
  const t = await setup();
  t.values.protectedRoots = [t.src];
  const r = await t.files.remove({ paths: [path.join(t.src, 'film.mp4'), path.join(t.src, 'Show')] });
  assert.deepEqual(r.deleted, []);
  assert.equal(r.blocked.length, 2);
  assert.match(r.blocked[0].reason, /protected/);
  assert.ok(await exists(path.join(t.src, 'film.mp4')));
  await t.done();
});
