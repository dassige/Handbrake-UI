import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChapters, chaptersXml, compatibility, describePart, suggestName, timestamp } from '../src/merge.js';

const identify = (seconds, { audio = [{ lang: 'ita' }, { lang: 'eng' }], size = '1280x720', priv = 'aa' } = {}) => ({
  container: { recognized: true, properties: { duration: seconds * 1e9 } },
  tracks: [
    { type: 'video', codec: 'AVC/H.264/MPEG-4p10', properties: { codec_id: 'V_MPEG4/ISO/AVC', pixel_dimensions: size, codec_private_data: priv } },
    ...audio.map((a) => ({
      type: 'audio', codec: a.codec ?? 'AAC',
      properties: { codec_id: a.codec ? 'A_AC3' : 'A_AAC', language: a.lang, audio_channels: a.channels ?? 2, audio_sampling_frequency: 48000 },
    })),
    { type: 'subtitles', codec: 'SubRip/SRT', properties: { codec_id: 'S_TEXT/UTF8', language: 'ita' } },
  ],
});
const chapters = (...list) => ({ chapters: list.map(([s, e, title]) => ({ start_time: String(s), end_time: String(e), tags: title ? { title } : {} })) });

const part = (name, seconds, ch, opts) => describePart(`/out/${name}`, identify(seconds, opts), ch);

test('describePart reads length, tracks and chapters', () => {
  const p = part('a.mkv', 380.446, chapters([0, 200, 'Chapter 1'], [200, 380.013, 'Chapter 2']));
  assert.equal(p.duration, 380.446);
  assert.deepEqual(p.tracks.map((t) => t.type), ['video', 'audio', 'audio', 'subtitle']);
  assert.equal(p.chapters.length, 2);
});

test('chapters keep their place in the merged file; generic titles are renumbered', () => {
  const parts = [
    part('Disc 1.mkv', 380.446, chapters([0, 200, 'Chapter 1'], [200, 380.013, 'Chapter 2'])),
    part('Disc 2.mkv', 447.6, chapters([0, 100, 'Intro'], [100, 447.6, 'Chapter 2'])),
    part('Disc 3.mkv', 60, { chapters: [] }),
  ];
  const c = buildChapters(parts, 'keep');
  assert.deepEqual(c.map((x) => x.title), ['Chapter 1', 'Chapter 2', 'Intro', 'Chapter 4', 'Disc 3']);
  assert.deepEqual(c.map((x) => Math.round(x.start * 1000) / 1000), [0, 200, 380.446, 480.446, 828.046]);
  assert.equal(Math.round(c[4].end * 1000) / 1000, 888.046);

  const perFile = buildChapters(parts, 'perFile');
  assert.deepEqual(perFile.map((x) => x.title), ['Disc 1', 'Disc 2', 'Disc 3']);
  assert.equal(Math.round(perFile[1].start * 1000) / 1000, 380.446);
});

test('chapter XML has exact timestamps and escaped titles', () => {
  assert.equal(timestamp(380.446367), '00:06:20.446367000');
  assert.equal(timestamp(3725.5), '01:02:05.500000000');
  const xml = chaptersXml([{ start: 0, end: 10, title: 'Tom & Jerry <live>' }]);
  assert.match(xml, /<ChapterString>Tom &amp; Jerry &lt;live&gt;<\/ChapterString>/);
  assert.match(xml, /<ChapterTimeStart>00:00:00.000000000<\/ChapterTimeStart>/);
});

test('compatibility: same layout passes; different tracks block the merge', () => {
  const a = part('a.mkv', 100, { chapters: [] });
  const b = part('b.mkv', 100, { chapters: [] });
  assert.deepEqual(compatibility([a, b]), []);

  assert.equal(compatibility([a])[0].level, 'error');

  const oneAudio = part('c.mkv', 100, { chapters: [] }, { audio: [{ lang: 'ita' }] });
  const [p] = compatibility([a, oneAudio]);
  assert.equal(p.level, 'error');
  assert.match(p.message, /1 audio track instead of 2/);

  const ac3 = part('d.mkv', 100, { chapters: [] }, { audio: [{ lang: 'ita', codec: 'AC-3' }, { lang: 'eng' }] });
  assert.match(compatibility([a, ac3])[0].message, /audio track 1 is AC-3, part 1 has AAC/);

  const surround = part('e.mkv', 100, { chapters: [] }, { audio: [{ lang: 'ita', channels: 6 }, { lang: 'eng' }] });
  assert.equal(compatibility([a, surround])[0].level, 'error');
});

test('compatibility: picture size, encoder settings and languages are warnings', () => {
  const a = part('a.mkv', 100, { chapters: [] });
  const small = part('b.mkv', 100, { chapters: [] }, { size: '704x478', priv: 'bb' });
  const r = compatibility([a, small]);
  assert.deepEqual(r.map((x) => x.level), ['warning']);
  assert.match(r[0].message, /704x478/);
  assert.equal(compatibility([a, part('c.mkv', 100, { chapters: [] }, { priv: 'cc' })])[0].level, 'warning');
  const lang = compatibility([a, part('d.mkv', 100, { chapters: [] }, { audio: [{ lang: 'eng' }, { lang: 'eng' }] })]);
  assert.equal(lang[0].level, 'warning');
});

test('suggestName uses what the names have in common', () => {
  assert.equal(suggestName(['Live Aid - Disc 1.mkv', 'Live Aid - Disc 2.mkv', 'Live Aid - Disc 3.mkv']), 'Live Aid');
  assert.equal(suggestName(['Il Padrino CD1.mkv', 'Il Padrino CD2.mkv']), 'Il Padrino');
  assert.equal(suggestName(['Movie Part 1.mkv', 'Movie Part 2.mkv']), 'Movie');
  assert.equal(suggestName(['3) Ashford & Simpson.mkv', '4) Run DMC.mkv']), '3) Ashford & Simpson - merged');
});
