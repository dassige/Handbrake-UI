import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerOpenApi, TAG_NAMES } from '../src/openapi/index.js';
import { DOCS, EXAMPLES } from '../src/openapi/paths/index.js';
import { registerRoutes } from '../src/routes.js';
import { registerAuthRoutes } from '../src/authRoutes.js';
import { registerAutomationRoutes } from '../src/automationRoutes.js';
import { registerRenameRoutes } from '../src/rename/routes.js';
import { registerMergeRoutes } from '../src/mergeRoutes.js';
import { registerUploadRoutes } from '../src/uploadRoutes.js';
import { registerQualityRoutes } from '../src/qualityRoutes.js';
import { registerDownloadRoutes } from '../src/downloadRoutes.js';
import { registerBackupRoutes } from '../src/backupRoutes.js';

// Stand-in for every service: any property or call gives itself back; not a promise.
const stub = new Proxy(function stub() {}, {
  get: (t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => 0 : stub),
  apply: () => stub,
});
const deps = new Proxy({}, { get: () => stub });

/** The real routes, with stand-in services, plus the docs. */
async function makeApp() {
  const app = Fastify();
  app.setErrorHandler((err, req, reply) => {
    reply.status(err.statusCode ?? 500).send({ error: err.message, code: err.code ?? null });
  });
  const routes = new Set();
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) if (m !== 'HEAD' && r.url.startsWith('/api/')) routes.add(`${m} ${r.url}`);
  });
  await registerOpenApi(app, { version: '1.2.3' });
  await app.register(async (api) => {
    for (const register of [
      registerRoutes, registerAuthRoutes, registerAutomationRoutes, registerRenameRoutes, registerMergeRoutes,
      registerUploadRoutes, registerQualityRoutes, registerDownloadRoutes, registerBackupRoutes,
    ]) register(api, deps);
  });
  await app.ready();
  const own = [...routes].filter((r) => !/ \/api\/(docs|openapi\.json)/.test(r));
  return { app, routes: own };
}

test('openapi: every route is documented, and every docs entry is a route', async () => {
  const { app, routes } = await makeApp();
  try {
    assert.ok(routes.length > 80, `only ${routes.length} routes`);
    const missing = routes.filter((r) => !DOCS[r]);
    assert.deepEqual(missing, [], `routes without docs in src/openapi/paths/: ${missing.join(', ')}`);
    const stale = Object.keys(DOCS).filter((d) => !routes.includes(d));
    assert.deepEqual(stale, [], `docs for routes that do not exist: ${stale.join(', ')}`);
  } finally {
    await app.close();
  }
});

test('openapi: the description is complete and consistent', async () => {
  const { app } = await makeApp();
  try {
    const spec = app.swagger();
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.version, '1.2.3');
    const ops = Object.entries(spec.paths).flatMap(([p, item]) => Object.entries(item).map(([m, op]) => ({ id: `${m.toUpperCase()} ${p}`, op })));
    assert.equal(ops.length, Object.keys(DOCS).length, 'one operation per documented route');
    const ids = new Set();
    for (const { id, op } of ops) {
      assert.ok(op.summary?.trim(), `${id}: no summary`);
      assert.ok(op.operationId, `${id}: no operationId`);
      assert.ok(!ids.has(op.operationId), `${id}: operationId ${op.operationId} used twice`);
      ids.add(op.operationId);
      assert.ok(op.tags?.length && op.tags.every((t) => TAG_NAMES.includes(t)), `${id}: tags must be some of ${TAG_NAMES.join(', ')}`);
      assert.ok(['public', 'session', 'read', 'queue', 'admin'].includes(op['x-access']), `${id}: no access level`);
      assert.match(op.description, /\*\*Access:\*\*/, `${id}: access not described`);
      assert.ok(Object.keys(op.responses ?? {}).some((s) => s.startsWith('2')), `${id}: no success response`);
    }
    const get = (m, p) => spec.paths[p][m];
    assert.deepEqual(get('get', '/api/health').security, [], 'public routes need no key');
    assert.equal(get('put', '/api/settings')['x-access'], 'admin');
    assert.equal(get('delete', '/api/auth/keys/{id}')['x-access'], 'session');
    // Every $ref points at a schema in the description.
    const names = new Set(Object.keys(spec.components?.schemas ?? {}));
    const refs = JSON.stringify(spec).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const r of refs) {
      const m = /#\/components\/schemas\/([^"]+)"/.exec(r);
      assert.ok(m && names.has(m[1]), `unresolved ${r}`);
    }
  } finally {
    await app.close();
  }
});

test('openapi: the requests the web app makes pass validation', async () => {
  const { app } = await makeApp();
  try {
    assert.ok(EXAMPLES.length > 60, `only ${EXAMPLES.length} examples`);
    const keys = new Set(EXAMPLES.map((e) => e.route ?? `${e.method} ${e.url.split('?')[0]}`));
    for (const ex of EXAMPLES) {
      const res = await app.inject({
        method: ex.method,
        url: ex.url,
        ...(ex.body !== undefined ? { payload: typeof ex.body === 'string' || Buffer.isBuffer(ex.body) ? ex.body : JSON.stringify(ex.body) } : {}),
        headers: { 'content-type': ex.contentType ?? 'application/json' },
      });
      const body = res.headers['content-type']?.includes('json') ? res.json() : {};
      assert.notEqual(body.code, 'FST_ERR_VALIDATION', `${ex.method} ${ex.url} ${JSON.stringify(ex.body) ?? ''}: ${body.error}`);
    }
    assert.ok(keys.size > 40, 'examples cover most routes');
  } finally {
    await app.close();
  }
});

test('openapi: validation refuses what the docs rule out', async () => {
  const { app } = await makeApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/auth/keys', payload: { name: 'x' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'FST_ERR_VALIDATION');
  } finally {
    await app.close();
  }
});

test('openapi: responses are sent as the handler returns them, whatever the schema says', async () => {
  const app = Fastify();
  await registerOpenApi(app);
  // A documented route (array of sessions), answering with an extra field and a wrong type.
  app.get('/api/auth/sessions', async () => [{ current: 'yes', extra: { a: 1 }, ip: null }]);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/auth/sessions' });
    assert.deepEqual(res.json(), [{ current: 'yes', extra: { a: 1 }, ip: null }]);
  } finally {
    await app.close();
  }
});

test('openapi: the docs page and the description are served', async () => {
  const { app } = await makeApp();
  try {
    const page = await app.inject({ method: 'GET', url: '/api/docs' });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'], /html/);
    const json = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    assert.equal(json.statusCode, 200);
    assert.equal(json.json().info.title, 'EncForge API');
  } finally {
    await app.close();
  }
});
