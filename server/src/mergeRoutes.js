import { badRequest } from './errors.js';

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n)) throw badRequest('Invalid id');
  return n;
};

export function registerMergeRoutes(app, { merger }) {
  app.get('/api/merge', async () => merger.list());
  app.post('/api/merge/inspect', async (req) => merger.inspect(req.body ?? {}));
  app.post('/api/merge', async (req) => merger.start(req.body ?? {}));
  app.post('/api/merge/:id/cancel', async (req) => {
    merger.cancel(id(req));
    return { ok: true };
  });
  app.delete('/api/merge/:id', async (req) => {
    merger.remove(id(req));
    return { ok: true };
  });
}
