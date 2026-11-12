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
import { NamingChecks } from '../src/rename/naming.js';

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

// dir is the target folder, src a sources folder; both inside one temporary folder.
async function setup() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-rename-'));
  const dir = path.join(base, 'target');
  const src = path.join(base, 'src');
  await fs.mkdir(dir);
  await fs.mkdir(src);
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: dir });
  const events = { emit() {} };
  const renamer = new Renamer({ db, settings, events, log: console });
  return { dir, src, db, renamer, settings, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

const addJob = (db, status, source, output = '/out/x.mkv') =>
  db.prepare(`INSERT INTO jobs (status, position, source_path, output_path, preset_name, preset_json, format, created_at)
    VALUES (?, 1, ?, ?, 'P', '{}', 'av_mkv', 0)`).run(status, source, output);

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

test('naming check lists wrong names and warnings, not names that are already right', async () => {
  const { dir, renamer, cleanup } = await setup();
  try {
    const show = path.join(dir, 'Silo');
    await fs.mkdir(show);
    await fs.writeFile(path.join(show, 'Silo S03e06 - The Book.mkv'), '');
    await fs.writeFile(path.join(show, 'Silo.S03E07.Radio.1080p.WEBRip.x265.mkv'), 'abc');
    await fs.writeFile(path.join(dir, 'Movie (2020).mkv'), '');
    await fs.writeFile(path.join(dir, 'Excalibur.mkv'), '');
    await fs.writeFile(path.join(dir, 'notes.txt'), '');
    const auto = renamer.listRules()[0];
    const r = await renamer.check({ paths: [dir], ruleId: auto.id });
    assert.equal(r.total, 4);
    assert.equal(r.ruleName, auto.name);
    const byOld = Object.fromEntries(r.rows.map((x) => [x.oldName, x]));
    assert.deepEqual(Object.keys(byOld).sort(), ['Excalibur.mkv', 'Silo.S03E07.Radio.1080p.WEBRip.x265.mkv']);
    const wrong = byOld['Silo.S03E07.Radio.1080p.WEBRip.x265.mkv'];
    assert.equal(wrong.expected, 'Silo S03e07 - Radio.mkv');
    assert.equal(wrong.dir, show);
    assert.deepEqual(wrong.warnings, []);
    // Already as the rule set would name it, but not recognised: listed with its warning only.
    assert.equal(byOld['Excalibur.mkv'].expected, null);
    assert.deepEqual(byOld['Excalibur.mkv'].warnings, ['no year found']);

    // A TV rule set reads the movie as a missing episode number.
    const tv = renamer.listRules().find((x) => x.name === 'TV series');
    const t = await renamer.check({ paths: [path.join(dir, 'Movie (2020).mkv')], ruleId: tv.id });
    assert.equal(t.total, 1);
    assert.match(t.rows[0].warnings[0], /no episode number/);

    await assert.rejects(renamer.check({ paths: [], ruleId: auto.id }), /Choose at least one/);
    await assert.rejects(renamer.check({ paths: [dir], ruleId: 9999 }), /not found/);
    await assert.rejects(renamer.check({ paths: [os.tmpdir()], ruleId: auto.id }), /outside/);
  } finally {
    await cleanup();
  }
});

test('naming checks are saved, mark renamed files as gone and keep the newest 20', async () => {
  const { dir, renamer, settings, cleanup } = await setup();
  try {
    const db = settings.db;
    const emitted = [];
    const naming = new NamingChecks({ db, renamer, events: { emit: (e) => emitted.push(e) } });
    const bad = path.join(dir, 'Silo.S03E07.Radio.1080p.WEBRip.x265.mkv');
    await fs.writeFile(bad, 'abc');
    await fs.writeFile(path.join(dir, 'Movie (2020).mkv'), '');
    const auto = renamer.listRules()[0];

    const r = await naming.run({ paths: [dir], ruleId: auto.id });
    assert.deepEqual(emitted, ['namingChecks']);
    assert.equal(r.total, 2);
    assert.equal(r.flagged, 1);
    assert.equal(r.ruleName, auto.name);
    assert.deepEqual(r.paths, [dir]);
    assert.equal(r.rows[0].expected, 'Silo S03e07 - Radio.mkv');
    assert.equal(r.rows[0].size, 3);
    assert.equal(r.rows[0].gone, false);
    assert.deepEqual(naming.list().map((c) => c.id), [r.id]);
    assert.equal(naming.list()[0].rows, undefined, 'the list has no rows');

    // Renamed after the check: the saved row is marked, not dropped.
    await renamer.apply({ items: [{ path: bad, newName: r.rows[0].expected }] });
    const again = await naming.get(r.id);
    assert.equal(again.rows[0].gone, true);
    assert.equal(again.rows[0].size, null);

    for (let i = 0; i < 21; i++) await naming.run({ paths: [dir], ruleId: auto.id });
    const ids = naming.list().map((c) => c.id);
    assert.equal(ids.length, 20);
    assert.ok(!ids.includes(r.id), 'the oldest result was dropped');

    naming.remove(ids[0]);
    assert.equal(naming.list().length, 19);
    await assert.rejects(naming.get(ids[0]), /not found/);
  } finally {
    await cleanup();
  }
});

test('sources folders can be renamed too, except protected folders and queued files', async () => {
  const { dir, src, db, renamer, settings, cleanup } = await setup();
  try {
    const auto = renamer.listRules()[0];
    const done = path.join(src, 'Silo.S03E07.Radio.1080p.WEBRip.x265.mkv');
    const queued = path.join(src, 'Silo.S03E08.Flood.1080p.mkv');
    await fs.writeFile(done, '');
    await fs.writeFile(queued, '');
    addJob(db, 'done', done);
    addJob(db, 'queued', queued);
    db.prepare(`INSERT INTO watch_seen (path, folder, seen_at, action) VALUES (?, ?, 0, 'added')`).run(done, src);

    const rows = await renamer.preview({ paths: [src], ruleId: auto.id });
    const byOld = Object.fromEntries(rows.map((r) => [r.oldName, r]));
    assert.equal(byOld['Silo.S03E07.Radio.1080p.WEBRip.x265.mkv'].status, 'rename');
    const q = byOld['Silo.S03E08.Flood.1080p.mkv'];
    assert.equal(q.status, 'blocked');
    assert.equal(q.newName, 'Silo S03e08 - Flood.mkv');
    assert.match(q.warnings[0], /^queued or converting/);

    const r = await renamer.apply({ items: [{ path: done, newName: 'Silo S03e07 - Radio.mkv' }, { path: queued, newName: 'x.mkv' }] });
    const to = path.join(src, 'Silo S03e07 - Radio.mkv');
    assert.deepEqual(r.renamed.map((x) => x.to), [to]);
    assert.match(r.errors[0].error, /^queued or converting/);
    assert.ok(await fs.access(queued).then(() => true));
    // The job and the watch folder follow the renamed source.
    assert.equal(db.prepare(`SELECT source_path FROM jobs WHERE status = 'done'`).get().source_path, to);
    assert.equal(db.prepare('SELECT path FROM watch_seen').get().path, to);

    // Undo is refused for a file queued under its new name meanwhile.
    addJob(db, 'queued', to);
    const [h] = renamer.history();
    const undo = await renamer.undo(h.id);
    assert.equal(undo.restored, 0);
    assert.ok(undo.errors.some((e) => /queued or converting/.test(e.error)));
    db.prepare(`DELETE FROM jobs WHERE status = 'queued' AND source_path = ?`).run(to);

    // A protected sources folder: shown, never renamed.
    await settings.update({ protectedRoots: [src] });
    const [p] = await renamer.preview({ paths: [to], ruleId: auto.id });
    assert.equal(p.status, 'unchanged');
    const [p2] = await renamer.preview({ paths: [queued], ruleId: auto.id });
    assert.match(p2.warnings[0], /protected folder/);
    const r2 = await renamer.apply({ items: [{ path: to, newName: 'other.mkv' }] });
    assert.equal(r2.renamed.length, 0);
    assert.match(r2.errors[0].error, /protected folder/);
    // The target folder is not affected.
    await fs.writeFile(path.join(dir, 'a.mkv'), '');
    assert.equal((await renamer.apply({ items: [{ path: path.join(dir, 'a.mkv'), newName: 'b.mkv' }] })).renamed.length, 1);

    // The naming check reads sources folders and marks blocked files.
    const naming = new NamingChecks({ db, renamer, events: { emit() {} } });
    const c = await naming.run({ paths: [src], ruleId: auto.id });
    assert.deepEqual(c.rows.map((x) => x.oldName), ['Silo.S03E08.Flood.1080p.mkv']);
    assert.match(c.rows[0].blocked, /protected folder/);
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
