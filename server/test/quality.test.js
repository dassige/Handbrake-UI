import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUALITY, describeMedia, effectiveHeight, evaluateQuality, normalizeQuality } from '../src/quality.js';

const probe = ({
  codec = 'h264', width = 1920, height = 1080, bitRate, tags, fieldOrder, sar,
  audio = [{ codec_name: 'aac', bit_rate: '160000' }], formatBitRate,
}) => ({
  format: { format_name: 'matroska,webm', duration: '2400', bit_rate: formatBitRate },
  streams: [
    {
      codec_type: 'video', codec_name: codec, width, height, bit_rate: bitRate, tags, field_order: fieldOrder,
      sample_aspect_ratio: sar, avg_frame_rate: '24000/1001',
    },
    { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 900, disposition: { attached_pic: 1 } },
    ...audio.map((a) => ({ codec_type: 'audio', channels: 2, ...a })),
    { codec_type: 'subtitle', codec_name: 'subrip' },
  ],
});
const info = (opts, file = '/m/film.mkv') => describeMedia(probe(opts), { file, size: 1e9 });
const kinds = (i, c = DEFAULT_QUALITY) => evaluateQuality(i, c).map((x) => x.kind);

test('describeMedia reads codec, size, bitrate and frame rate, ignoring cover art', () => {
  const i = info({ bitRate: '4000000' });
  assert.equal(i.video.codec, 'h264');
  assert.equal(i.video.width, 1920);
  assert.equal(i.video.kbps, 4000);
  assert.equal(i.video.kbpsEstimated, false);
  assert.equal(i.video.fps, 23.976);
  assert.equal(i.audio.length, 1);
  assert.equal(i.subtitles, 1);
  assert.equal(i.container, 'mkv');
});

test('describeMedia uses the BPS tag, then estimates from the file', () => {
  assert.equal(info({ tags: { 'BPS-eng': '2500000' } }).video.kbps, 2500);
  const est = info({ formatBitRate: '3000000' });
  assert.equal(est.video.kbps, 2840); // 3000 - 160 audio
  assert.equal(est.video.kbpsEstimated, true);
});

test('cropped widescreen keeps its resolution class; anamorphic DVDs use the display width', () => {
  assert.equal(effectiveHeight(info({ width: 1920, height: 800 }).video), 1080);
  assert.equal(effectiveHeight(info({ width: 1280, height: 536 }).video), 720);
  assert.equal(effectiveHeight(info({ width: 720, height: 576, sar: '64:45' }).video), 576);
});

test('a good modern file passes', () => {
  assert.deepEqual(kinds(info({ bitRate: '4000000' })), []);
  // HEVC needs less: 1600 kbps at 1080p is fine (2500 × 0.6 = 1500).
  assert.deepEqual(kinds(info({ codec: 'hevc', bitRate: '1600000' })), []);
  // The app's own 720p x264 1500 kbps output passes.
  assert.deepEqual(kinds(info({ width: 1280, height: 720, bitRate: '1500000' })), []);
});

test('old formats, low resolution, low bitrate and interlacing are flagged', () => {
  assert.deepEqual(
    kinds(info({ codec: 'mpeg4', width: 640, height: 352, bitRate: '1000000' }, '/m/old.avi')),
    ['format', 'format', 'resolution'],
  );
  assert.deepEqual(kinds(info({ bitRate: '1500000' })), ['bitrate']);
  assert.deepEqual(kinds(info({ bitRate: '4000000', audio: [{ codec_name: 'wmav2' }] })), ['format']);
  const interlaced = info({ bitRate: '4000000', fieldOrder: 'tt' });
  assert.deepEqual(kinds(interlaced), []);
  assert.deepEqual(kinds(interlaced, { ...DEFAULT_QUALITY, flagInterlaced: true }), ['interlaced']);
  assert.deepEqual(kinds({ path: 'x', error: 'Invalid data' }), ['error']);
  assert.deepEqual(kinds(describeMedia({ format: {}, streams: [] }, { file: '/a.mkv', size: 1 })), ['error']);
});

test('criteria can turn checks off', () => {
  const off = normalizeQuality({
    minHeight: 0, minKbps: { sd: 0, hd: 0, fhd: 0, uhd: 0 }, badContainers: [], badVideoCodecs: [],
  });
  assert.deepEqual(kinds(info({ codec: 'mpeg4', width: 640, height: 352, bitRate: '100000' }, '/m/old.avi'), off), []);
});

test('normalizeQuality cleans lists and rejects bad numbers', () => {
  const q = normalizeQuality({ badContainers: [' .AVI', 'avi', ''], minHeight: '576' });
  assert.deepEqual(q.badContainers, ['avi']);
  assert.equal(q.minHeight, 576);
  assert.deepEqual(q.minKbps, DEFAULT_QUALITY.minKbps);
  assert.throws(() => normalizeQuality({ minHeight: -1 }), /whole number/);
  assert.throws(() => normalizeQuality({ efficientFactor: 2 }), /factor/);
  assert.throws(() => normalizeQuality({ badVideoCodecs: 'mpeg4' }), /list/);
});
