// The preset editor's server side: parsing HandBrakeCLI's lists, and creating, editing
// and normalising presets (with a fake HandBrakeCLI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { parseBuiltinPresets, parseEncoderList, parseHelpList } from '../src/handbrake.js';
import { Presets, asUserPreset, cleanProperties, mergeWithTemplate } from '../src/presets.js';
import { TEMPLATE } from '../src/presetDefaults.js';
import { extensionForFormat } from '../src/paths.js';

const pad = (n) => ' '.repeat(n);

test('parseHelpList reads the lists in HandBrakeCLI --help', () => {
  const help = [
    '   -f, --format <string>   Select container format:',
    `${pad(31)}av_mp4`,
    `${pad(31)}av_mkv`,
    `${pad(27)}default: auto-detected from destination file name)`,
    '   -E, --aencoder <string> Select audio encoder(s):',
    `${pad(31)}av_aac`,
    `${pad(31)}copy:aac`,
    `${pad(31)}copy`,
    `${pad(27)}"copy:<type>" will enable passthru of the `,
  ].join('\n');
  assert.deepEqual(parseHelpList(help, 'Select container format:'), ['av_mp4', 'av_mkv']);
  assert.deepEqual(parseHelpList(help, 'Select audio encoder(s):'), ['av_aac', 'copy:aac', 'copy']);
  assert.deepEqual(parseHelpList(help, 'Select video encoder:'), []);
});

test('parseEncoderList reads --encoder-*-list output', () => {
  const text = "[12:00:00] hb_init: starting libhb thread\nAvailable --encoder-preset values for 'x264' encoder:\n    ultrafast\n    medium\n    placebo\n";
  assert.deepEqual(parseEncoderList(text), ['ultrafast', 'medium', 'placebo']);
  assert.deepEqual(parseEncoderList("Available --encoder-level values for 'theora' encoder:\n    Option not supported by encoder\n"), []);
  assert.equal(parseEncoderList('something else'), null);
});

test('parseBuiltinPresets reads --preset-list, folders and descriptions', () => {
  const text = [
    '[12:00:00] Compile-time hardening features are enabled',
    'General/',
    '    Very Fast 1080p30',
    '        Small H.264 video (up to 1080p30) and AAC stereo audio, in',
    '        an MP4 container.',
    '    Fast 1080p30',
    'Matroska/',
    '    H.265 MKV 2160p60',
    '        H.265 video (up to 2160p60) in an MKV container.',
    'HandBrake has exited.',
  ].join('\n');
  assert.deepEqual(parseBuiltinPresets(text), [
    { category: 'General', name: 'Very Fast 1080p30', description: 'Small H.264 video (up to 1080p30) and AAC stereo audio, in an MP4 container.' },
    { category: 'General', name: 'Fast 1080p30', description: '' },
    { category: 'Matroska', name: 'H.265 MKV 2160p60', description: 'H.265 video (up to 2160p60) in an MKV container.' },
  ]);
});

test('cleanProperties and asUserPreset', () => {
  assert.deepEqual(cleanProperties({ name: '  TV  ', category: ' ', description: '' }), { name: 'TV', category: null, description: null });
  assert.throws(() => cleanProperties({ name: '  ' }), /needs a name/);
  assert.throws(() => cleanProperties({ name: 'a/b' }), /cannot contain/);
  const p = asUserPreset({ PresetName: 'Fast 1080p30', Type: 0, Default: true, ChildrenArray: [{}], VideoEncoder: 'x264' }, { name: 'Mine', description: null });
  assert.equal(p.PresetName, 'Mine');
  assert.equal(p.PresetDescription, '');
  assert.equal(p.Type, 1);
  assert.equal(p.Default, false);
  assert.deepEqual(p.ChildrenArray, []);
  assert.equal(p.VideoEncoder, 'x264');
});

test('mergeWithTemplate fills missing settings and drops unknown keys', () => {
  const m = mergeWithTemplate({ VideoEncoder: 'x265', Bogus: 1, AudioList: [{ AudioEncoder: 'av_aac' }] });
  assert.equal(m.VideoEncoder, 'x265');
  assert.equal(m.Bogus, undefined);
  assert.equal(m.PictureCropMode, TEMPLATE.PictureCropMode);
  assert.equal(m.AudioList[0].AudioEncoder, 'av_aac');
  assert.equal(m.AudioList[0].AudioMixdown, TEMPLATE.AudioList[0].AudioMixdown);
});

test('extensionForFormat knows the generic container names', () => {
  assert.equal(extensionForFormat('mp4'), '.mp4');
  assert.equal(extensionForFormat('av_mov'), '.mov');
  assert.equal(extensionForFormat('av_webm'), '.webm');
  assert.equal(extensionForFormat('unknown'), '.mkv');
});

async function setup(handbrake) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-presets-'));
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: dir, initialTargetRoot: dir });
  const hb = {
    available: async () => false,
    capabilities: async () => null,
    builtinPresets: async () => null,
    validatePresetFile: async () => null,
    ...handbrake,
  };
  return { presets: new Presets({ db, settings, handbrake: hb, tmpDir: path.join(dir, 'tmp') }), settings, db };
}

test('Presets: create, edit, rename and copy without HandBrakeCLI', async () => {
  const { presets, settings } = await setup();
  const a = await presets.create({ name: 'My TV', category: 'Mine', description: 'small', preset: { VideoEncoder: 'x265', VideoQualitySlider: 24 } });
  assert.equal(settings.get('defaultPresetId'), a.id, 'the first preset becomes the default');
  const stored = JSON.parse(presets.get(a.id).json);
  assert.equal(stored.VersionMajor, 72);
  const p = stored.PresetList[0];
  assert.equal(p.PresetName, 'My TV');
  assert.equal(p.PresetDescription, 'small');
  assert.equal(p.Type, 1);
  assert.equal(p.VideoEncoder, 'x265');
  assert.equal(p.AudioTrackSelectionBehavior, TEMPLATE.AudioTrackSelectionBehavior, 'missing settings come from the template');
  assert.equal(presets.get(a.id).summary.videoEncoder, 'x265');
  assert.equal(presets.get(a.id).updatedAt, null);

  await assert.rejects(presets.create({ name: 'My TV', category: 'Mine', preset: {} }), /already a preset/);
  // Same name in another category is fine.
  const other = await presets.create({ name: 'My TV', preset: {} });

  const ed = await presets.editable(a.id);
  assert.equal(ed.preset.VideoQualitySlider, 24);
  assert.equal(ed.json, undefined);
  assert.equal(ed.version.VersionMajor, 72);

  await presets.update(a.id, { preset: { ...ed.preset, VideoQualitySlider: 21 }, version: ed.version, name: 'My TV 2', category: '', description: '' });
  const after = presets.get(a.id);
  assert.equal(after.name, 'My TV 2');
  assert.equal(after.category, null);
  assert.equal(after.description, null);
  assert.ok(after.updatedAt > 0);
  const json = JSON.parse(after.json).PresetList[0];
  assert.equal(json.VideoQualitySlider, 21);
  assert.equal(json.PresetName, 'My TV 2');
  assert.equal(after.summary.quality, 'RF 21');

  // Renaming onto another preset's name and category is refused.
  await assert.rejects(presets.update(a.id, { name: 'My TV', category: null }), /already a preset/);
  assert.ok(other.id);

  // A copy keeps the settings under a new name.
  const copy = await presets.create({ name: 'Copy', fromId: a.id });
  assert.equal(JSON.parse(presets.get(copy.id).json).PresetList[0].VideoQualitySlider, 21);

  // Without HandBrakeCLI there are no built-in presets to start from.
  await assert.rejects(presets.create({ name: 'B', builtin: 'Fast 1080p30' }), /not installed/);
});

test('Presets: importing again resets "edited"', async () => {
  const { presets } = await setup();
  const [r] = await presets.import({ PresetList: [{ PresetName: 'Imp', VideoEncoder: 'x264' }], VersionMajor: 72 }, 'imp.json');
  await presets.update(r.id, { description: 'changed' });
  assert.ok(presets.get(r.id).updatedAt);
  await presets.import({ PresetList: [{ PresetName: 'Imp', VideoEncoder: 'x264' }], VersionMajor: 72 }, 'imp.json');
  assert.equal(presets.get(r.id).updatedAt, null);
});

test('Presets: normalising goes through HandBrakeCLI export under a temporary name', async () => {
  const calls = [];
  const { presets } = await setup({
    available: async () => true,
    builtinPresets: async () => [{ category: 'General', name: 'Fast 1080p30', description: '' }],
    async exportPreset({ name, importFile, outFile }) {
      let preset;
      if (importFile) {
        const file = JSON.parse(await fs.readFile(importFile, 'utf8'));
        calls.push({ name, version: file.VersionMajor, presetName: file.PresetList[0].PresetName });
        preset = { ...file.PresetList[0], Upgraded: true };
      } else {
        calls.push({ name, builtin: true });
        preset = { PresetName: name, Type: 0, Default: true, VideoEncoder: 'x264', PresetDescription: 'HandBrake' };
      }
      await fs.writeFile(outFile, JSON.stringify({ PresetList: [preset], VersionMajor: 72, VersionMinor: 0, VersionMicro: 0 }));
      return JSON.parse(await fs.readFile(outFile, 'utf8'));
    },
  });

  const b = await presets.create({ name: 'From HB', builtin: 'Fast 1080p30' });
  const p = JSON.parse(presets.get(b.id).json).PresetList[0];
  assert.equal(p.PresetName, 'From HB');
  assert.equal(p.PresetDescription, '');
  assert.equal(p.Type, 1);
  assert.equal(p.Default, false);
  assert.equal(p.Upgraded, true);
  assert.equal(calls[0].builtin, true);
  // The import uses a unique name that can't match a built-in preset, and keeps the version.
  assert.match(calls[1].name, /^normalize-in-/);
  assert.equal(calls[1].presetName, calls[1].name);
  assert.equal(calls[1].version, 72);

  // An editor save without a version is treated as the template's version, not as version 0.
  await presets.update(b.id, { preset: p });
  assert.equal(calls.at(-1).version, 72);

  await assert.rejects(presets.create({ name: 'X', builtin: 'Nope' }), /no built-in preset/);
  const left = await fs.readdir(presets.tmpDir);
  assert.deepEqual(left, [], 'temporary files are removed');
});
