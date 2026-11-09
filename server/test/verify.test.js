import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseHandBrakeLog, videoLength } from '../src/verify.js';

const LOG = `
[01:04:45]  * subtitle track 1, italiano (UTF-8) (track 0, id 0x3, Text) -> Passthru, Default
[01:04:45]  * subtitle track 2, English (UTF-8) (track 2, id 0x5, Text) -> Passthru
[01:04:45]  * subtitle track 3, English (track 3, id 0x6, Picture) -> Render/Burn-in, Forced Only
[01:04:45]  * audio track 1
[01:04:45]  * audio track 2
Encoding: task 1 of 1, 98.36 % (41.61 fps)[01:05:26] eac3-decoder done: 2081 frames, 0 decoder errors
[01:05:26] h264-decoder done: 1577 frames, 3 decoder errors
`;

const probe = {
  format: { duration: '2620.0' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, tags: { DURATION: '00:43:36.650000000' } },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'ita' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
    { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'ita' } },
    { index: 4, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
  ],
};
const goodPackets = { 0: { end: 2616.6, count: 78000 }, 1: { end: 2616.6, count: 122000 }, 2: { end: 2616.5, count: 122000 }, 3: { end: 2500, count: 600 }, 4: { end: 0, count: 0 } };
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

test('parseHandBrakeLog counts tracks, burned subtitles and decoder errors', () => {
  const l = parseHandBrakeLog(LOG);
  assert.deepEqual(l, { found: true, audioTracks: 2, subtitleTracks: 2, burnedSubtitles: 1, decoderErrors: 3 });
  // Two-pass encodes print the job twice: tracks are counted once.
  assert.equal(parseHandBrakeLog(LOG + LOG).audioTracks, 2);
});

test('videoLength reads the stream, then its DURATION tag, then the container', () => {
  assert.equal(videoLength(probe), 2616.65);
  assert.equal(videoLength({ format: { duration: '100.5' }, streams: [{ codec_type: 'video' }] }), 100.5);
});

test('a good conversion passes, with a warning for errors in the source', () => {
  const r = evaluate({ sourceLength: 2616.656, probe, packets: goodPackets, decode: { end: 2616.6, errors: [] }, log: parseHandBrakeLog(LOG) });
  const c = byId(r);
  assert.equal(c.length.status, 'ok');
  assert.equal(c.audioCount.status, 'ok');
  assert.equal(c.audioLength.status, 'ok');
  assert.equal(c.subtitles.status, 'ok');
  assert.match(c.subtitles.detail, /1 burned into the picture/);
  assert.match(c.subtitles.detail, /eng subrip \(no lines\)/);
  assert.equal(c.decode.status, 'ok');
  assert.equal(c.sourceErrors.status, 'warning');
  assert.equal(r.status, 'warning');
});

test('a truncated file fails even when its metadata claims the full length', () => {
  const packets = { ...goodPackets, 0: { end: 600, count: 18000 }, 1: { end: 600, count: 1 }, 2: { end: 600, count: 1 } };
  const r = evaluate({ sourceLength: 2616.656, probe, packets, decode: { end: 598, errors: [] }, log: { found: false } });
  assert.equal(byId(r).length.status, 'error');
  assert.match(byId(r).length.detail, /shorter than the source/);
  assert.equal(r.status, 'error');
});

test('a missing or short audio track and decode errors are errors', () => {
  const twoAudioLog = parseHandBrakeLog(LOG.replace(/3 decoder errors/, '0 decoder errors'));
  const oneAudio = { ...probe, streams: probe.streams.filter((s) => s.index !== 2) };
  assert.equal(byId(evaluate({ sourceLength: 2616.6, probe: oneAudio, packets: goodPackets, log: twoAudioLog })).audioCount.status, 'error');

  const shortAudio = { ...goodPackets, 2: { end: 1300, count: 60000 } };
  const r = evaluate({ sourceLength: 2616.6, probe, packets: shortAudio, log: twoAudioLog });
  assert.equal(byId(r).audioLength.status, 'error');
  assert.match(byId(r).audioLength.detail, /track 2 \(eng\) ends .* early/);

  const errs = Array.from({ length: 12 }, () => '[h264 @ 0x1] error while decoding MB 3 4');
  assert.equal(byId(evaluate({ sourceLength: 2616.6, probe, packets: goodPackets, decode: { end: 2616.6, errors: errs }, log: twoAudioLog })).decode.status, 'error');
  assert.equal(byId(evaluate({ sourceLength: 2616.6, probe, packets: goodPackets, decode: { end: 2616.6, errors: errs.slice(0, 2) }, log: twoAudioLog })).decode.status, 'warning');
});

test('small length differences are fine, medium ones are warnings', () => {
  const run = (src) => byId(evaluate({ sourceLength: src, probe, packets: goodPackets, log: { found: false } })).length.status;
  assert.equal(run(2617.9), 'ok'); // 1.3 s
  assert.equal(run(2640), 'warning'); // 23 s, under 2 %
  assert.equal(run(2900), 'error');
});
