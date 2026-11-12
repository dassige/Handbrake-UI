import { badRequest } from './errors.js';

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n)) throw badRequest('Invalid id');
  return n;
};

export function registerQualityRoutes(app, { quality }) {
  app.get('/api/quality/scans', async () => quality.list());
  app.post('/api/quality/scans', async (req) => quality.start(req.body ?? {}));
  app.get('/api/quality/scans/:id', async (req) => quality.get(id(req)));
  app.post('/api/quality/scans/:id/recheck', async (req) => quality.recheck(id(req), req.body ?? {}));
  app.post('/api/quality/scans/:id/cancel', async (req) => {
    quality.cancel(id(req));
    return { ok: true };
  });
  app.delete('/api/quality/scans/:id', async (req) => {
    quality.remove(id(req));
    return { ok: true };
  });
}
