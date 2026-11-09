// Reads ZIP files (stored or deflated entries, ZIP64 included) through the central
// directory, which is enough for the backups this app writes and for the same
// backups re-zipped by another tool.
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const LIMIT32 = 0xffffffff;

export class ZipError extends Error {}

/** Lists the entries: [{ name, method, compressedSize, size, localOffset }]. */
export async function readZipEntries(file) {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 0xffff + 22 + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('Not a ZIP file');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z64 = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, z64);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ZipError('Damaged ZIP64 record');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (cdOffset + cdSize > size || cdSize > 64 * 1024 * 1024) throw new ZipError('Damaged ZIP directory');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);

    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new ZipError('Damaged ZIP directory entry');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
      // ZIP64 extra: the 64-bit values, in order, for the fields that are 0xFFFFFFFF.
      for (let x = p + 46 + nameLen; x < p + 46 + nameLen + extraLen; ) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (entrySize === LIMIT32) { entrySize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === LIMIT32) { compressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === LIMIT32) localOffset = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }
      entries.push({ name, method, compressedSize, size: entrySize, localOffset, encrypted: !!(flags & 1) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** Writes one entry to dest, checking its size. */
export async function extractEntry(file, entry, dest) {
  if (entry.encrypted) throw new ZipError(`${entry.name} is encrypted`);
  if (![0, 8].includes(entry.method)) throw new ZipError(`${entry.name}: unsupported compression (method ${entry.method})`);
  const fh = await fs.open(file, 'r');
  const head = Buffer.alloc(30);
  try {
    await fh.read(head, 0, 30, entry.localOffset);
  } finally {
    await fh.close();
  }
  if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipError(`${entry.name}: damaged entry`);
  const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const out = createWriteStream(dest);
  if (entry.compressedSize === 0) {
    out.end();
    await new Promise((resolve, reject) => out.on('finish', resolve).on('error', reject));
  } else {
    const src = createReadStream(file, { start, end: start + entry.compressedSize - 1 });
    await (entry.method === 8 ? pipeline(src, createInflateRaw(), out) : pipeline(src, out));
  }
  const written = (await fs.stat(dest)).size;
  if (written !== entry.size) throw new ZipError(`${entry.name}: expected ${entry.size} bytes, got ${written}`);
}
