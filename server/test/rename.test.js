import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseName, fixApostrophes, titleCase, renderTemplate } from '../src/rename/parse.js';
import { importAren, normalizeSteps, runSteps } from '../src/rename/steps.js';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Renamer } from '../src/rename/renamer.js';

const smart = normalizeSteps([{ type: 'smart' }]);
const rename = (name, ctx) => {
  const i = name.lastIndexOf('.');
  const r = runSteps(name.slice(0, i), name.slice(i + 1), smart, ctx);
  return `${r.name}.${r.ext}`;
};

test('smart rename: TV episodes in both marker styles', () => {
  const cases = {
    'The.Rookie.6x01.La.Maledizione.Dell.Ultimo.Turno.ITA.ENG.1080p.NFRip.AAC.x265-Pir8.mkv':
      "The Rookie S06e01 - La Maledizione Dell'Ultimo Turno.mkv",
    '12.Monkeys.S04E01.The.End.1080p.AMZN.WEB-DL.ITA.ENG.DDP5.1.H.264-G66.mkv': '12 Monkeys S04e01 - The End.mkv',
    'Lanterns.S01E01.1080p.AMZN.WEB-DL.ITA.ENG.DDP5.1.H.265-G66.mkv': 'Lanterns S01e01.mkv',
    'The.English.S01E01.1080p.BDMux.AC3.ITA.ENG.G66.mkv': 'The English S01e01.mkv',
    'Weeds.S07E11.REPACK.Une.Mere.Que.Jaimerais.Baiser.720p.ITA-ENG.WEBRip.x265.AAC-V3SP4EV3R.mkv':
      'Weeds S07e11 - Une Mere Que Jaimerais Baiser.mkv',
    'East.of.Eden.2026.S01E01.Brothers.1080p.ITA-ENG.MULTI.WEBRip.x265.AAC-V3SP4EV3R.mkv': 'East Of Eden S01e01 - Brothers.mkv',
    'White.Collar.5x01.Le.Monete.D.Oro.ITA.ENG.DSNP.WEBRip.XviD-Pir8.avi': "White Collar S05e01 - Le Monete D'Oro.avi",
    'Show.S01E01E02.Double.1080p.mkv': 'Show S01e01-e02 - Double.mkv',
    'The.Max.Show.S01E01.Max.Headroom.1080p.MAX.WEB-DL.mkv': 'The Max Show S01e01 - Max Headroom.mkv',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(rename(from), to, from);
});

test('smart rename: show name typed by the user', () => {
  const n = 'S04E07 Reacher Tutti Con Sampson (2026) WEBRip 1080p x264 EAC3 ITA ENG SUB ITA ENG - Lullozzo.mkv';
  assert.match(parseName(n.slice(0, -4)).warnings[0], /no show name/);
  assert.equal(rename(n, { showOverride: 'Reacher' }), 'Reacher S04e07 - Tutti Con Sampson.mkv');
  // By default the typed name only fills a missing show...
  const other = 'Silo.S03E07.Radio.1080p.WEBRip.mkv';
  assert.equal(rename(other, { showOverride: 'Reacher' }), 'Silo S03e07 - Radio.mkv');
  // ...unless asked to replace it everywhere.
  assert.equal(rename(other, { showOverride: 'Silo (2023)', showOverrideAll: true }), 'Silo (2023) S03e07 - Radio.mkv');
});

test('smart rename: movies', () => {
  const cases = {
    'Mani pulite (2004) WEBRip 1080p x264 EAC3 ITA - Lullozzo.mkv': 'Mani Pulite (2004).mkv',
    'Cars.1.Motori.Rugenti.2006.ITA.ENG.UHDrip.HDR.HEVC.1080p.mkv': 'Cars 1 Motori Rugenti (2006).mkv',
    'L.Enfant.Du.Desert.2026.1080p.ITA-FRE.BluRay.x265.AAC-V3SP4EV3R.mkv': "L'Enfant Du Desert (2026).mkv",
    "L'uomo che cadde sulla terra (1976).ita.eng.multisub.MIRCrew.avi": "L'Uomo Che Cadde Sulla Terra (1976).avi",
    'Jesus Christ Superstar 2000 1080p BluRay HEVC x265 5.1 BONE.mkv': 'Jesus Christ Superstar (2000).mkv',
    '(BDRip 1080p) Excalibur.mkv': 'Excalibur.mkv',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(rename(from), to, from);
});

test('apostrophes, title case and templates', () => {
  assert.equal(fixApostrophes('She Wouldn t Be Gone'), "She Wouldn't Be Gone");
  assert.equal(fixApostrophes('Holston s Pick'), "Holston's Pick");
  assert.equal(fixApostrophes('Un Uomo Migliore'), 'Un Uomo Migliore');
  assert.equal(titleCase("l'osservatore e McLaren INXS"), "L'Osservatore E McLaren INXS");
  assert.equal(renderTemplate('{show} S{season}e{episode}[ - {title}]', { show: 'X', season: '01', episode: '02', title: '' }), 'X S01e02');
});

test('Advanced Renamer presets import with all methods', async () => {
  const dec = async (f) => new TextDecoder('utf-16le').decode(await fs.readFile(path.join(import.meta.dirname, 'fixtures', f))).replace(/^﻿/, '');
  const series = importAren(await dec('series.aren'));
  const movie = importAren(await dec('movie.aren'));
  assert.equal(series.steps.length, 51);
  assert.deepEqual(series.skipped, []);
  assert.equal(movie.steps.length, 11);
  assert.equal(series.steps.filter((s) => !s.active).length, 4);
  const r = runSteps('Afterburn.2025.1080p.ITA-ENG.WEBRip.x265.AAC-V3SP4EV3R', 'mkv', movie.steps);
  assert.equal(r.name, 'Afterburn (2025)');
  // \2 in Advanced Renamer becomes $2
  assert.equal(movie.steps[3].replaceWith, ' ($2)');
});

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-rename-'));
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: os.tmpdir(), initialTargetRoot: dir });
  const events = { emit() {} };
  const renamer = new Renamer({ db, settings, events, log: console });
  return { dir, renamer, settings, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('preview, collisions with _1, apply and undo on disk', async () => {
  const { dir, renamer, cleanup } = await setup();
  try {
    const a = path.join(dir, 'Silo.S03E07.Radio.1080p.WEBRip.x265.mkv');
    const b = path.join(dir, 'Silo.3x07.Radio.ITA.720p.mkv');
    await fs.writeFile(a, 'a');
    await fs.writeFile(b, 'b');
    await fs.writeFile(path.join(dir, 'Movie (2020).mkv'), 'x');
    const auto = renamer.listRules()[0];
    const rows = await renamer.preview({ paths: [dir], ruleId: auto.id });
    const byOld = Object.fromEntries(rows.map((r) => [r.oldName, r]));
    assert.equal(byOld['Silo.3x07.Radio.ITA.720p.mkv'].newName, 'Silo S03e07 - Radio.mkv');
    assert.equal(byOld['Silo.S03E07.Radio.1080p.WEBRip.x265.mkv'].newName, 'Silo S03e07 - Radio_1.mkv');
    assert.equal(byOld['Movie (2020).mkv'].status, 'unchanged');

    const result = await renamer.apply({
      items: rows.filter((r) => r.status === 'rename').map((r) => ({ path: r.path, newName: r.newName })),
      ruleName: auto.name,
    });
    assert.equal(result.errors.length, 0);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['Movie (2020).mkv', 'Silo S03e07 - Radio.mkv', 'Silo S03e07 - Radio_1.mkv']);

    const [h] = renamer.history();
    const undo = await renamer.undo(h.id);
    assert.equal(undo.restored, 2);
    assert.ok((await fs.readdir(dir)).includes('Silo.S03E07.Radio.1080p.WEBRip.x265.mkv'));
    await assert.rejects(renamer.undo(h.id), /already undone/);
  } finally {
    await cleanup();
  }
});

test('swapping two names works (two-phase rename)', async () => {
  const { dir, renamer, cleanup } = await setup();
  try {
    await fs.writeFile(path.join(dir, 'a.mkv'), 'A');
    await fs.writeFile(path.join(dir, 'b.mkv'), 'B');
    const r = await renamer.apply({
      items: [{ path: path.join(dir, 'a.mkv'), newName: 'b.mkv' }, { path: path.join(dir, 'b.mkv'), newName: 'a.mkv' }],
    });
    assert.equal(r.errors.length, 0);
    assert.equal(await fs.readFile(path.join(dir, 'a.mkv'), 'utf8'), 'B');
    await assert.rejects(renamer.apply({ items: [{ path: path.join(dir, 'a.mkv'), newName: '../x.mkv' }] }), /Invalid/);
    await assert.rejects(renamer.apply({ items: [{ path: path.join(os.tmpdir(), 'zz.mkv'), newName: 'x.mkv' }] }), /outside/);
  } finally {
    await cleanup();
  }
});

test('automatic rename only when recognised without warnings', async () => {
  const { dir, renamer, cleanup } = await setup();
  try {
    const good = path.join(dir, 'The.Rookie.7x01.Mine.Vaganti.ITA.ENG.1080p.DLMux.AAC.x265-Pir8.mkv');
    const bad = path.join(dir, '5) Cliff Richard.mkv');
    await fs.writeFile(good, '');
    await fs.writeFile(bad, '');
    const g = await renamer.autoRename(good);
    assert.equal(path.basename(g.path), 'The Rookie S07e01 - Mine Vaganti.mkv');
    assert.equal(g.note, null);
    const b = await renamer.autoRename(bad);
    assert.equal(b.path, bad);
    assert.match(b.note, /Needs rename: no year/);
  } finally {
    await cleanup();
  }
});
