import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonBlockParser } from '../src/handbrake.js';
import { extractPresets, summarize } from '../src/presets.js';
import { isInside, makeFileMatcher, plannedOutputPath, rootOf, uniquePath } from '../src/paths.js';

const presetFile = JSON.parse(
  await fs.readFile(path.join(import.meta.dirname, 'fixtures/preset-gerry.json'), 'utf8'),
);

test('JsonBlockParser splits pretty-printed blocks across chunks', () => {
  const blocks = [];
  const text = [];
  const p = new JsonBlockParser({ onBlock: (l, d) => blocks.push([l, d]), onText: (t) => text.push(t) });
  const out =
    'Progress: {\n    "State": "WORKING",\n    "Working": {\n        "Progress": 0.5,\n        "Path": "a } b"\n    }\n}\n' +
    'hello\r\nJSON Title Set: {\n    "TitleList": []\n}\n';
  for (let i = 0; i < out.length; i += 7) p.push(out.slice(i, i + 7));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0][0], 'Progress');
  assert.equal(blocks[0][1].Working.Progress, 0.5);
  assert.equal(blocks[1][0], 'JSON Title Set');
  assert.deepEqual(text, ['hello']);
});

test('extractPresets reads the gerry export and nested folders', () => {
  const found = extractPresets(presetFile);
  assert.equal(found.length, 1);
  assert.equal(found[0].preset.PresetName, 'Gerry Medium TV Series 720');

  const nested = extractPresets({
    PresetList: [{ Folder: true, PresetName: 'My', ChildrenArray: [{ PresetName: 'A' }, { PresetName: 'B' }] }],
  });
  assert.deepEqual(nested.map((p) => [p.category, p.preset.PresetName]), [['My', 'A'], ['My', 'B']]);
  assert.throws(() => extractPresets({ foo: 1 }), /PresetList/);
});

test('summarize describes the gerry preset', () => {
  const s = summarize(presetFile.PresetList[0]);
  assert.equal(s.videoEncoder, 'x264');
  assert.equal(s.quality, '1500 kbps');
  assert.equal(s.format, 'av_mkv');
  assert.equal(s.maxSize, '1280×720');
  assert.equal(s.framerate, '30 peak');
});

function fakeSettings(values) {
  return { get: (k) => values[k] };
}

test('plannedOutputPath follows the output layout', () => {
  const src = path.resolve('/src/Completed/Show.S01/ep1.avi');
  const base = { sourceRoots: [path.resolve('/other'), path.resolve('/src')], targetRoot: path.resolve('/out') };
  const out = (layout) => plannedOutputPath(src, fakeSettings({ ...base, outputLayout: layout }), 'av_mkv');
  assert.equal(out('parent'), path.resolve('/out/Show.S01/ep1.mkv'));
  assert.equal(out('mirror'), path.resolve('/out/Completed/Show.S01/ep1.mkv'));
  assert.equal(out('flat'), path.resolve('/out/ep1.mkv'));
  const top = plannedOutputPath(path.resolve('/src/x.mp4'), fakeSettings({ ...base, outputLayout: 'parent' }), 'av_mp4');
  assert.equal(top, path.resolve('/out/x.mp4'));
  // Each source keeps its path relative to the source folder it is in.
  const other = plannedOutputPath(path.resolve('/other/Film/f.avi'), fakeSettings({ ...base, outputLayout: 'mirror' }), 'av_mkv');
  assert.equal(other, path.resolve('/out/Film/f.mkv'));
});

test('plannedOutputPath season layout: target/Show/S01/episode', () => {
  const settings = fakeSettings({ sourceRoots: [path.resolve('/src')], targetRoot: path.resolve('/out'), outputLayout: 'season' });
  const out = (rel) => plannedOutputPath(path.resolve('/src', rel), settings, 'av_mkv');
  assert.equal(out('Completed/Show.S01/ep1.avi'), path.resolve('/out/Show/S01/ep1.mkv'));
  assert.equal(out('The.Office.US.S03.1080p.WEB-DL/e.mkv'), path.resolve('/out/The Office US/S03/e.mkv'));
  assert.equal(out('Show.2019.S2.720p/e.mkv'), path.resolve('/out/Show (2019)/S02/e.mkv'));
  assert.equal(out('Show (2019) - Season 4/e.mkv'), path.resolve('/out/Show (2019)/S04/e.mkv'));
  assert.equal(out('Mostro/Stagione 1/e.mkv'), path.resolve('/out/Mostro/S01/e.mkv'));
  // Source already in Show/S01: the show is the folder above the season folder.
  assert.equal(out('Show/S02/e.mkv'), path.resolve('/out/Show/S02/e.mkv'));
  assert.equal(out('Completed/Show (2019)/s1/e.mkv'), path.resolve('/out/Show (2019)/S01/e.mkv'));
  // An episode's own folder names the season too.
  assert.equal(out('Show.S01E05.1080p/Show.S01E05.mkv'), path.resolve('/out/Show/S01/Show.S01E05.mkv'));
  // A multi-season folder: the file name says the season.
  assert.equal(out('Show.S01-S03/Show.S02E01.mkv'), path.resolve('/out/Show/S02/Show.S02E01.mkv'));
  assert.equal(out('Show Seasons 1-3/Show 3x04.mkv'), path.resolve('/out/Show/S03/Show 3x04.mkv'));
  // No season folder: like "Source folder name".
  assert.equal(out('Completed/Film (2020)/f.mkv'), path.resolve('/out/Film (2020)/f.mkv'));
  assert.equal(out('Show.S01-S03/extras.mkv'), path.resolve('/out/Show.S01-S03/extras.mkv'));
  assert.equal(out('Season 1/e.mkv'), path.resolve('/out/Season 1/e.mkv'));
  assert.equal(out('Pulp Fiction S/e.mkv'), path.resolve('/out/Pulp Fiction S/e.mkv'));
  assert.equal(out('x.mkv'), path.resolve('/out/x.mkv'));
});

test('rootOf picks the deepest root that contains the path', () => {
  const roots = [path.resolve('/a'), path.resolve('/a/b'), path.resolve('/c')];
  assert.equal(rootOf(roots, path.resolve('/a/b/x.mkv')), path.resolve('/a/b'));
  assert.equal(rootOf(roots, path.resolve('/a/bb/x.mkv')), path.resolve('/a'));
  assert.equal(rootOf(roots, path.resolve('/d/x.mkv')), null);
});

test('uniquePath adds (1), (2)... and respects .part files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-'));
  const p = path.join(dir, 'a.mkv');
  assert.equal(await uniquePath(p), p);
  await fs.writeFile(p, '');
  assert.equal(await uniquePath(p), path.join(dir, 'a (1).mkv'));
  await fs.writeFile(path.join(dir, 'a (1).mkv.part'), '');
  assert.equal(await uniquePath(p), path.join(dir, 'a (2).mkv'));
  await fs.rm(dir, { recursive: true });
});

test('isInside and the file matcher', () => {
  assert.ok(isInside('/a/b', '/a/b'));
  assert.ok(isInside('/a/b', '/a/b/c'));
  assert.ok(!isInside('/a/b', '/a/bc'));
  assert.ok(!isInside('/a/b', '/a'));
  const m = makeFileMatcher(fakeSettings({ videoExtensions: ['mkv', 'avi'], excludePatterns: ['sample'] }));
  assert.ok(m.isVideo('x.MKV'));
  assert.ok(!m.isVideo('x.srt'));
  assert.ok(m.excluded('show-sample.mkv'));
  assert.ok(m.excluded('Sample'));
  assert.ok(!m.excluded('samples.of.life.mkv'));
});
