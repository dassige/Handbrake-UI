export function registerBackupRoutes(app, { backups }) {
  // A fresh backup, streamed: ?logs=0 leaves the job logs out.
  app.get('/api/backup', async (req, reply) => backups.send(req, reply));

  // Backups kept on the server (made by hand or automatically before a restore).
  app.get('/api/backup/snapshots', async () => backups.listSnapshots());
  app.post('/api/backup/snapshots', async (req) => backups.saveSnapshot({ logs: req.body?.logs !== false }));
  app.get('/api/backup/snapshots/:name', async (req, reply) => backups.sendSnapshot(req.params.name, reply));
  app.delete('/api/backup/snapshots/:name', async (req) => backups.deleteSnapshot(req.params.name));

  // Restore, in two steps: inspect (an uploaded file as the raw body, or { source: "snapshot:<name>" }),
  // then restore { source, scope: "config" | "all" }.
  app.post('/api/backup/inspect', async (req) => {
    const source = req.headers['content-type']?.startsWith('application/octet-stream')
      ? await backups.receive(req.body)
      : req.body?.source;
    return backups.inspect(source);
  });
  app.post('/api/backup/restore', async (req) => backups.restore(req.body ?? {}));
}
