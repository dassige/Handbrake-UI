import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { isHiddenName, makeFileMatcher, naturalCompare, resolveUnderAny } from './paths.js';
import { aboutInfo } from './about.js';

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n)) throw badRequest('Invalid id');
  return n;
};

export function registerRoutes(app, { settings, presets, queue, events, handbrake, renamer, watcher, version, dataDir }) {
  // ------------------------------------------------------------- status
  let hbInfo = null;
  app.get('/api/info', async () => {
    hbInfo ??= await handbrake.info();
    // app = global (project) version, server = this service's package version.
    // The conversion window follows the server's clock (container TZ).
    const time = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: -new Date().getTimezoneOffset(), now: Date.now() };
    return { app: version.app, server: version.server, handbrake: hbInfo, queue: queue.state(), time };
  });

  app.get('/api/about', async () => {
    hbInfo ??= await handbrake.info();
    return { ...aboutInfo({ version, dataDir }), handbrake: hbInfo };
  });

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    events.attach(req.raw, reply.raw);
  });

  // ------------------------------------------------------------- settings
  app.get('/api/settings', async () => settings.public());
  app.put('/api/settings', async (req) => {
    if (req.body?.autoRenameRuleId != null) renamer.getRule(Number(req.body.autoRenameRuleId));
    for (const f of req.body?.watch?.folders ?? []) {
      if (f?.presetId != null && f.presetId !== '') presets.get(Number(f.presetId));
    }
    await settings.update(req.body);
    const result = settings.public();
    events.emit('settings', result);
    if ('schedule' in (req.body ?? {})) queue.scheduleChanged();
    if ('watch' in (req.body ?? {}) || 'sourceRoots' in (req.body ?? {})) await watcher?.reconfigure();
    queue.tick();
    return result;
  });

  // ------------------------------------------------------------- browsing
  /**
   * Lists one folder under a source root, the target root or any of them.
   * Query: root=source|target|any, path=<absolute path, defaults to the first root>.
   * source: folders and video files, with job badges. target: every file. any: folders and video files.
   */
  app.get('/api/browse', async (req) => {
    const kind = ['target', 'any'].includes(req.query.root) ? req.query.root : 'source';
    const roots = kind === 'target' ? [settings.get('targetRoot')]
      : kind === 'any' ? [...settings.get('sourceRoots'), settings.get('targetRoot')]
        : settings.get('sourceRoots');
    const { root, path: dir } = await resolveUnderAny(roots, req.query.path || roots[0]);
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) throw badRequest('Not a folder');

    const matcher = makeFileMatcher(settings);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = [];
    await Promise.all(
      entries
        .filter((e) => !isHiddenName(e.name))
        .map(async (e) => {
          const full = path.join(dir, e.name);
          let s;
          try {
            s = await fs.stat(full);
          } catch {
            return; // broken link, permission problem...
          }
          if (s.isDirectory()) items.push({ name: e.name, path: full, type: 'dir', mtime: s.mtimeMs });
          else if (s.isFile() && (kind === 'target' || matcher.isVideo(e.name))) {
            items.push({
              name: e.name, path: full, type: 'file', size: s.size, mtime: s.mtimeMs,
              excluded: matcher.excluded(e.name),
            });
          }
        }),
    );
    items.sort((a, b) => (a.type === b.type ? naturalCompare(a.name, b.name) : a.type === 'dir' ? -1 : 1));

    if (kind === 'source') {
      const fileStatus = queue.statusForPaths(items.filter((i) => i.type === 'file').map((i) => i.path));
      const dirStatus = queue.statusForDirs(items.filter((i) => i.type === 'dir').map((i) => i.path));
      for (const i of items) i.jobs = i.type === 'file' ? fileStatus[i.path] ?? null : dirStatus[i.path] ?? null;
    }

    const crumbs = [];
    for (let p = dir; ; p = path.dirname(p)) {
      // The root shows its friendly name (Settings → Folders) when it has one.
      const rootName = settings.get('sourceNames')?.[root] || path.basename(root) || root;
      crumbs.unshift({ name: p === root ? rootName : path.basename(p), path: p });
      if (p === root || path.dirname(p) === p) break;
    }
    return { root, path: dir, parent: dir === root ? null : path.dirname(dir), crumbs, items };
  });

  // ------------------------------------------------------------- presets
  app.get('/api/presets', async () => presets.list());
  app.get('/api/presets/:id', async (req) => {
    const p = presets.get(id(req));
    return { ...p, json: JSON.parse(p.json) };
  });
  app.post('/api/presets', async (req) => {
    const { fileName, content } = req.body ?? {};
    let data = content;
    if (typeof content === 'string') {
      try {
        data = JSON.parse(content);
      } catch {
        throw badRequest('The file is not valid JSON');
      }
    }
    const result = await presets.import(data, fileName);
    events.emit('presets');
    return result;
  });
  // The preset as a file HandBrake (desktop or CLI) can import.
  app.get('/api/presets/:id/export', async (req, reply) => {
    const p = presets.get(id(req));
    const safe = p.name.replace(/[^\w .()-]+/g, '_').trim() || 'preset';
    reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safe}.json"; filename*=UTF-8''${encodeURIComponent(p.name)}.json`);
    return p.json;
  });
  app.post('/api/presets/:id/default', async (req) => {
    presets.setDefault(id(req));
    events.emit('presets');
    return { ok: true };
  });
  app.delete('/api/presets/:id', async (req) => {
    presets.delete(id(req));
    events.emit('presets');
    return { ok: true };
  });

  // ------------------------------------------------------------- jobs
  app.get('/api/jobs', async () => ({ jobs: queue.list(), queue: queue.state() }));
  app.get('/api/jobs/:id', async (req) => queue.get(id(req)));
  app.get('/api/jobs/:id/log', async (req, reply) => {
    const jobId = id(req);
    queue.get(jobId);
    const text = await fs.readFile(queue.logFile(jobId), 'utf8').catch(() => '');
    const max = 2_000_000;
    reply.type('text/plain; charset=utf-8');
    return text.length > max ? `… (first ${text.length - max} characters omitted)\n` + text.slice(-max) : text;
  });

  app.post('/api/jobs', async (req) => {
    const { paths, presetId, position } = req.body ?? {};
    return queue.add({ paths, presetId, position });
  });
  app.patch('/api/jobs/:id', async (req) => queue.update(id(req), req.body ?? {}));
  app.post('/api/jobs/reorder', async (req) => {
    queue.reorder(req.body?.ids);
    return { ok: true };
  });
  app.post('/api/jobs/remove', async (req) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) throw badRequest('ids must be a list');
    await queue.remove(ids.map(Number));
    return { ok: true };
  });
  app.post('/api/jobs/clear', async (req) => ({ removed: await queue.clearFinished(req.body?.statuses) }));

  const action = (name, fn) =>
    app.post(`/api/jobs/:id/${name}`, async (req) => {
      const result = await fn(id(req), req.body ?? {});
      return result ?? { ok: true };
    });
  action('pause', (jobId) => queue.pause(jobId));
  action('resume', (jobId) => queue.resume(jobId));
  action('cancel', (jobId) => queue.cancel(jobId));
  action('retry', (jobId) => queue.retry(jobId));
  action('again', async (jobId, body) => ({ id: await queue.convertAgain(jobId, body) }));
  action('move', (jobId, body) => queue.move(jobId, body.where));
  action('verify', (jobId) => queue.verifyJob(jobId));

  // body.now: start even outside the conversion window.
  app.post('/api/queue/start', async (req) => {
    queue.setRunning(true, { now: req.body?.now === true });
    return queue.state();
  });
  app.post('/api/queue/stop', async () => {
    queue.setRunning(false);
    return queue.state();
  });
}
