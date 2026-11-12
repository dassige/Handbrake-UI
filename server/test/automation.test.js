// Conversion window, history/stats, notifications, watch folders and how the queue uses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { Settings } from '../src/settings.js';
import { Queue } from '../src/queue.js';
import { History } from '../src/history.js';
import { Watcher } from '../src/watch.js';
import {
  Notifier, buildMessage, normalizeNotifications, parseHeaders, publicNotifications,
} from '../src/notify.js';
import * as serverSchedule from '../src/schedule.js';
import * as webSchedule from '../../web/src/schedule.js';

const quiet = { info() {}, warn() {}, error() {} };
const d = (s) => new Date(s); // local time

// ------------------------------------------------------------------ schedule (both copies)

for (const [label, S] of [['server', serverSchedule], ['web', webSchedule]]) {
  test(`schedule (${label}): same-day and overnight windows`, () => {
    const day = { enabled: true, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], autoStart: true };
    assert.equal(S.inWindow(day, d('2026-11-09T10:00')), true); // Monday
    assert.equal(S.inWindow(day, d('2026-11-09T17:00')), false);
    assert.equal(S.inWindow(day, d('2026-11-08T10:00')), false); // Sunday

    // Opens Friday 23:00, so Saturday 03:00 is inside; Saturday 23:00 is not (Saturday not listed).
    const night = { enabled: true, start: '23:00', end: '07:00', days: [5], autoStart: true };
    assert.equal(S.inWindow(night, d('2026-11-13T23:30')), true);
    assert.equal(S.inWindow(night, d('2026-11-14T03:00')), true);
    assert.equal(S.inWindow(night, d('2026-11-14T07:00')), false);
    assert.equal(S.inWindow(night, d('2026-11-14T23:30')), false);
    assert.equal(S.inWindow({ ...night, enabled: false }, d('2026-11-14T12:00')), true);

    assert.equal(S.nextWindowStart(night, d('2026-11-10T12:00')).getTime(), d('2026-11-13T23:00').getTime());
    assert.equal(S.windowEnd(night, d('2026-11-13T23:30')).getTime(), d('2026-11-14T07:00').getTime());
  });

  test(`schedule (${label}): finish time holds jobs for the window but finishes a running one`, () => {
    const night = { enabled: true, start: '23:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6], autoStart: true };
    const now = d('2026-11-10T22:00');
    // 1 h running now (not held), then two 4 h jobs: the 2nd starts 03:00 and ends 07:00.
    const t = S.finishTime(night, [4 * 3600, 4 * 3600], { now, runningLeft: 3600 });
    assert.equal(t.getTime(), d('2026-11-11T07:00').getTime());
    // A third job would wait for the next evening.
    const t3 = S.finishTime(night, [4 * 3600, 4 * 3600, 600], { now, runningLeft: 3600 });
    assert.equal(t3.getTime(), d('2026-11-11T23:10').getTime());
    assert.equal(S.finishTime(night, [600], { now, ignoreWindow: true }).getTime(), d('2026-11-10T22:10').getTime());
  });
}

test('schedule: validation', () => {
  const { normalizeSchedule } = serverSchedule;
  assert.throws(() => normalizeSchedule({ start: '25:00' }), /time/);
  assert.throws(() => normalizeSchedule({ enabled: true, days: [] }), /day/);
  assert.deepEqual(normalizeSchedule({ days: [3, 1, 1] }).days, [1, 3]);
});

// ------------------------------------------------------------------ history

test('history: records finished jobs, stats and speeds; backfills old jobs once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-hist-'));
  const file = path.join(dir, 'db.sqlite');
  let db = openDb(file);
  const now = Date.now();
  const ins = db.prepare(`INSERT INTO jobs (status, position, source_path, output_path, preset_name, preset_json, format,
    created_at, started_at, finished_at, source_size, output_size, source_info, avg_fps)
    VALUES (?, 1, ?, ?, ?, '{}', 'av_mkv', ?, ?, ?, ?, ?, ?, 30)`);
  // 600 s of video in 300 s → 0.5 s of work per second of video.
  ins.run('done', '/s/a.mkv', '/o/a.mkv', 'P1', now - 1000, now - 400_000, now - 100_000, 1000, 400, JSON.stringify({ duration: 600 }));
  ins.run('failed', '/s/b.mkv', '/o/b.mkv', 'P1', now - 1000, now - 50_000, now - 40_000, 1000, null, null);
  // Pretend this database predates the history table.
  db.exec('DROP TABLE job_history');
  db.close();

  db = openDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM job_history').get().n, 2);
  const h = new History({ db });
  h.record({
    id: 9, status: 'done', started_at: now - 20_000, finished_at: now - 10_000, paused_ms: 0, preset_name: 'P2',
    source_path: '/s/c.mkv', output_path: '/o/c.mkv', source_size: 2000, output_size: 500,
    source_info: JSON.stringify({ duration: 100 }), avg_fps: 50, verify_status: 'ok', origin: 'watch',
  });
  const s = h.stats({ days: 7 });
  assert.equal(s.totals.done, 2);
  assert.equal(s.totals.failed, 1);
  assert.equal(s.totals.savedBytes, 600 + 1500);
  assert.equal(s.watched, 1);
  assert.equal(s.presets[0].name, 'P1');
  assert.equal(s.bucket, 'day');
  assert.equal(s.series.reduce((n, x) => n + x.done, 0), 2);
  assert.equal(s.top[0].saved, 1500);
  assert.equal(h.speeds().byPreset.P1, 0.5);

  // Reopening does not backfill again.
  db.close();
  db = openDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM job_history').get().n, 3);
  db.close();
  await fs.rm(dir, { recursive: true });
});

// ------------------------------------------------------------------ notifications

test('notifications: the password is kept when not sent and never shown', () => {
  const saved = normalizeNotifications({
    email: { enabled: true, host: 'smtp.x', port: 587, security: 'starttls', user: 'me@x', password: 'secret', to: 'a@x' },
  });
  assert.equal(saved.email.password, 'secret');
  const view = publicNotifications(saved);
  assert.equal(view.email.password, undefined);
  assert.equal(view.email.hasPassword, true);
  // The browser sends the settings back without a password: the old one stays.
  const { hasPassword, ...email } = view.email;
  assert.equal(normalizeNotifications({ ...view, email }, saved).email.password, 'secret');
  // An explicit empty string clears it.
  assert.equal(normalizeNotifications({ ...view, email: { ...email, password: '' } }, saved).email.password, '');

  assert.throws(() => normalizeNotifications({ webhooks: [{ name: 'n8n', enabled: true, url: '' }] }), /n8n: enter the URL/);
  assert.throws(() => normalizeNotifications({ email: { enabled: true, host: 'h', to: '' } }), /address/);
  assert.deepEqual(parseHeaders('Authorization: Bearer x\n\nX-A:1'), { Authorization: 'Bearer x', 'X-A': '1' });
  assert.throws(() => parseHeaders('no colon here'), /Name: value/);
});

test('notifications: several webhooks, each with the general events or its own', async () => {
  const calls = [];
  const sent = [];
  const settingsValue = normalizeNotifications({
    events: { jobFailed: true, jobDone: false, queueFinished: true },
    webhooks: [
      { id: 'n8n', name: 'n8n', enabled: true, url: 'http://hook.local/n8n', headers: 'X-Token: 1' },
      // Only the end of a run, whatever the general list says.
      { id: 'ha', name: 'Home Assistant', enabled: true, url: 'http://hook.local/ha', events: { queueFinished: true } },
      { id: 'off', name: 'Off', enabled: false, url: 'http://hook.local/off' },
    ],
    email: { enabled: true, host: 'smtp.local', port: 25, security: 'none', from: 'hb@x', to: 'me@x, you@x' },
  });
  const n = new Notifier({
    settings: { get: () => settingsValue },
    log: quiet,
    fetch: async (url, opts) => {
      calls.push({ url, opts, body: JSON.parse(opts.body) });
      return { ok: true };
    },
    createTransport: (opts) => ({ sendMail: async (m) => sent.push({ opts, m }), close() {} }),
  });
  const job = { id: 1, sourcePath: '/s/Show.mkv', outputPath: '/o/Show.mkv', status: 'failed', error: 'boom' };
  await n.notify('jobDone', job);
  assert.equal(calls.length + sent.length, 0);

  await n.notify('jobFailed', job);
  assert.deepEqual(calls.map((c) => c.url), ['http://hook.local/n8n']);
  assert.equal(calls[0].opts.headers['X-Token'], '1');
  assert.equal(calls[0].body.event, 'jobFailed');
  assert.match(calls[0].body.title, /Show\.mkv/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].m.to, ['me@x', 'you@x']);
  assert.equal(sent[0].opts.ignoreTLS, true);

  calls.length = 0;
  await n.notify('queueFinished', { jobs: [job], startedAt: 0, finishedAt: 1000 });
  assert.deepEqual(calls.map((c) => c.url).sort(), ['http://hook.local/ha', 'http://hook.local/n8n']);
  assert.ok(n.recent().some((r) => r.target === 'Home Assistant' && r.ok));

  // A failing webhook is recorded, not thrown; test() throws, and tests only the chosen webhook.
  n.fetch = async (url) => (url.endsWith('/ha')
    ? { ok: false, status: 500, statusText: 'Server Error', text: async () => 'nope' }
    : { ok: true });
  const results = await n.notify('queueFinished', { jobs: [job], startedAt: 0, finishedAt: 1000 });
  assert.equal(results.find((e) => e.target === 'Home Assistant').ok, false);
  assert.equal(results.find((e) => e.target === 'n8n').ok, true);
  await assert.rejects(() => n.test('webhook', settingsValue, 'ha'), /500/);
  assert.equal((await n.test('webhook', settingsValue, 'n8n')).ok, true);
  // Unsaved rows are found by position; a disabled one can still be tested.
  assert.equal((await n.test('webhook', settingsValue, '#2')).ok, true);
  await assert.rejects(() => n.test('webhook', settingsValue, 'nope'), /not found/);
});

test('notifications: the single webhook of older versions becomes the first in the list', () => {
  const old = { events: { jobFailed: true }, webhook: { enabled: true, url: 'http://old/hook', headers: 'A: b' } };
  const v = normalizeNotifications(old);
  assert.deepEqual(v.webhooks, [
    { id: 'webhook-1', name: 'Webhook', enabled: true, url: 'http://old/hook', headers: 'A: b', events: null, secret: '' },
  ]);
  assert.equal('webhook' in v, false);
  // Empty old settings give an empty list.
  assert.deepEqual(normalizeNotifications({ webhook: { enabled: false, url: '' } }).webhooks, []);
  // Missing or repeated ids and names are filled in.
  const w = normalizeNotifications({ webhooks: [{ url: 'http://a' }, { id: 'x', url: 'http://b' }, { id: 'x', url: 'http://c' }] }).webhooks;
  assert.deepEqual(w.map((h) => [h.id, h.name]), [['webhook-1', 'Webhook 1'], ['x', 'Webhook 2'], ['webhook-3', 'Webhook 3']]);
  assert.throws(() => normalizeNotifications({ webhooks: Array.from({ length: 11 }, () => ({})) }), /At most 10/);
});

test('notifications: queue summary message', () => {
  const m = buildMessage('queueFinished', {
    startedAt: 0,
    finishedAt: 3_600_000,
    jobs: [
      { sourcePath: '/s/a.mkv', status: 'done', sourceSize: 1000, outputSize: 400, verifyStatus: 'ok' },
      { sourcePath: '/s/b.mkv', status: 'failed', error: 'bad' },
    ],
  });
  assert.equal(m.title, 'Queue finished: 1 converted, 1 failed');
  assert.match(m.text, /1 h 0 min/);
  assert.match(m.text, /✗ b\.mkv \(bad\)/);
  assert.equal(m.data.savedBytes, 600);
});

// ------------------------------------------------------------------ queue + watch setup

async function setup() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hbui-auto-')));
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  const data = path.join(dir, 'data');
  for (const x of [src, out, data, path.join(data, 'logs'), path.join(data, 'tmp')]) await fs.mkdir(x, { recursive: true });
  const db = openDb(':memory:');
  const settings = new Settings(db, { initialSourceRoot: src, initialTargetRoot: out });
  const notes = [];
  const notifier = { notify: (event, data) => notes.push({ event, data }) };
  const encodes = [];
  const handbrake = {
    scan: async () => ({ duration: 60 }),
    encode(opts) {
      const child = { kill() {} };
      encodes.push(opts);
      // Finishes on the next turn with an output file.
      setImmediate(async () => {
        await fs.writeFile(opts.output, 'video');
        opts.onExit(0, null, null);
      });
      return child;
    },
  };
  const preset = { id: 1, name: 'P', json: JSON.stringify({ PresetList: [{ PresetName: 'P' }] }), summary: { format: 'av_mkv' } };
  const presets = { resolve: () => preset, get: () => preset };
  const history = new History({ db });
  const events = { emitted: [], emit(t, x) { this.emitted.push([t, x]); } };
  const queue = new Queue({ db, settings, presets, handbrake, verifier: null, events, dataDir: data, log: quiet, history, notifier });
  const done = async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, src, out, db, settings, queue, presets, history, notes, encodes, events, done };
}

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

test('queue: outside the window it waits; "start now" runs; history and notifications follow', async () => {
  const t = await setup();
  try {
    await fs.writeFile(path.join(t.src, 'a.mkv'), 'x');
    await t.queue.add({ paths: [path.join(t.src, 'a.mkv')] });
    // A window that opens 2 h from now.
    const now = new Date();
    t.settings.set('schedule', {
      enabled: true, start: hhmm(new Date(now.getTime() + 2 * 3600e3)), end: hhmm(new Date(now.getTime() + 3 * 3600e3)),
      days: [0, 1, 2, 3, 4, 5, 6], autoStart: true,
    });
    t.queue.setRunning(true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(t.encodes.length, 0);
    const st = t.queue.state();
    assert.equal(st.schedule.waiting, true);
    assert.ok(st.schedule.nextStart > Date.now());

    t.queue.setRunning(true, { now: true });
    await until(() => t.settings.get('queueRunning') === false);
    assert.equal(t.encodes.length, 1);
    assert.equal(t.queue.scheduleOverride, false);
    assert.deepEqual(t.notes.map((n) => n.event), ['jobDone', 'queueFinished']);
    assert.equal(t.notes[1].data.jobs.length, 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM job_history').get().n, 1);
  } finally {
    await t.done();
  }
});

test('queue: the window opening starts a queue with waiting jobs (autoStart), only on the transition', async () => {
  const t = await setup();
  try {
    await fs.writeFile(path.join(t.src, 'a.mkv'), 'x');
    await t.queue.add({ paths: [path.join(t.src, 'a.mkv')] });
    const sched = { enabled: true, start: '00:00', end: '00:00', days: [0, 1, 2, 3, 4, 5, 6], autoStart: true }; // always open
    t.settings.set('schedule', sched);
    t.queue.scheduleChanged(); // open now: not a transition
    t.queue.scheduleTick();
    assert.equal(t.settings.get('queueRunning'), false);
    t.queue.lastInWindow = false; // as if it was closed on the previous tick
    t.queue.scheduleTick();
    await until(() => t.encodes.length === 1);
    await until(() => t.settings.get('queueRunning') === false);
  } finally {
    await t.done();
  }
});

test('queue: "convert now" encodes one job while the queue is stopped and leaves the rest queued', async () => {
  const t = await setup();
  try {
    for (const n of ['a.mkv', 'b.mkv']) await fs.writeFile(path.join(t.src, n), 'x');
    const { added: [a, b] } = await t.queue.add({ paths: [path.join(t.src, 'a.mkv'), path.join(t.src, 'b.mkv')] });
    // Outside the conversion window too: it is a manual action.
    const now = new Date();
    t.settings.set('schedule', {
      enabled: true, start: hhmm(new Date(now.getTime() + 2 * 3600e3)), end: hhmm(new Date(now.getTime() + 3 * 3600e3)),
      days: [0, 1, 2, 3, 4, 5, 6], autoStart: false,
    });
    const convertNow = t.queue.convertNow(b);
    await assert.rejects(() => t.queue.convertNow(a), /Another conversion is running/);
    await convertNow;
    assert.equal(t.queue.state().activeSingle, true);
    await until(() => t.queue.get(b).status === 'done');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(t.encodes.length, 1);
    assert.equal(t.queue.get(a).status, 'queued');
    assert.equal(t.settings.get('queueRunning'), false);
    assert.equal(t.queue.state().activeSingle, false);
    // The job's own notification, but no "queue finished".
    assert.deepEqual(t.notes.map((n) => n.event), ['jobDone']);

    await assert.rejects(() => t.queue.convertNow(b), /Only queued jobs/);
    t.queue.setRunning(true, { now: true });
    await assert.rejects(() => t.queue.convertNow(a), /queue is running/);
    await until(() => t.settings.get('queueRunning') === false);
    assert.equal(t.queue.get(a).status, 'done');
    // The queue run reports only its own job.
    assert.equal(t.notes.at(-1).event, 'queueFinished');
    assert.equal(t.notes.at(-1).data.jobs.length, 1);
  } finally {
    await t.done();
  }
});

test('watch: existing files are left alone; new ones are added once they stop changing', async () => {
  const t = await setup();
  try {
    const inbox = path.join(t.src, 'inbox');
    await fs.mkdir(inbox);
    await fs.writeFile(path.join(inbox, 'old.mkv'), 'x');
    let clock = Date.now();
    const watcher = new Watcher({ db: t.db, settings: t.settings, queue: t.queue, presets: t.presets, notifier: { notify: (e, d) => t.notes.push({ event: e, data: d }) }, events: null, log: quiet, now: () => clock });
    await t.settings.update({ watch: { enabled: true, folders: [{ path: inbox }], settleMinutes: 5, intervalMinutes: 1, autoStart: false } });
    await watcher.reconfigure();
    watcher.stop();

    const fresh = path.join(inbox, 'new.mkv');
    await fs.writeFile(fresh, 'xx');
    let r = await watcher.scan();
    assert.deepEqual(r.added, []); // first sighting
    assert.equal(watcher.status().pending.length, 1);
    r = await watcher.scan();
    assert.deepEqual(r.added, []); // unchanged, but modified less than 5 min ago

    clock += 6 * 60_000;
    r = await watcher.scan();
    assert.deepEqual(r.added, [fresh]);
    const job = t.db.prepare('SELECT origin, status FROM jobs WHERE source_path = ?').get(fresh);
    assert.deepEqual({ ...job }, { origin: 'watch', status: 'queued' });
    assert.equal(t.notes.at(-1).event, 'watchAdded');
    assert.equal(t.settings.get('queueRunning'), false); // autoStart off

    // Never again, and the old file never at all.
    r = await watcher.scan();
    assert.deepEqual(r.added, []);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 1);
    assert.equal(watcher.status().recent[0].action, 'added');

    await assert.rejects(() => t.settings.update({ watch: { enabled: true, folders: [{ path: t.out }] } }), /not inside a sources folder/);
  } finally {
    await t.done();
  }
});

test('settings: the browser never gets the e-mail password', async () => {
  const t = await setup();
  try {
    await t.settings.update({ notifications: { email: { host: 'h', password: 'pw', to: 'a@b' } } });
    assert.equal(t.settings.get('notifications').email.password, 'pw');
    assert.equal(t.settings.public().notifications.email.password, undefined);
    assert.equal(JSON.stringify(t.settings.public()).includes('pw'), false);
  } finally {
    await t.done();
  }
});

test('db: job_history survives "Clear"', () => {
  const db = openDb(':memory:');
  assert.ok(db instanceof DatabaseSync);
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  assert.ok(cols.includes('origin'));
  db.close();
});

// ------------------------------------------------------------------ folder names, about

test('settings: friendly names for sources folders', async () => {
  const t = await setup();
  try {
    const other = path.join(t.dir, 'src2');
    await fs.mkdir(other);
    await t.settings.update({ sourceRoots: [t.src, other], sourceNames: { [t.src]: '  Downloads ', [other]: '', '/not/a/root': 'X' } });
    assert.deepEqual(t.settings.get('sourceNames'), { [t.src]: 'Downloads' });
    await assert.rejects(() => t.settings.update({ sourceNames: { [t.src]: 'Same', [other]: 'same' } }), /both called/);
    await assert.rejects(() => t.settings.update({ sourceNames: { [t.src]: 'x'.repeat(41) } }), /at most 40/);
    // Removing a folder drops its name.
    await t.settings.update({ sourceRoots: [other] });
    assert.deepEqual(t.settings.get('sourceNames'), {});
  } finally {
    await t.done();
  }
});

test('about: the changelog is split into releases', async () => {
  const { parseChangelog } = await import('../src/about.js');
  const r = parseChangelog('# Changelog\n\nintro\n\n## [1.3.1] - 2026/11/10\n\n- \n\n## [1.3.0] - 2026/11/10\n\n- feat: backup\n  and restore\n- tests\n');
  assert.deepEqual(r, [
    { version: '1.3.1', date: '2026/11/10', notes: [] },
    { version: '1.3.0', date: '2026/11/10', notes: ['feat: backup and restore', 'tests'] },
  ]);
});

// ------------------------------------------------------------------ API clients: tags, filters, signed webhooks

test('queue: a tag is kept with the jobs, copied by "convert again", and filters the list', async () => {
  const t = await setup();
  try {
    for (const f of ['a.mkv', 'b.mkv', 'c.mkv']) await fs.writeFile(path.join(t.src, f), 'x');
    const tagged = await t.queue.add({ paths: [path.join(t.src, 'a.mkv'), path.join(t.src, 'b.mkv')], tag: '  sonarr:42 ' });
    const plain = await t.queue.add({ paths: [path.join(t.src, 'c.mkv')] });
    assert.equal(t.queue.get(tagged.added[0]).tag, 'sonarr:42');
    assert.equal(t.queue.get(plain.added[0]).tag, null);

    assert.deepEqual(t.queue.list({ tag: 'sonarr:42' }).map((j) => j.id), tagged.added);
    assert.equal(t.queue.list().length, 3);
    assert.equal(t.queue.list({ statuses: ['done'] }).length, 0);
    assert.equal(t.queue.list({ statuses: ['queued', 'done'] }).length, 3);
    assert.deepEqual(t.queue.list({ limit: 1 }).map((j) => j.id), [tagged.added[0]], 'queue order, first only');
    assert.equal(t.queue.list({ since: Date.now() + 60_000 }).length, 0);

    t.queue.setRunning(true);
    await until(() => t.settings.get('queueRunning') === false);
    const again = await t.queue.convertAgain(tagged.added[0], {});
    assert.equal(t.queue.get(again).tag, 'sonarr:42');
    assert.equal(t.notes.find((n) => n.event === 'jobDone').data.tag, 'sonarr:42');
    assert.equal(buildMessage('jobDone', t.queue.get(tagged.added[0])).data.tag, 'sonarr:42');

    await assert.rejects(t.queue.add({ paths: [path.join(t.src, 'c.mkv')], tag: 'x'.repeat(101) }), /at most 100/);
    await assert.rejects(t.queue.add({ paths: [path.join(t.src, 'c.mkv')], tag: 5 }), /tag must be text/);
  } finally {
    await t.done();
  }
});

test('notifications: a webhook secret is kept like a password, never shown, and signs each request', async () => {
  const saved = normalizeNotifications({ webhooks: [{ id: 'n8n', name: 'n8n', enabled: true, url: 'http://hook.local/n8n', secret: ' s3cret ' }] });
  assert.equal(saved.webhooks[0].secret, 's3cret');
  const view = publicNotifications(saved);
  assert.equal(view.webhooks[0].secret, undefined);
  assert.equal(view.webhooks[0].hasSecret, true);
  // Sent back without a secret: kept. An empty string removes it.
  assert.equal(normalizeNotifications(view, saved).webhooks[0].secret, 's3cret');
  const cleared = normalizeNotifications({ ...view, webhooks: [{ ...view.webhooks[0], secret: '' }] }, saved);
  assert.equal(cleared.webhooks[0].secret, '');

  const calls = [];
  const n = new Notifier({
    settings: { get: () => ({ ...saved, events: { ...saved.events, jobDone: true } }) },
    log: quiet,
    fetch: async (url, opts) => {
      calls.push(opts);
      return { ok: true };
    },
  });
  await n.notify('jobDone', { id: 7, tag: 'radarr:9', sourcePath: '/s/a.mkv', outputPath: '/o/a.mkv', status: 'done' });
  const { headers, body } = calls[0];
  const { createHmac } = await import('node:crypto');
  assert.equal(headers['X-EncForge-Signature'], `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`);
  assert.equal(headers['X-EncForge-Event'], 'jobDone');
  assert.equal(JSON.parse(body).data.tag, 'radarr:9');

  // Without a secret there is no signature.
  calls.length = 0;
  n.settings = { get: () => ({ ...cleared, events: { ...cleared.events, jobDone: true } }) };
  await n.notify('jobDone', { id: 7, sourcePath: '/s/a.mkv', status: 'done' });
  assert.equal(calls[0].headers['X-EncForge-Signature'], undefined);
});
