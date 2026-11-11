// Scheduled backups: due times, a run into another folder, retention, catch-up and failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Backups } from '../src/backup.js';
import { BackupScheduler, lastDue, nextDue, normalizeBackupSchedule } from '../src/backupSchedule.js';

const d = (s) => new Date(s); // local time
const quiet = { info() {}, warn() {}, error() {} };

test('backup schedule: due times', () => {
  const daily = { frequency: 'daily', time: '03:00', weekday: 0 };
  assert.equal(lastDue(daily, d('2026-11-10T02:59')).getTime(), d('2026-11-09T03:00').getTime());
  assert.equal(lastDue(daily, d('2026-11-10T03:00')).getTime(), d('2026-11-10T03:00').getTime());
  assert.equal(nextDue(daily, d('2026-11-10T14:00')).getTime(), d('2026-11-11T03:00').getTime());
  // Weekly on Sunday (2026-11-08 and 2026-11-15 are Sundays).
  const weekly = { frequency: 'weekly', time: '03:00', weekday: 0 };
  assert.equal(lastDue(weekly, d('2026-11-10T12:00')).getTime(), d('2026-11-08T03:00').getTime());
  assert.equal(lastDue(weekly, d('2026-11-08T02:00')).getTime(), d('2026-11-01T03:00').getTime());
  assert.equal(nextDue(weekly, d('2026-11-10T12:00')).getTime(), d('2026-11-15T03:00').getTime());
});

test('backup schedule: validation', async () => {
  await assert.rejects(() => normalizeBackupSchedule({ time: '3am' }), /03:00/);
  await assert.rejects(() => normalizeBackupSchedule({ keep: 0 }), /Keep/);
  await assert.rejects(() => normalizeBackupSchedule({ folder: 'relative/path' }), /absolute/);
  await assert.rejects(() => normalizeBackupSchedule({ enabled: true, folder: path.join(os.tmpdir(), 'hbui-nope-123') }), /mounted/);
  // A missing folder is fine while the schedule is off, and empty means data/backups.
  assert.equal((await normalizeBackupSchedule({ folder: '' })).folder, '');
});

async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-bks-')));
  for (const x of ['src', 'out', 'data/logs', 'data/tmp', 'data/backups', 'nas']) await fs.mkdir(path.join(dir, x), { recursive: true });
  const db = openDb(path.join(dir, 'data', 'db.sqlite'));
  const settings = new Settings(db, { initialSourceRoot: path.join(dir, 'src'), initialTargetRoot: path.join(dir, 'out') });
  const backups = new Backups({
    db, dataDir: path.join(dir, 'data'), settings, queue: { active: null }, merger: {}, quality: {}, uploads: { writing: new Set() },
    renamer: {}, events: { emit() {} }, log: quiet, versions: { app: { version: '9.9.9' } },
  });
  let clock = d('2026-11-10T14:00');
  const notes = [];
  const scheduler = new BackupScheduler({
    settings, backups, notifier: { notify: (e, x) => notes.push({ e, x }) }, events: null, log: quiet, now: () => clock,
  });
  return {
    dir, db, settings, backups, scheduler, notes,
    setClock: (s) => (clock = d(s)),
    done: async () => {
      scheduler.stop();
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

test('backup schedule: runs into the chosen folder, once per due time, keeping the newest N', async () => {
  const t = await setup();
  try {
    const nas = path.join(t.dir, 'nas');
    await fs.writeFile(path.join(nas, 'someone-elses-file.zip'), 'x');
    await t.settings.update({ backupSchedule: { enabled: true, frequency: 'daily', time: '03:00', folder: nas, keep: 2, logs: false } });

    // First check after enabling: nothing covers today's 03:00 yet, so it backs up now.
    const r = await t.scheduler.reconfigure().then(() => t.scheduler.last);
    assert.equal(r.ok, true);
    let list = await t.backups.listScheduled();
    assert.equal(list.length, 1);
    assert.match(list[0].name, /^scheduled-.*\.zip$/);
    assert.equal(await t.scheduler.tick(), null); // covered: no second backup
    assert.deepEqual((await fs.readdir(nas)).filter((n) => n.endsWith('.part')), []);

    // Retention: only scheduled backups are pruned.
    for (let i = 0; i < 3; i++) {
      await new Promise((res) => setTimeout(res, 1100)); // file names have one-second stamps
      await t.scheduler.run();
    }
    list = await t.backups.listScheduled();
    assert.equal(list.length, 2);
    assert.ok((await fs.readdir(nas)).includes('someone-elses-file.zip'));

    // A restore can read a scheduled backup.
    const info = await t.backups.inspect(`scheduled:${list[0].name}`);
    assert.equal(info.manifest.app, 'encforge');
    const st = await t.scheduler.status();
    assert.equal(st.folder, nas);
    assert.ok(st.nextAt > Date.now() - 86_400_000);
  } finally {
    await t.done();
  }
});

test('backup schedule: a missing folder fails, notifies, and waits before retrying', async () => {
  const t = await setup();
  try {
    const nas = path.join(t.dir, 'nas');
    await t.settings.update({ backupSchedule: { enabled: true, folder: nas, keep: 3 } });
    await fs.rm(nas, { recursive: true }); // the share went away
    await t.scheduler.reconfigure();
    assert.equal(t.scheduler.last.ok, false);
    assert.match(t.scheduler.last.error, /mounted/);
    assert.equal(t.notes[0].e, 'backupFailed');
    assert.equal(await t.scheduler.tick(), null); // within the retry pause
    t.setClock('2026-11-10T14:31');
    await fs.mkdir(nas);
    const r = await t.scheduler.tick();
    assert.equal(r.ok, true);
  } finally {
    await t.done();
  }
});
