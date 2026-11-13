// "Replace original" for jobs added from the quality check (replace.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Queue } from '../src/queue.js';
import { Subtitles } from '../src/subtitles/service.js';
import { Replacer, destinationOf } from '../src/replace.js';

const quiet = { info() {}, warn() {}, error() {} };

async function setup({ rename } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'encforge-replace-')));
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  const originals = path.join(dir, 'originals');
  const data = path.join(dir, 'data');
  for (const x of [src, out, originals, path.join(data, 'tmp'), path.join(data, 'logs')]) await fs.mkdir(x, { recursive: true });
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: out });
  const events = { emit() {} };
  const queue = new Queue({ db, settings, presets: {}, handbrake: {}, verifier: null, events, dataDir: data, log: quiet });
  const subtitles = new Subtitles({ settings, tmpDir: path.join(data, 'tmp'), log: quiet });
  const replacer = new Replacer({ db, settings, queue, subtitles, events, log: quiet, ...(rename ? { rename } : {}) });
  /** A converted job: files written, row inserted. */
  const job = async ({ source, output, origin = 'quality', verify = 'ok', status = 'done', original = 'original', converted = 'converted' }) => {
    await fs.mkdir(path.dirname(source), { recursive: true });
    if (original != null) await fs.writeFile(source, original);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, converted);
    const r = db.prepare(`INSERT INTO jobs (status, position, source_path, output_path, preset_name, preset_json, format, created_at, origin, verify_status)
      VALUES (?, 1, ?, ?, 'P', '{}', 'av_mkv', ?, ?, ?)`).run(status, source, output, Date.now(), origin, verify);
    return Number(r.lastInsertRowid);
  };
  const read = (p) => fs.readFile(p, 'utf8');
  const there = (p) => fs.access(p).then(() => true, () => false);
  const done = async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, src, out, originals, db, settings, queue, replacer, job, read, there, done };
}

test('replace: the converted file takes the original’s place; the original and its overwritten subtitle are kept', async () => {
  const t = await setup();
  try {
    await t.settings.update({ replaceBackupFolder: t.originals });
    const source = path.join(t.src, 'Old', 'Film.avi');
    const output = path.join(t.out, 'Film (2001).mkv');
    const id = await t.job({ source, output });
    await fs.writeFile(path.join(t.src, 'Old', 'Film.en.srt'), 'original en');
    await fs.writeFile(path.join(t.src, 'Old', 'Film.it.srt'), 'original it');
    await fs.writeFile(path.join(t.out, 'Film (2001).en.srt'), 'converted en');

    const job = await t.replacer.replace(id, { backup: true });
    const dest = path.join(t.src, 'Old', 'Film.mkv');
    assert.equal(await t.read(dest), 'converted');
    assert.equal(await t.there(source), false);
    assert.equal(await t.there(output), false);
    assert.equal(await t.read(path.join(t.originals, 'Old', 'Film.avi')), 'original');
    // The subtitle copy follows, named after the original; the original it replaced is kept with the video.
    assert.equal(await t.read(path.join(t.src, 'Old', 'Film.en.srt')), 'converted en');
    assert.equal(await t.read(path.join(t.originals, 'Old', 'Film.en.srt')), 'original en');
    assert.equal(await t.read(path.join(t.src, 'Old', 'Film.it.srt')), 'original it');
    assert.equal(await t.there(path.join(t.out, 'Film (2001).en.srt')), false);

    assert.equal(job.outputPath, dest);
    assert.equal(job.replaced.backup, path.join(t.originals, 'Old', 'Film.avi'));
    assert.equal(job.replaced.original, source);
    assert.deepEqual(job.replaced.warnings, []);
    // Done once; retry and "convert again" would work on the converted file.
    await assert.rejects(t.replacer.replace(id), (e) => e.errorCode === 'alreadyReplaced');
    assert.throws(() => t.queue.retry(id), /replaced/);
    await assert.rejects(t.queue.convertAgain(id, {}), /replaced/);
  } finally {
    await t.done();
  }
});

test('replace: without keeping it, the original is overwritten (same name) or deleted', async () => {
  const t = await setup();
  try {
    const same = await t.job({ source: path.join(t.src, 'A.mkv'), output: path.join(t.out, 'A.mkv') });
    await t.replacer.replace(same, { backup: false });
    assert.equal(await t.read(path.join(t.src, 'A.mkv')), 'converted');

    const other = await t.job({ source: path.join(t.src, 'B.avi'), output: path.join(t.out, 'B.mkv') });
    const job = await t.replacer.replace(other);
    assert.equal(await t.there(path.join(t.src, 'B.avi')), false);
    assert.equal(await t.read(path.join(t.src, 'B.mkv')), 'converted');
    assert.equal(job.replaced.backup, null);
    // Keeping it needs a folder.
    const third = await t.job({ source: path.join(t.src, 'C.avi'), output: path.join(t.out, 'C.mkv') });
    await assert.rejects(t.replacer.replace(third, { backup: true }), (e) => e.errorCode === 'noBackupFolder');
    assert.equal(await t.read(path.join(t.src, 'C.avi')), 'original');
  } finally {
    await t.done();
  }
});

test('replace: works between disks (copies), and a backup name in use gets a suffix', async () => {
  const rename = async (from, to) => {
    // As if every folder were its own disk: renames only within a folder.
    if (path.dirname(from) !== path.dirname(to)) throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    return fs.rename(from, to);
  };
  const t = await setup({ rename });
  try {
    await t.settings.update({ replaceBackupFolder: t.originals });
    await fs.writeFile(path.join(t.originals, 'Film.avi'), 'an older original');
    const id = await t.job({ source: path.join(t.src, 'Film.avi'), output: path.join(t.out, 'Film.mkv') });
    const job = await t.replacer.replace(id, { backup: true });
    assert.equal(await t.read(path.join(t.src, 'Film.mkv')), 'converted');
    assert.equal(await t.there(path.join(t.out, 'Film.mkv')), false, 'the copied-from file is removed');
    assert.equal(job.replaced.backup, path.join(t.originals, 'Film (1).avi'));
    assert.equal(await t.read(job.replaced.backup), 'original');
    assert.equal(await t.read(path.join(t.originals, 'Film.avi')), 'an older original');
    const hidden = (await fs.readdir(t.src)).filter((n) => n.startsWith('.'));
    assert.deepEqual(hidden, [], 'no part files left');
  } finally {
    await t.done();
  }
});

test('replace: a failing step undoes the ones before it', async () => {
  let failInto = null;
  const rename = async (from, to) => {
    if (failInto && to.startsWith(failInto)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return fs.rename(from, to);
  };
  const t = await setup({ rename });
  try {
    await t.settings.update({ replaceBackupFolder: t.originals });
    failInto = t.originals;
    const id = await t.job({ source: path.join(t.src, 'Film.avi'), output: path.join(t.out, 'Film.mkv') });
    await assert.rejects(t.replacer.replace(id, { backup: true }), /Could not move the original/);
    assert.equal(await t.read(path.join(t.src, 'Film.avi')), 'original');
    assert.equal(await t.read(path.join(t.out, 'Film.mkv')), 'converted');
    assert.equal(await t.there(path.join(t.src, 'Film.mkv')), false);
    assert.deepEqual((await fs.readdir(t.src)).filter((n) => n.startsWith('.')), []);
    assert.equal(t.queue.get(id).replaced, null);
  } finally {
    await t.done();
  }
});

test('replace: refused when it is not safe', async () => {
  const t = await setup();
  try {
    const code = async (id) => t.replacer.replace(id).then(() => 'replaced', (e) => e.errorCode ?? e.message);
    assert.equal(await code(await t.job({ source: path.join(t.src, 'a.avi'), output: path.join(t.out, 'a.mkv'), origin: null })), 'notQuality');
    assert.equal(await code(await t.job({ source: path.join(t.src, 'b.avi'), output: path.join(t.out, 'b.mkv'), verify: 'error' })), 'checkFailed');
    assert.equal(await code(await t.job({ source: path.join(t.src, 'c.avi'), output: path.join(t.out, 'c.mkv'), status: 'failed' })), 'notDone');
    // Another file already has the new name.
    await fs.writeFile(path.join(t.src, 'd.mkv'), 'someone else');
    assert.equal(await code(await t.job({ source: path.join(t.src, 'd.avi'), output: path.join(t.out, 'd.mkv') })), 'nameTaken');
    assert.equal(await t.read(path.join(t.src, 'd.mkv')), 'someone else');
    // Queued again.
    const e = await t.job({ source: path.join(t.src, 'e.avi'), output: path.join(t.out, 'e.mkv') });
    await t.job({ source: path.join(t.src, 'e.avi'), output: path.join(t.out, 'e (1).mkv'), status: 'queued' });
    assert.equal(await code(e), 'pending');
    // Protected sources folder.
    const f = await t.job({ source: path.join(t.src, 'f.avi'), output: path.join(t.out, 'f.mkv') });
    t.settings.set('protectedRoots', [t.src]);
    assert.equal(await code(f), 'protected');
    t.settings.set('protectedRoots', []);
    // The converted file is gone.
    const g = await t.job({ source: path.join(t.src, 'g.avi'), output: path.join(t.out, 'g.mkv') });
    await fs.rm(path.join(t.out, 'g.mkv'));
    assert.equal(await code(g), 'noOutput');
    assert.equal(destinationOf({ sourcePath: '/m/x/Film.avi', outputPath: '/o/Other name.mp4' }), path.join('/m/x', 'Film.mp4'));
  } finally {
    await t.done();
  }
});

test('replace: the originals folder must exist and be outside the sources folders', async () => {
  const t = await setup();
  try {
    await assert.rejects(t.settings.update({ replaceBackupFolder: path.join(t.src, 'keep') }), /cannot be inside the sources folder/);
    await assert.rejects(t.settings.update({ replaceBackupFolder: path.join(t.dir, 'missing') }), /does not exist/);
    await assert.rejects(t.settings.update({ replaceBackupFolder: 'relative/path' }), /absolute/);
    await t.settings.update({ replaceBackupFolder: t.originals + path.sep });
    assert.equal(t.settings.get('replaceBackupFolder'), t.originals);
    await t.settings.update({ replaceBackupFolder: '' });
    assert.equal(t.settings.get('replaceBackupFolder'), '');
  } finally {
    await t.done();
  }
});
