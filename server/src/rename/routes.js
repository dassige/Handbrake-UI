import { badRequest } from '../errors.js';

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n)) throw badRequest('Invalid id');
  return n;
};

export function registerRenameRoutes(app, { renamer }) {
  app.get('/api/rename/rules', async () => renamer.listRules());
  app.get('/api/rename/rules/:id', async (req) => renamer.getRule(id(req)));
  app.post('/api/rename/rules', async (req) => renamer.createRule(req.body ?? {}));
  app.put('/api/rename/rules/:id', async (req) => renamer.updateRule(id(req), req.body ?? {}));
  app.delete('/api/rename/rules/:id', async (req) => {
    renamer.deleteRule(id(req));
    return { ok: true };
  });
  app.post('/api/rename/rules/import', async (req) => renamer.importRule(req.body?.fileName, req.body?.content));
  app.get('/api/rename/rules/:id/export', async (req, reply) => {
    const data = renamer.exportRule(id(req));
    const file = `${data.name.replace(/[^\w.-]+/g, '_')}.rename.json`;
    reply.header('Content-Disposition', `attachment; filename="${file}"`);
    return data;
  });

  app.post('/api/rename/test', async (req) => renamer.test(req.body ?? {}));
  app.post('/api/rename/preview', async (req) => ({ rows: await renamer.preview(req.body ?? {}) }));
  app.post('/api/rename/apply', async (req) => {
    const { items, ruleName } = req.body ?? {};
    return renamer.apply({ items, ruleName });
  });

  app.get('/api/rename/history', async () => renamer.history());
  app.post('/api/rename/history/:id/undo', async (req) => renamer.undo(id(req)));
}
