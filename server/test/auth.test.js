import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { openDb } from '../src/db.js';
import { ADMIN_ROUTES, Auth, AUTH_TABLES, routeAccess } from '../src/auth.js';
import { registerAuthRoutes } from '../src/authRoutes.js';
import { Events } from '../src/events.js';
import { HttpError } from '../src/errors.js';
import { registerRoutes } from '../src/routes.js';
import { registerAutomationRoutes } from '../src/automationRoutes.js';
import { registerRenameRoutes } from '../src/rename/routes.js';
import { registerMergeRoutes } from '../src/mergeRoutes.js';
import { registerUploadRoutes } from '../src/uploadRoutes.js';
import { registerQualityRoutes } from '../src/qualityRoutes.js';
import { registerDownloadRoutes } from '../src/downloadRoutes.js';
import { registerBackupRoutes } from '../src/backupRoutes.js';
import { redactNotifications } from '../src/notify.js';
import { Backups } from '../src/backup.js';
import { DatabaseSync } from 'node:sqlite';

async function tmpDir() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'encforge-auth-')));
}

/** An app with the auth hook and routes, plus a few stand-ins for the real routes. */
async function makeApp({ forcedOff = false } = {}) {
  const dir = await tmpDir();
  const db = openDb(path.join(dir, 'test.db'));
  let clock = 1_000_000;
  const auth = new Auth({ db, forcedOff, now: () => clock });
  const events = new Events();
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    reply.status(err.statusCode ?? 500).send(err instanceof HttpError && err.errorCode ? { error: err.message, code: err.errorCode } : { error: err.message });
  });
  app.addHook('onRequest', auth.hook());
  await app.register(async (api) => {
    registerAuthRoutes(api, { auth, events });
    api.get('/api/health', async () => ({ ok: true }));
    api.get('/api/jobs', async (req) => ({ via: req.auth.via }));
    api.post('/api/jobs', async () => ({ ok: true }));
    api.put('/api/settings', async () => ({ ok: true }));
  });
  await app.ready();
  const call = async (method, url, { body, cookie, key, headers = {} } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (key) h.authorization = `Bearer ${key}`;
    const res = await app.inject({ method, url, payload: body, headers: h });
    const setCookie = res.headers['set-cookie'];
    return { status: res.statusCode, body: res.json(), setCookie, cookie: setCookie ? String(setCookie).split(';')[0] : null };
  };
  return { app, db, auth, events, call, tick: (ms) => (clock += ms), cleanup: async () => { events.close(); await app.close(); db.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('auth: login is off by default and everything is open', async () => {
  const t = await makeApp();
  try {
    const s = await t.call('GET', '/api/auth/status');
    assert.equal(s.body.enabled, false);
    assert.equal(s.body.via, 'open');
    assert.equal((await t.call('GET', '/api/jobs')).status, 200);
    assert.equal((await t.call('PUT', '/api/settings', { body: {} })).status, 200);
  } finally {
    await t.cleanup();
  }
});

test('auth: login needs a password, then signs this browser in and locks the others out', async () => {
  const t = await makeApp();
  try {
    const noPw = await t.call('PUT', '/api/auth/settings', { body: { enabled: true } });
    assert.equal(noPw.status, 400);
    assert.equal(noPw.body.code, 'noPassword');
    assert.equal((await t.call('PUT', '/api/auth/password', { body: { password: 'short' } })).body.code, 'passwordTooShort');
    assert.equal((await t.call('PUT', '/api/auth/password', { body: { password: 'correct horse' } })).status, 200);

    const on = await t.call('PUT', '/api/auth/settings', { body: { enabled: true } });
    assert.equal(on.status, 200);
    assert.match(String(on.setCookie), /encforge_session=[\w-]+; Path=\/; HttpOnly; SameSite=Strict/);
    assert.equal(on.body.via, 'session');

    // This browser is in; one without the cookie is not.
    assert.equal((await t.call('GET', '/api/jobs', { cookie: on.cookie })).body.via, 'session');
    const out = await t.call('GET', '/api/jobs');
    assert.equal(out.status, 401);
    assert.equal(out.body.code, 'signInRequired');
    // Public routes stay public.
    assert.equal((await t.call('GET', '/api/health')).status, 200);
    assert.equal((await t.call('GET', '/api/auth/status')).body.via, null);
    // So do the files of the web app (not under /api).
    assert.equal((await t.call('GET', '/index.html')).status, 404);
  } finally {
    await t.cleanup();
  }
});

test('auth: sign in, wrong passwords are throttled, sign out', async () => {
  const t = await makeApp();
  try {
    await t.call('PUT', '/api/auth/password', { body: { password: 'correct horse' } });
    await t.call('PUT', '/api/auth/settings', { body: { enabled: true } });

    for (let i = 0; i < 5; i++) {
      const r = await t.call('POST', '/api/auth/login', { body: { password: 'wrong password' } });
      assert.equal(r.status, 401);
      assert.equal(r.body.code, 'wrongPassword');
    }
    const locked = await t.call('POST', '/api/auth/login', { body: { password: 'correct horse' } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, 'tooManyAttempts');
    t.tick(16 * 60_000);

    const ok = await t.call('POST', '/api/auth/login', { body: { password: 'correct horse' } });
    assert.equal(ok.status, 200);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: ok.cookie })).status, 200);

    const bye = await t.call('POST', '/api/auth/logout', { cookie: ok.cookie });
    assert.match(String(bye.setCookie), /Max-Age=0/);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: ok.cookie })).status, 401);
  } finally {
    await t.cleanup();
  }
});

test('auth: sessions end after 30 days unused, and a password change signs the others out', async () => {
  const t = await makeApp();
  try {
    await t.call('PUT', '/api/auth/password', { body: { password: 'correct horse' } });
    const me = (await t.call('PUT', '/api/auth/settings', { body: { enabled: true } })).cookie;
    const other = (await t.call('POST', '/api/auth/login', { body: { password: 'correct horse' } })).cookie;
    assert.equal((await t.call('GET', '/api/auth/sessions', { cookie: me })).body.length, 2);

    const wrong = await t.call('PUT', '/api/auth/password', { cookie: me, body: { current: 'nope nope', password: 'battery staple' } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.code, 'wrongPassword');
    assert.equal((await t.call('PUT', '/api/auth/password', { cookie: me, body: { current: 'correct horse', password: 'battery staple' } })).status, 200);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: me })).status, 200);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: other })).status, 401);

    t.tick(29 * 86_400_000);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: me })).status, 200, 'used within 30 days: still in');
    t.tick(31 * 86_400_000);
    assert.equal((await t.call('GET', '/api/jobs', { cookie: me })).status, 401, 'unused for 31 days: signed out');
  } finally {
    await t.cleanup();
  }
});

test('auth: API keys are limited by their scope, and cannot manage login or keys', async () => {
  const t = await makeApp();
  try {
    const read = (await t.call('POST', '/api/auth/keys', { body: { name: 'Dashboard', scope: 'read' } })).body;
    const queue = (await t.call('POST', '/api/auth/keys', { body: { name: 'Sonarr', scope: 'queue' } })).body;
    const admin = (await t.call('POST', '/api/auth/keys', { body: { name: 'Admin', scope: 'admin' } })).body;
    assert.match(read.token, /^ef_[\w-]{32}$/);
    assert.equal(read.key.prefix, read.token.slice(0, 7));
    assert.equal(read.key.hash, undefined);

    // Checked also while login is off.
    assert.equal((await t.call('GET', '/api/jobs', { key: read.token })).body.via, 'key');
    const denied = await t.call('POST', '/api/jobs', { key: read.token, body: {} });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'scope');
    assert.equal((await t.call('POST', '/api/jobs', { key: queue.token, body: {} })).status, 200);
    assert.equal((await t.call('PUT', '/api/settings', { key: queue.token, body: {} })).status, 403);
    assert.equal((await t.call('PUT', '/api/settings', { key: admin.token, body: {} })).status, 200);
    // X-API-Key works too.
    assert.equal((await t.call('GET', '/api/jobs', { headers: { 'x-api-key': read.token } })).status, 200);

    const manage = await t.call('GET', '/api/auth/keys', { key: admin.token });
    assert.equal(manage.status, 403);
    assert.equal(manage.body.code, 'browserOnly');

    const bad = await t.call('GET', '/api/jobs', { key: 'ef_not-a-real-key' });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'invalidApiKey');
    // Another Authorization scheme (e.g. a proxy's Basic login) is not taken for a key.
    assert.equal((await t.call('GET', '/api/jobs', { headers: { authorization: 'Basic dXNlcjpwYXNz' } })).status, 200);

    const list = (await t.call('GET', '/api/auth/keys')).body;
    assert.deepEqual(list.map((k) => k.name).sort(), ['Admin', 'Dashboard', 'Sonarr']);
    assert.ok(list.find((k) => k.name === 'Dashboard').lastUsedAt, 'last use recorded');

    assert.equal((await t.call('DELETE', `/api/auth/keys/${read.key.id}`)).status, 200);
    assert.equal((await t.call('GET', '/api/jobs', { key: read.token })).status, 401, 'revoked');
    assert.equal((await t.call('POST', '/api/auth/keys', { body: { name: 'x', scope: 'root' } })).status, 400);
    assert.equal((await t.call('POST', '/api/auth/keys', { body: { name: ' ', scope: 'read' } })).status, 400);
  } finally {
    await t.cleanup();
  }
});

test('auth: changes from other websites are refused', async () => {
  const t = await makeApp();
  try {
    const r = await t.call('POST', '/api/jobs', { body: {}, headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'crossSite');
    assert.equal((await t.call('POST', '/api/jobs', { body: {}, headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
    assert.equal((await t.call('GET', '/api/jobs', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 200, 'reading is fine');
  } finally {
    await t.cleanup();
  }
});

test('auth: DISABLE_LOGIN turns login off and allows a new password without the old one', async () => {
  const t = await makeApp();
  await t.call('PUT', '/api/auth/password', { body: { password: 'correct horse' } });
  await t.call('PUT', '/api/auth/settings', { body: { enabled: true } });
  t.auth.forcedOff = true;
  try {
    const s = await t.call('GET', '/api/auth/status');
    assert.equal(s.body.enabled, false);
    assert.equal(s.body.savedEnabled, true);
    assert.equal(s.body.via, 'open');
    assert.equal((await t.call('PUT', '/api/auth/password', { body: { password: 'forgot the old one' } })).status, 200);
    assert.equal((await t.call('PUT', '/api/auth/settings', { body: { enabled: true } })).status, 409);
  } finally {
    await t.cleanup();
  }
});

test('auth: every admin route exists, and routes get the expected access', async () => {
  // Register the real routes with stand-in services: only the route list is needed.
  const stub = new Proxy(() => stub, { get: () => stub, apply: () => stub });
  const app = Fastify();
  const routes = new Set();
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) routes.add(`${m} ${r.url}`);
  });
  await app.register(async (api) => {
    const deps = new Proxy({}, { get: () => stub });
    registerRoutes(api, deps);
    registerAutomationRoutes(api, deps);
    registerRenameRoutes(api, deps);
    registerMergeRoutes(api, deps);
    registerUploadRoutes(api, deps);
    registerQualityRoutes(api, deps);
    registerDownloadRoutes(api, deps);
    registerBackupRoutes(api, deps);
    registerAuthRoutes(api, deps);
  });
  await app.ready();
  assert.ok(routes.size > 80, `only ${routes.size} routes registered`);
  for (const r of ADMIN_ROUTES) assert.ok(routes.has(r), `ADMIN_ROUTES lists ${r}, which is not a route`);
  assert.equal(routeAccess('GET', '/api/jobs'), 'read');
  assert.equal(routeAccess('HEAD', '/api/download'), 'read');
  assert.equal(routeAccess('POST', '/api/jobs'), 'queue');
  assert.equal(routeAccess('POST', '/api/files/delete'), 'admin');
  assert.equal(routeAccess('GET', '/api/backup'), 'admin');
  assert.equal(routeAccess('GET', '/api/auth/keys'), 'session');
  assert.equal(routeAccess('GET', '/api/health'), 'public');
  assert.equal(routeAccess('GET', undefined), 'read', 'unknown routes are not public');
  await app.close();
});

test('auth: webhook headers are hidden from API keys below admin', () => {
  const n = { events: {}, webhooks: [{ id: 'a', name: 'n8n', url: 'http://x', headers: 'Authorization: Bearer secret' }, { id: 'b', headers: '' }], email: {} };
  const r = redactNotifications(n);
  assert.equal(r.webhooks[0].headers, '');
  assert.equal(r.webhooks[0].hasHeaders, true);
  assert.equal(r.webhooks[1].hasHeaders, false);
  assert.equal(n.webhooks[0].headers, 'Authorization: Bearer secret', 'the settings themselves are not changed');
});

test('auth: backups leave the login tables out', async () => {
  const dir = await tmpDir();
  const db = openDb(path.join(dir, 'encforge.db'));
  try {
    const auth = new Auth({ db });
    await auth.setPassword({ password: 'correct horse' });
    auth.createKey({ name: 'k', scope: 'read' });
    await fs.mkdir(path.join(dir, 'tmp'), { recursive: true });
    const backups = new Backups({ db, dataDir: dir, settings: { get: () => null }, versions: {} });
    const { work } = await backups.build({ logs: false });
    const copy = new DatabaseSync(path.join(work, 'encforge.db'), { readOnly: true });
    const tables = copy.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
    copy.close();
    for (const t of AUTH_TABLES) assert.ok(!tables.includes(t), `${t} is in the backup`);
    assert.ok(tables.includes('settings'));
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
