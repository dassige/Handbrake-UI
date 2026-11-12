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

test('issues carry a code and params for the web app, next to the English text', () => {
  const [codec, resolution] = evaluateQuality(info({ codec: 'mpeg4', width: 640, height: 352, bitRate: '1000000' }, '/m/old.mkv'), DEFAULT_QUALITY);
  assert.deepEqual(codec, { kind: 'format', code: 'oldVideoCodec', params: { codec: 'mpeg4' }, text: 'Old video codec: mpeg4' });
  assert.equal(resolution.code, 'lowResolution');
  assert.deepEqual(resolution.params, { width: 640, height: 352, minHeight: 720 });
  const [low] = evaluateQuality(info({ codec: 'hevc', formatBitRate: '1000000' }), DEFAULT_QUALITY);
  assert.equal(low.code, 'lowBitrateCodecEstimated');
  assert.deepEqual(low.params, { kbps: 840, min: 1500, resolution: 'fhd', codec: 'HEVC' });
  assert.equal(low.text, 'Low bitrate: 840 (est.) kbps, below 1500 kbps for 1080p HEVC');
  assert.equal(evaluateQuality(info({ bitRate: '1500000' }), DEFAULT_QUALITY)[0].code, 'lowBitrate');
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

test('re-check reads the chosen files again, follows a changed extension and drops the gone ones', async () => {
  const { default: fs } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { openDb } = await import('../src/db.js');
  const { Settings } = await import('../src/settings.js');
  const { QualityScanner } = await import('../src/quality.js');

  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-q-')));
  const db = openDb(path.join(dir, 'db.sqlite'));
  try {
    const src = path.join(dir, 'src');
    await fs.mkdir(src);
    await fs.mkdir(path.join(dir, 'out'));
    const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: path.join(dir, 'out') });
    const files = ['a.mkv', 'b.mkv', 'c.mkv', 'd.avi'].map((f) => path.join(src, f));
    for (const f of files) await fs.writeFile(f, 'x');

    // Every file starts at a low bitrate; "fixing" one raises it.
    const kbps = new Map(files.map((f) => [f, '500000']));
    const probed = [];
    const verifier = { probe: async (f) => (probed.push(f), probe({ bitRate: kbps.get(f) })) };
    const events = { emit() {} };
    const quality = new QualityScanner({ db, settings, verifier, events, queue: null, log: console });

    const { id } = await quality.start({ paths: [src] });
    await quality.done;
    assert.equal(quality.get(id).flagged, 4);

    kbps.set(files[0], '8000000');
    await fs.rm(files[1]);
    // d.avi was converted to d.mkv and deleted.
    const converted = path.join(src, 'd.mkv');
    await fs.rename(files[3], converted);
    kbps.set(converted, '8000000');
    probed.length = 0;
    await assert.rejects(quality.recheck(id, { paths: [path.join(dir, 'elsewhere.mkv')] }), /None of these files/);
    const r = await quality.recheck(id, { paths: [files[0], files[1], files[3]] });
    assert.equal(r.count, 3);
    assert.equal(quality.list()[0].status, 'running', 'a re-check shows as running');
    await assert.rejects(quality.start({ paths: [src] }), /already running/);
    await quality.done;

    assert.deepEqual(probed, [files[0], converted], 'the chosen files that exist, or their replacement, are read again');
    const scan = quality.get(id);
    assert.equal(scan.status, 'done', 'the result keeps its status');
    assert.deepEqual(scan.results.map((f) => path.basename(f.path)), ['a.mkv', 'c.mkv', 'd.mkv']);
    assert.equal(scan.results[0].issues.length, 0);
    assert.equal(scan.results[1].issues[0].kind, 'bitrate', 'files not chosen keep their result');
    assert.equal(scan.results[2].issues.length, 0, 'the converted file replaces the old one');
    assert.equal(scan.total, 3);
    assert.equal(scan.scanned, 3);
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
