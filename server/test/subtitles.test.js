import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileTag, langFromWord, normLang, readTags } from '../src/subtitles/languages.js';
import { companionsByVideo, companionsOf, findSidecars, ownerOf } from '../src/subtitles/detect.js';
import { applyEdits, decode, normalizeEdits, parse, serialize, toSrt } from '../src/subtitles/text.js';
import {
  effectiveModes, handbrakeArgs, outputSubtitleLangs, planSubtitles, targetName,
} from '../src/subtitles/plan.js';
import { mergeSidecars, Subtitles } from '../src/subtitles/service.js';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Queue } from '../src/queue.js';
import { Renamer } from '../src/rename/renamer.js';
import { SourceFiles } from '../src/deleteFiles.js';

const quiet = { info() {}, warn() {}, error() {} };
const isVideo = (n) => /\.(mkv|mp4|avi)$/i.test(n);

async function tmpDir(prefix = 'hbui-subs-') {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function touch(file, content = '') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

const SRT = '1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>World</i>\n';

// ------------------------------------------------------------------ languages

test('subtitles: languages and flags from file names', () => {
  assert.equal(langFromWord('en'), 'eng');
  assert.equal(langFromWord('ENG'), 'eng');
  assert.equal(langFromWord('Italiano'), 'ita');
  assert.equal(langFromWord('fra'), 'fre');
  assert.equal(langFromWord('pt-BR'), 'por');
  assert.equal(langFromWord('xx'), null);
  assert.equal(normLang('und'), null);
  assert.equal(normLang('deu'), 'ger');
  assert.equal(fileTag('ger'), 'de');
  assert.equal(fileTag('hin'), 'hin');
  assert.deepEqual(readTags('.en.forced'), { lang: 'eng', forced: true, sdh: false, default: false });
  assert.deepEqual(readTags('2_English'), { lang: 'eng', forced: false, sdh: false, default: false });
  assert.deepEqual(readTags('.ita.sdh'), { lang: 'ita', forced: false, sdh: true, default: false });
  // "hi" means hearing impaired, not Hindi.
  assert.equal(readTags('.en.hi').sdh, true);
  assert.equal(readTags('').lang, null);
});

// ------------------------------------------------------------------ detection

test('subtitles: sidecars are found by name, in Subs folders, and for a lone video', async () => {
  const dir = await tmpDir();
  try {
    await touch(path.join(dir, 'Movie.mkv'));
    await touch(path.join(dir, 'Movie Extended.mkv'));
    await touch(path.join(dir, 'Movie.en.srt'));
    await touch(path.join(dir, 'Movie.ita.forced.srt'));
    await touch(path.join(dir, 'Movie Extended.en.srt'));
    await touch(path.join(dir, 'Movie.en.idx'));
    await touch(path.join(dir, 'Movie.en.sub'));
    await touch(path.join(dir, 'Movie.fr.idx')); // no .sub: unusable
    await touch(path.join(dir, 'Other.srt')); // two videos: no owner
    await touch(path.join(dir, 'Subs', 'Movie', '3_Italian.srt'));
    const opts = { isVideo };
    const movie = await findSidecars(path.join(dir, 'Movie.mkv'), opts);
    assert.deepEqual(movie.map((s) => s.name), ['Movie.en.idx', 'Movie.en.srt', 'Movie.ita.forced.srt', path.join('Subs', 'Movie', '3_Italian.srt')]);
    assert.deepEqual(movie.map((s) => s.lang), ['eng', 'eng', 'ita', 'ita']);
    assert.equal(movie[2].forced, true);
    assert.deepEqual(movie[0].extra, [path.join(dir, 'Movie.en.sub')]);
    assert.equal(movie[1].size, 0);
    const ext = await findSidecars(path.join(dir, 'Movie Extended.mkv'), opts);
    assert.deepEqual(ext.map((s) => s.name), ['Movie Extended.en.srt']);

    const lone = path.join(dir, 'lone');
    await touch(path.join(lone, 'The.Film.2020.1080p.mkv'));
    await touch(path.join(lone, 'english.srt'));
    await touch(path.join(lone, 'Subs', '2_Italian.srt'));
    const found = await findSidecars(path.join(lone, 'The.Film.2020.1080p.mkv'), opts);
    assert.deepEqual(found.map((s) => [s.match, s.lang]), [['folder', 'eng'], ['subs', 'ita']]);
    // Turned off: an empty extension list.
    assert.deepEqual(await findSidecars(path.join(dir, 'Movie.mkv'), { isVideo, extensions: [] }), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('subtitles: owners and companions', () => {
  assert.equal(ownerOf('Movie.en', ['Movie', 'Movie Extended']), 'Movie');
  assert.equal(ownerOf('Movie Extended.en', ['Movie', 'Movie Extended']), 'Movie Extended');
  assert.equal(ownerOf('Movies.en', ['Movie']), null);
  const names = ['A.mkv', 'A.en.srt', 'A.en.idx', 'A.en.sub', 'A.sub', 'AB.mkv', 'AB.srt', 'A.nfo'];
  const list = companionsOf(path.join('/t', 'A.mkv'), names, { isVideo });
  assert.deepEqual(list.map((c) => c.suffix), ['.en.srt', '.en.idx', '.en.sub']);
  // The whole folder at once (renaming many videos): the same answer for every video.
  const all = companionsByVideo('/t', names, { isVideo });
  assert.deepEqual([...all.keys()].sort(), ['A', 'AB']);
  assert.deepEqual(all.get('A'), list);
  assert.deepEqual(all.get('AB'), companionsOf(path.join('/t', 'AB.mkv'), names, { isVideo }));
  assert.deepEqual(all.get('AB').map((c) => c.suffix), ['.srt']);
});

// ------------------------------------------------------------------ text

test('subtitles: decoding UTF-8, BOMs and the fallback codeset', () => {
  const latin = Buffer.from([0x43, 0x6f, 0x73, 0xec, 0x20, 0xe8]); // "Così è" in windows-1252
  assert.deepEqual(decode(latin), { text: 'Così è', codeset: 'windows-1252' });
  assert.equal(decode(Buffer.from('Così è', 'utf8')).codeset, 'UTF-8');
  assert.equal(decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('é')])).text, 'é');
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ok', 'utf16le')])).text, 'ok');
  assert.equal(decode(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nhello there\n', 'utf16le')).codeset, 'utf-16le');
  assert.equal(decode(Buffer.from('Così', 'utf8'), { codeset: 'windows-1252' }).text, 'CosÃ¬');
});

test('subtitles: SRT, WebVTT and ASS are parsed and written back', () => {
  const srt = parse(SRT.replace(/\n/g, '\r\n'), 'srt');
  assert.deepEqual(srt.cues.map((c) => [c.start, c.end, c.text]), [[1000, 2500, 'Hello'], [3000, 4000, '<i>World</i>']]);
  assert.equal(toSrt(srt.cues), '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>World</i>\r\n');

  const vtt = parse('WEBVTT\n\nNOTE hi\n\n00:01.000 --> 00:02.000 align:start\n<v Bob>Hi <c.yellow>there</c>\n', 'vtt');
  assert.deepEqual(vtt.cues, [{ start: 1000, end: 2000, text: 'Hi there' }]);

  const assText = [
    '[Script Info]', 'ScriptType: v4.00+', '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,Bonjour, toi\\Nligne 2',
    'Comment: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,note',
  ].join('\n');
  const ass = parse(assText, 'ass');
  assert.deepEqual(ass.cues.map((c) => [c.start, c.end, c.text]), [[5000, 7500, 'Bonjour, toi\nligne 2']]);
  const shifted = applyEdits(ass, { offsetMs: 1000 }).doc;
  assert.match(serialize(shifted), /Dialogue: 0,0:00:06\.00,0:00:08\.50,Default,,0,0,0,,Bonjour, toi\\Nligne 2/);
  assert.match(serialize(shifted), /Comment: 0,0:00:08\.00/);
});

test('subtitles: edits (offset, frame rate, clean-up, overlaps)', () => {
  const doc = parse([
    '1', '00:00:01,000 --> 00:00:03,000', '[MUSIC PLAYING]', '',
    '2', '00:00:02,500 --> 00:00:04,000', 'JOHN: Hello (laughs)', '- MARY: Hi', '',
    '3', '00:00:05,000 --> 00:00:06,000', 'Subtitles by www.example.com', '',
    '4', '00:00:07,000 --> 00:00:08,000', '<b>Bold</b> {\\an8}top', '',
  ].join('\n'), 'srt');
  const { doc: out, removed } = applyEdits(doc, { cleanup: { hi: true, ads: true, tags: true, overlaps: true } });
  assert.equal(removed, 2);
  assert.deepEqual(out.cues.map((c) => c.text), ['Hello\n- Hi', 'Bold top']);

  const ov = applyEdits(parse(SRT.replace('00:00:03,000', '00:00:02,000'), 'srt'), { cleanup: { overlaps: true } }).doc;
  assert.equal(ov.cues[0].end, 1999);

  const t = applyEdits(parse(SRT, 'srt'), { offsetMs: -1500, fps: { from: 25, to: 23.976 } }).doc;
  // 1000 ms × 25/23.976 − 1500 < 0 → starts at 0; 3000 × 25/23.976 − 1500 ≈ 1628.
  assert.equal(t.cues[0].start, 0);
  assert.equal(t.cues[1].start, Math.round(3000 * 25 / 23.976 - 1500));

  assert.deepEqual(normalizeEdits({ offsetMs: '250', fps: { from: 25, to: 25 }, cleanup: { hi: true, x: true }, codeset: 'windows-1250' }),
    { offsetMs: 250, codeset: 'windows-1250', cleanup: { hi: true } });
  assert.throws(() => normalizeEdits({ fps: { from: 26, to: 25 } }), /fps/);
  assert.throws(() => normalizeEdits({ codeset: 'nope' }), /codeset/);
});

// ------------------------------------------------------------------ plan

test('subtitles: what the output keeps from the source, following the preset', () => {
  const src = [{ lang: 'eng' }, { lang: 'ita' }, { lang: 'und' }];
  assert.deepEqual([...outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'none' }).langs], []);
  assert.deepEqual([...outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'all', SubtitleLanguageList: [] }).langs], ['eng', 'ita']);
  assert.equal(outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'all', SubtitleLanguageList: ['any'] }).count, 3);
  assert.deepEqual([...outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'all', SubtitleLanguageList: ['ita'] }).langs], ['ita']);
  assert.deepEqual([...outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'first', SubtitleLanguageList: ['fra', 'ita'] }).langs], ['ita']);
  assert.deepEqual([...outputSubtitleLangs(src, { SubtitleTrackSelectionBehavior: 'first', SubtitleLanguageList: ['any'] }).langs], ['eng']);
});

test('subtitles: embed and copy decisions', () => {
  const files = [
    { name: 'a.en.srt', format: 'srt', lang: 'eng', include: true },
    { name: 'a.it.srt', format: 'srt', lang: 'ita', include: true },
    { name: 'a.srt', format: 'srt', lang: null, include: true },
    { name: 'a.fr.sup', format: 'sup', lang: 'fre', include: true },
    { name: 'a.de.srt', format: 'srt', lang: 'ger', include: false },
  ];
  const preset = { SubtitleTrackSelectionBehavior: 'all', SubtitleLanguageList: ['any'] };
  const run = (embed, copy, format = 'av_mkv', sourceSubs = [{ lang: 'eng' }]) =>
    planSubtitles({ files, sourceSubs, preset, format, embed, copy }).map((f) => `${f.name}:${f.embed ? 'E' : '-'}${f.copy ? 'C' : '-'}:${f.why}`);
  assert.deepEqual(run('missing', 'always'), ['a.en.srt:-C:present', 'a.it.srt:EC:missing', 'a.srt:-C:unknownLang', 'a.fr.sup:EC:missing', 'a.de.srt:--:excluded']);
  assert.deepEqual(run('missing', 'notEmbedded', 'av_mkv', []), ['a.en.srt:E-:missing', 'a.it.srt:E-:missing', 'a.srt:E-:missing', 'a.fr.sup:E-:missing', 'a.de.srt:--:excluded']);
  assert.deepEqual(run('always', 'never', 'av_mp4'), ['a.en.srt:E-:always', 'a.it.srt:E-:always', 'a.srt:E-:always', 'a.fr.sup:--:container', 'a.de.srt:--:excluded']);
  assert.deepEqual(run('always', 'notEmbedded', 'av_webm'), ['a.en.srt:-C:container', 'a.it.srt:-C:container', 'a.srt:-C:container', 'a.fr.sup:-C:container', 'a.de.srt:--:excluded']);
  assert.deepEqual(run('never', 'notEmbedded'), ['a.en.srt:-C:never', 'a.it.srt:-C:never', 'a.srt:-C:never', 'a.fr.sup:-C:never', 'a.de.srt:--:excluded']);
});

test('subtitles: job, queue and Settings modes', () => {
  const values = { subtitleEmbed: 'missing', subtitleCopy: 'always', queueSubtitles: { embed: null, copy: 'never' } };
  const settings = { get: (k) => values[k] };
  assert.deepEqual(effectiveModes({}, settings), { embed: 'missing', copy: 'never', embedFrom: 'settings', copyFrom: 'queue' });
  assert.deepEqual(effectiveModes({ subEmbed: 'always', subCopy: 'notEmbedded' }, settings),
    { embed: 'always', copy: 'notEmbedded', embedFrom: 'job', copyFrom: 'job' });
});

test('subtitles: HandBrakeCLI arguments and copied file names', () => {
  const args = handbrakeArgs([
    { file: { lang: 'ita' }, tmp: '/d/job-1-sub-1.srt' },
    { file: { lang: null, forced: true }, tmp: '/d/job-1-sub-2.srt' },
    { file: { lang: 'fre', forced: true }, tmp: '/d/job-1-sub-3.ass' },
  ]);
  assert.deepEqual(args, [
    '--srt-file', '/d/job-1-sub-1.srt,/d/job-1-sub-2.srt', '--srt-lang', 'ita,und', '--srt-codeset', 'UTF-8,UTF-8', '--srt-default=2',
    '--ssa-file', '/d/job-1-sub-3.ass', '--ssa-lang', 'fre',
  ]);
  assert.deepEqual(handbrakeArgs([]), []);
  const taken = new Set(['movie.en.srt']);
  const out = path.join('/t', 'Movie.mkv');
  assert.equal(targetName(out, { lang: 'eng', format: 'srt' }, taken), 'Movie.en.2.srt');
  assert.equal(targetName(out, { lang: 'ita', forced: true, sdh: true, format: 'srt' }, taken), 'Movie.it.forced.sdh.srt');
  assert.equal(targetName(out, { lang: null, format: 'ass' }, taken), 'Movie.ass');
  assert.equal(targetName(out, { lang: 'eng', format: 'idx' }, taken), 'Movie.en.idx');
  assert.ok(taken.has('movie.en.sub'));
});

test('subtitles: choices survive looking again', () => {
  const old = [{ path: '/a.en.srt', include: false, lang: 'ita', forced: true, sdh: false, edits: { offsetMs: 100 } }];
  const merged = mergeSidecars(old, [
    { path: '/a.en.srt', name: 'a.en.srt', format: 'srt', match: 'name', lang: 'eng', forced: false, sdh: false },
    { path: '/a.fr.srt', name: 'a.fr.srt', format: 'srt', match: 'name', lang: 'fre', forced: false, sdh: false },
  ]);
  assert.deepEqual(merged.map((f) => [f.include, f.lang, f.forced, f.edits]), [[false, 'ita', true, { offsetMs: 100 }], [true, 'fre', false, {}]]);
  assert.equal(merged[0].detected.lang, 'eng');
});

test('subtitles: settings are validated', async () => {
  const dir = await tmpDir();
  try {
    await fs.mkdir(path.join(dir, 's'));
    await fs.mkdir(path.join(dir, 't'));
    const settings = new Settings(openDb(':memory:'), { initialSourceRoot: path.join(dir, 's'), initialTargetRoot: path.join(dir, 't') });
    assert.equal(settings.get('subtitleEmbed'), 'missing');
    assert.equal(settings.get('subtitleCopy'), 'always');
    await settings.update({ subtitleExtensions: ['.SRT', 'ass'], queueSubtitles: { embed: 'always' } });
    assert.deepEqual(settings.get('subtitleExtensions'), ['srt', 'ass']);
    assert.deepEqual(settings.get('queueSubtitles'), { embed: 'always', copy: null });
    await assert.rejects(settings.update({ subtitleEmbed: 'sometimes' }), /subtitleEmbed/);
    await assert.rejects(settings.update({ subtitleExtensions: ['txt'] }), /Unsupported/);
    await assert.rejects(settings.update({ subtitleCodeset: 'klingon' }), /codeset/);
    await assert.rejects(settings.update({ queueSubtitles: { copy: 'maybe' } }), /queueSubtitles/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ queue

async function setupQueue({ format = 'av_mkv', presetSubs = { SubtitleTrackSelectionBehavior: 'all', SubtitleLanguageList: ['any'] } } = {}) {
  const dir = await tmpDir('hbui-subq-');
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  const data = path.join(dir, 'data');
  for (const x of [src, out, data, path.join(data, 'logs'), path.join(data, 'tmp')]) await fs.mkdir(x, { recursive: true });
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: out });
  const encodes = [];
  const handbrake = {
    scan: async () => ({ duration: 60, subtitles: [{ lang: 'eng', format: 'SRT' }] }),
    encode(opts) {
      // Copies what HandBrake would get, before the queue removes the temporary files.
      const files = [];
      const i = opts.extraArgs.indexOf('--srt-file');
      const reads = i >= 0 ? opts.extraArgs[i + 1].split(',').map((f) => fs.readFile(f, 'utf8')) : [];
      encodes.push({ opts, files });
      setImmediate(async () => {
        files.push(...(await Promise.all(reads)));
        await fs.writeFile(opts.output, 'video');
        opts.onExit(0, null, null);
      });
      return { kill() {} };
    },
  };
  const preset = { id: 1, name: 'P', json: JSON.stringify({ PresetList: [{ PresetName: 'P', ...presetSubs }] }), summary: { format } };
  const presets = { resolve: () => preset, get: () => preset };
  const events = { emit() {} };
  const queue = new Queue({ db, settings, presets, handbrake, verifier: null, events, dataDir: data, log: quiet });
  const subtitles = new Subtitles({ settings, tmpDir: path.join(data, 'tmp'), log: quiet });
  queue.subs = subtitles;
  const renamer = new Renamer({ db, settings, events, log: quiet, subtitles });
  queue.renamer = renamer;
  const done = async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, src, out, data, db, settings, queue, renamer, subtitles, encodes, done };
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('queue: missing languages are embedded, every sidecar is copied next to the output', async () => {
  const t = await setupQueue();
  try {
    const video = path.join(t.src, 'Show', 'Ep.mkv');
    await touch(video, 'x');
    await touch(path.join(t.src, 'Show', 'Ep.en.srt'), SRT);
    await touch(path.join(t.src, 'Show', 'Ep.it.forced.srt'), Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nCos\xec\n', 'latin1'));
    const { added: [id] } = await t.queue.add({ paths: [video] });
    await until(() => t.queue.get(id).subtitles);
    assert.deepEqual(t.queue.get(id).subtitles.map((f) => f.name), ['Ep.en.srt', 'Ep.it.forced.srt']);
    // Shift the Italian one by 1 s.
    t.queue.updateSubtitles(id, { files: [{ path: path.join(t.src, 'Show', 'Ep.it.forced.srt'), edits: { offsetMs: 1000 } }] });

    t.queue.setRunning(true);
    await until(() => t.queue.get(id).status === 'done' && t.queue.get(id).subtitleResult?.copied?.length);
    const { opts, files } = t.encodes[0];
    // English is in the source already: only Italian is embedded, as the forced default track.
    assert.deepEqual(opts.extraArgs.filter((a) => !a.includes('job-')), ['--srt-file', '--srt-lang', 'ita', '--srt-codeset', 'UTF-8', '--srt-default=1']);
    assert.match(files[0], /00:00:02,000 --> 00:00:03,000\r\nCosì/);
    const job = t.queue.get(id);
    assert.deepEqual(job.subtitleResult.embedded, ['Ep.it.forced.srt']);
    const copied = job.subtitleResult.copied.map((c) => path.relative(t.out, c.to));
    assert.deepEqual(copied, [path.join('Show', 'Ep.en.srt'), path.join('Show', 'Ep.it.forced.srt')]);
    assert.match(await fs.readFile(path.join(t.out, 'Show', 'Ep.it.forced.srt'), 'utf8'), /Così/);
    // Temporary files are gone.
    assert.deepEqual((await fs.readdir(path.join(t.data, 'tmp'))).filter((f) => f.includes('sub')), []);

    // Renaming the video takes the copies along, and undo brings them back.
    const r = await t.renamer.apply({ items: [{ path: job.outputPath, newName: 'Episode.mkv' }] });
    assert.equal(r.renamed.length, 3);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Episode.en.srt', 'Episode.it.forced.srt', 'Episode.mkv']);
    assert.match(t.queue.get(id).subtitleResult.copied[0].to, /Episode\.en\.srt$/);

    // "Write again" after a new edit overwrites the same files.
    t.queue.updateSubtitles(id, { files: [{ path: path.join(t.src, 'Show', 'Ep.en.srt'), edits: { cleanup: { tags: true } } }] });
    await t.queue.rewriteSubtitles(id);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Episode.en.srt', 'Episode.it.forced.srt', 'Episode.mkv']);
    assert.doesNotMatch(await fs.readFile(path.join(t.out, 'Show', 'Episode.en.srt'), 'utf8'), /<i>/);

    // A changed language or flag renames the copy; the two files can even swap names.
    t.queue.updateSubtitles(id, { files: [
      { path: path.join(t.src, 'Show', 'Ep.en.srt'), lang: 'ita', forced: true },
      { path: path.join(t.src, 'Show', 'Ep.it.forced.srt'), lang: 'eng', forced: false },
    ] });
    await t.queue.rewriteSubtitles(id);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Episode.en.srt', 'Episode.it.forced.srt', 'Episode.mkv']);
    assert.match(await fs.readFile(path.join(t.out, 'Show', 'Episode.en.srt'), 'utf8'), /Così/);
    t.queue.updateSubtitles(id, { files: [{ path: path.join(t.src, 'Show', 'Ep.en.srt'), lang: 'ger', forced: false }] });
    await t.queue.rewriteSubtitles(id);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Episode.de.srt', 'Episode.en.srt', 'Episode.mkv']);
    // Back as it was, so the undo below finds the names it recorded.
    t.queue.updateSubtitles(id, { files: [
      { path: path.join(t.src, 'Show', 'Ep.en.srt'), lang: 'eng' },
      { path: path.join(t.src, 'Show', 'Ep.it.forced.srt'), lang: 'ita', forced: true },
    ] });
    await t.queue.rewriteSubtitles(id);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Episode.en.srt', 'Episode.it.forced.srt', 'Episode.mkv']);

    const [h] = t.renamer.history();
    const u = await t.renamer.undo(h.id);
    assert.equal(u.restored, 1);
    assert.deepEqual((await fs.readdir(path.join(t.out, 'Show'))).sort(), ['Ep.en.srt', 'Ep.it.forced.srt', 'Ep.mkv']);
  } finally {
    await t.done();
  }
});

test('queue: job and queue modes; nothing embedded into WebM; source files untouched', async () => {
  const t = await setupQueue({ format: 'av_webm' });
  try {
    const video = path.join(t.src, 'Film.mkv');
    await touch(video, 'x');
    const sub = path.join(t.src, 'Film.fr.srt');
    await touch(sub, SRT);
    t.settings.set('queueSubtitles', { embed: null, copy: 'never' });
    const { added: [id] } = await t.queue.add({ paths: [video] });
    await until(() => t.queue.get(id).subtitles);
    assert.equal(t.queue.subtitleInfo(id).effective.copyFrom, 'queue');
    t.queue.updateSubtitles(id, { embed: 'always', copy: 'notEmbedded' });
    const info = t.queue.subtitleInfo(id);
    assert.deepEqual([info.effective.embed, info.effective.copy, info.files[0].why], ['always', 'notEmbedded', 'container']);
    t.queue.setRunning(true);
    await until(() => t.queue.get(id).status === 'done' && t.queue.get(id).subtitleResult?.copied?.length);
    assert.deepEqual(t.encodes[0].opts.extraArgs, []);
    assert.deepEqual((await fs.readdir(t.out)).sort(), ['Film.fr.srt', 'Film.webm']);
    assert.equal(await fs.readFile(sub, 'utf8'), SRT);
    assert.throws(() => t.queue.updateSubtitles(id, { embed: 'sometimes' }), /embed must be/);
  } finally {
    await t.done();
  }
});

test('queue: preview of edits and deleting a source takes its sidecars', async () => {
  const t = await setupQueue();
  try {
    const video = path.join(t.src, 'Film.mkv');
    await touch(video, 'x');
    await touch(path.join(t.src, 'Film.en.srt'), SRT);
    const { added: [id] } = await t.queue.add({ paths: [video] });
    await until(() => t.queue.get(id).subtitles);
    const p = await t.queue.subtitlePreview(id, { path: path.join(t.src, 'Film.en.srt'), edits: { cleanup: { tags: true } } });
    assert.equal(p.codeset, 'UTF-8');
    assert.deepEqual(p.edited.map((c) => c.text), ['Hello', 'World']);
    assert.equal(p.original[1].text, '<i>World</i>');
    await assert.rejects(t.queue.subtitlePreview(id, { path: path.join(t.src, 'Other.srt') }), /not one of/);

    await t.queue.remove([id]);
    const files = new SourceFiles({ settings: t.settings, queue: t.queue, events: { emit() {} }, log: quiet, subtitles: t.subtitles });
    const preview = await files.preview({ paths: [video] });
    assert.deepEqual(preview.items.map((i) => [path.basename(i.path), i.sidecarOf ? 'sidecar' : 'chosen']), [['Film.mkv', 'chosen'], ['Film.en.srt', 'sidecar']]);
  } finally {
    await t.done();
  }
});

test('download: a video with its subtitle files, from the target and from a sources folder', async () => {
  const { Downloads } = await import('../src/download.js');
  const dir = await tmpDir('hbui-subdl-');
  try {
    const src = path.join(dir, 'src');
    const out = path.join(dir, 'out');
    await touch(path.join(out, 'Show', 'Ep.mkv'), 'video');
    await touch(path.join(out, 'Show', 'Ep.en.srt'), SRT);
    await touch(path.join(out, 'Show', 'Ep.it.forced.srt'), SRT);
    await touch(path.join(out, 'Show', 'Other.srt'), SRT);
    await touch(path.join(src, 'Film', 'Film.mkv'), 'video');
    await touch(path.join(src, 'Film', 'Subs', '2_English.srt'), SRT);
    const settings = new Settings(openDb(':memory:'), { initialSourceRoot: src, initialTargetRoot: out });
    const subtitles = new Subtitles({ settings, tmpDir: dir, log: quiet });
    const downloads = new Downloads({ settings, log: quiet, subtitles });

    const ep = path.join(out, 'Show', 'Ep.mkv');
    const film = path.join(src, 'Film', 'Film.mkv');
    const found = await downloads.subtitlesFor([ep, film]);
    assert.equal(found.count, 3);
    assert.deepEqual(found.files[ep].map((p) => path.basename(p)).sort(), ['Ep.en.srt', 'Ep.it.forced.srt']);
    assert.deepEqual(found.files[film], [path.join(src, 'Film', 'Subs', '2_English.srt')]);

    const zip = await downloads.prepareZip({ paths: [film], withSubtitles: true });
    assert.equal(zip.name, 'Film.zip');
    assert.equal(zip.subtitles, 1);
    const names = downloads.tokens.get(zip.id).plan.items.map((i) => i.name);
    assert.deepEqual(names, ['Film.mkv', 'Subs/2_English.srt']);
    // Without asking for them: only the video, named as before.
    const plain = await downloads.prepareZip({ paths: [ep] });
    assert.deepEqual([plain.name, plain.files, plain.subtitles], ['Ep.mkv.zip', 1, 0]);
    // Turned off: no subtitle files.
    settings.set('subtitleExtensions', []);
    assert.equal((await downloads.subtitlesFor([ep])).count, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
