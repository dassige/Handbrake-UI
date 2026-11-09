import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { Downloads, attachment, parseRange, planZip, zipStream } from '../src/download.js';

async function tmp() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-dl-')));
}

async function collect(stream) {
  const parts = [];
  for await (const c of stream) parts.push(c);
  return Buffer.concat(parts);
}

/** Reads a ZIP the way an unzip tool does: end record -> central directory -> local entries. */
function readZip(buf) {
  let eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'end record');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    assert.equal(buf.readUInt32LE(z), 0x06064b50, 'zip64 end record');
    count = Number(buf.readBigUInt64LE(z + 32));
    cdOffset = Number(buf.readBigUInt64LE(z + 48));
  }
  const files = {};
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central entry');
    const crc = buf.readUInt32LE(p + 16);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (extraLen) {
      const x = p + 46 + nameLen;
      assert.equal(buf.readUInt16LE(x), 1, 'zip64 extra');
      size = Number(buf.readBigUInt64LE(x + 4));
      offset = Number(buf.readBigUInt64LE(x + 20));
    }
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, `local header of ${name}`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    assert.equal(buf.readUInt32LE(start + size), 0x08074b50, `descriptor of ${name}`);
    files[name] = data.toString('utf8');
    p += 46 + nameLen + extraLen + buf.readUInt16LE(p + 32);
  }
  return files;
}

for (const forceZip64 of [false, true]) {
  test(`zip: exact planned size and readable entries${forceZip64 ? ' (ZIP64)' : ''}`, async () => {
    const dir = await tmp();
    const files = { 'a.mkv': 'hello', 'Sub/è perché.srt': 'ciao', 'empty.txt': '' };
    const entries = [];
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, ...name.split('/'));
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
      entries.push({ path: full, name, size: Buffer.byteLength(content), mtime: Date.now() });
    }
    const plan = planZip(entries, { forceZip64 });
    const buf = await collect(zipStream(plan));
    assert.equal(buf.length, plan.size);
    assert.deepEqual(readZip(buf), files);
    await fs.rm(dir, { recursive: true });
  });
}

test('zip: a file that shrinks while downloading stops the stream', async () => {
  const dir = await tmp();
  const f = path.join(dir, 'a.mkv');
  await fs.writeFile(f, 'abc');
  const plan = planZip([{ path: f, name: 'a.mkv', size: 10, mtime: Date.now() }]);
  await assert.rejects(collect(zipStream(plan)), /changed while/);
  await fs.rm(dir, { recursive: true });
});

test('zip: large sizes switch to ZIP64 in the plan', () => {
  const big = planZip([{ name: 'a', size: 5 * 2 ** 30, mtime: 0 }, { name: 'b', size: 1, mtime: 0 }]);
  assert.equal(big.items[0].zip64, true);
  assert.equal(big.items[1].zip64, true); // starts after 4 GB
  assert.equal(big.end64, true);
  assert.equal(planZip([{ name: 'a', size: 10, mtime: 0 }]).end64, false);
});

test('parseRange handles start-end, open ends, suffixes and bad ranges', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'invalid');
  assert.equal(parseRange('bytes=5-1', 100), 'invalid');
  assert.equal(parseRange('bytes=0-1,5-6', 100), 'invalid');
});

test('attachment keeps the UTF-8 name with an ASCII fallback', () => {
  assert.equal(
    attachment('L\'uomo "x" è.mkv'),
    'attachment; filename="L\'uomo _x_ _.mkv"; filename*=UTF-8\'\'L%27uomo%20%22x%22%20%C3%A8.mkv',
  );
});

test('prepareZip: folders recursively, names relative to the chosen items, hidden and .part files skipped', async () => {
  const dir = await tmp();
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  await fs.mkdir(path.join(src, 'Show', 'S01'), { recursive: true });
  await fs.mkdir(out);
  await fs.writeFile(path.join(src, 'Show', 'S01', 'e1.mkv'), '1');
  await fs.writeFile(path.join(src, 'Show', 'S01', 'e1.srt'), 's');
  await fs.writeFile(path.join(src, 'Show', '.e2.mkv.10.hbui-upload'), 'x');
  await fs.writeFile(path.join(src, 'Show', 'e3.mkv.part'), 'x');
  await fs.writeFile(path.join(src, 'film.mp4'), '22');
  const settings = { get: (k) => ({ sourceRoots: [src], targetRoot: out })[k] };
  const d = new Downloads({ settings, log: { warn() {} } });

  const one = await d.prepareZip({ paths: [path.join(src, 'Show')] });
  assert.equal(one.name, 'Show.zip');
  assert.equal(one.files, 2);
  assert.deepEqual(d.tokens.get(one.id).plan.items.map((i) => i.name), ['Show/S01/e1.mkv', 'Show/S01/e1.srt']);

  const two = await d.prepareZip({ paths: [path.join(src, 'Show'), path.join(src, 'film.mp4')] });
  assert.equal(two.name, 'src.zip');
  assert.equal(two.files, 3);
  assert.equal(two.contentSize, 4);

  await assert.rejects(d.prepareZip({ paths: [dir] }), /outside/);
  await assert.rejects(d.prepareZip({ paths: [out] }), /no files/);
  await fs.rm(dir, { recursive: true });
});
