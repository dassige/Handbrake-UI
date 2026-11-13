// The web app's player (media.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import Fastify from 'fastify';
import { Media, MAX_STREAMS, describeForPlayer, streamArgs } from '../src/media.js';
import { registerMediaRoutes } from '../src/mediaRoutes.js';

const probeOf = (video, ...audio) => ({
  format: { duration: '600.5' },
  streams: [
    ...(video ? [{ codec_type: 'video', codec_name: video, width: 1920, height: 1080, field_order: 'progressive', duration: '600.5' }] : []),
    ...audio.map((a) => ({ codec_type: 'audio', codec_name: a, channels: 6, tags: { language: 'ita' } })),
  ],
});

test('media: direct playback only for what browsers play', () => {
  assert.equal(describeForPlayer(probeOf('h264', 'aac'), '/m/a.mp4').direct, true);
  assert.equal(describeForPlayer(probeOf('vp9', 'opus'), '/m/a.webm').direct, true);
  assert.equal(describeForPlayer(probeOf('h264', 'aac'), '/m/a.mkv').direct, true);
  assert.equal(describeForPlayer(probeOf('h264', 'ac3'), '/m/a.mkv').direct, false, 'AC3 audio');
  assert.equal(describeForPlayer(probeOf('mpeg4', 'mp3'), '/m/a.avi').direct, false, 'AVI / DivX');
  assert.equal(describeForPlayer(probeOf('mpeg2video', 'mp2'), '/m/a.mpg').direct, false);
  assert.equal(describeForPlayer(probeOf('h264'), '/m/silent.mp4').direct, true, 'no audio');
  const info = describeForPlayer(probeOf('h264', 'aac', 'ac3'), '/m/a.mkv');
  assert.equal(info.duration, 600.5);
  assert.deepEqual(info.audio.map((a) => [a.codec, a.language]), [['aac', 'ita'], ['ac3', 'ita']]);
  assert.equal(info.video.interlaced, false);
});

test('media: the compatible stream starts where asked, with the chosen audio track', () => {
  const a = streamArgs('/m/Film.avi', { start: 125.5, audio: 1 });
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '125.5', '-i', '/m/Film.avi']);
  assert.ok(a.includes('0:a:1?'));
  assert.ok(a.join(' ').includes('frag_keyframe+empty_moov'));
  assert.equal(streamArgs('/m/Film.avi').includes('-ss'), false);
});

/** An app with the media routes over a temp sources folder; spawn is a fake ffmpeg. */
async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'encforge-media-')));
  const src = path.join(dir, 'src');
  await fs.mkdir(src);
  await fs.writeFile(path.join(src, 'Film.mp4'), Buffer.from('0123456789'));
  const settings = { get: (k) => ({ sourceRoots: [src], targetRoot: path.join(dir, 'out'), niceLevel: 0 })[k] };
  const children = [];
  const spawnFn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.args = args;
    child.kill = () => {
      child.killed = true;
      child.stdout.end();
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
    };
    children.push(child);
    child.stdout.write('ftyp');
    return child;
  };
  const media = new Media({ settings, verifier: { probe: async () => probeOf('h264', 'aac') }, spawnFn });
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => reply.status(err.statusCode ?? 500).send({ error: err.message, code: err.errorCode ?? null }));
  registerMediaRoutes(app, { media });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const q = (p) => encodeURIComponent(p);
  return { dir, src, app, base, q, media, children, done: async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('media: the file is sent inline with Range; paths outside the folders are refused', async () => {
  const t = await setup();
  try {
    const file = path.join(t.src, 'Film.mp4');
    const all = await fetch(`${t.base}/api/media/file?path=${t.q(file)}`);
    assert.equal(all.status, 200);
    assert.equal(all.headers.get('content-type'), 'video/mp4');
    assert.equal(all.headers.get('content-disposition'), null, 'not a download');
    assert.equal(await all.text(), '0123456789');
    const part = await fetch(`${t.base}/api/media/file?path=${t.q(file)}`, { headers: { Range: 'bytes=2-4' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(await part.text(), '234');
    const outside = await fetch(`${t.base}/api/media/file?path=${t.q(path.join(t.dir, 'secret.mp4'))}`);
    assert.equal(outside.status, 400);
    const info = await (await fetch(`${t.base}/api/media/info?path=${t.q(file)}`)).json();
    assert.equal(info.direct, true);
    assert.equal(info.name, 'Film.mp4');
  } finally {
    await t.done();
  }
});

test('media: the stream’s ffmpeg stops when the player goes, and at most a few run at once', async () => {
  const t = await setup();
  // Plain requests, one connection each (fetch may drop a response body it is not reading).
  const get = (url) => new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => resolve({ req, res }));
    req.on('error', reject);
  });
  const settle = async (cond) => {
    const until = Date.now() + 2000;
    while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  };
  const open = [];
  try {
    const url = `${t.base}/api/media/stream?path=${t.q(path.join(t.src, 'Film.mp4'))}&t=30&audio=1`;
    for (let i = 0; i < MAX_STREAMS; i++) {
      const o = await get(url);
      open.push(o);
      assert.equal(o.res.statusCode, 200);
      assert.equal(o.res.headers['content-type'], 'video/mp4');
    }
    assert.equal(t.media.streams.size, MAX_STREAMS);
    const args = t.children[0].args;
    assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '30']);
    assert.ok(args.includes('0:a:1?'));

    const busy = await get(url);
    assert.equal(busy.res.statusCode, 429);
    busy.res.resume();

    open[0].req.destroy();
    await settle(() => t.media.streams.size < MAX_STREAMS);
    assert.equal(t.children[0].killed, true, 'ffmpeg killed when the player left');
    assert.equal(t.media.streams.size, MAX_STREAMS - 1);
  } finally {
    for (const o of open) o.req.destroy();
    await settle(() => t.media.streams.size === 0);
    await t.done();
  }
});
