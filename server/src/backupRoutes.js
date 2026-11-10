export function registerBackupRoutes(app, { backups, backupScheduler }) {
  // A fresh backup, streamed: ?logs=0 leaves the job logs out.
  app.get('/api/backup', async (req, reply) => backups.send(req, reply));

  // Backups kept on the server (made by hand or automatically before a restore).
  app.get('/api/backup/snapshots', async () => backups.listSnapshots());
  app.post('/api/backup/snapshots', async (req) => backups.saveSnapshot({ logs: req.body?.logs !== false }));
  app.get('/api/backup/snapshots/:name', async (req, reply) => backups.sendSnapshot(req.params.name, reply));
  app.delete('/api/backup/snapshots/:name', async (req) => backups.deleteSnapshot(req.params.name));

  // Scheduled backups, in the folder chosen in Settings (or DATA_DIR/backups).
  app.get('/api/backup/scheduled', async () => backupScheduler.status());
  app.post('/api/backup/scheduled/run', async () => {
    const r = await backupScheduler.run();
    if (!r.ok) throw Object.assign(new Error(r.error), { statusCode: 400 });
    return { last: r, status: await backupScheduler.status() };
  });
  app.get('/api/backup/scheduled/:name', async (req, reply) => backups.sendScheduled(req.params.name, reply));
  app.delete('/api/backup/scheduled/:name', async (req) => {
    await backups.deleteScheduled(req.params.name);
    backupScheduler.emit();
    return { ok: true };
  });

  // Restore, in two steps: inspect (an uploaded file as the raw body, or { source: "snapshot:<name>" | "scheduled:<name>" }),
  // then restore { source, scope: "config" | "all" }.
  app.post('/api/backup/inspect', async (req) => {
    const source = req.headers['content-type']?.startsWith('application/octet-stream')
      ? await backups.receive(req.body)
      : req.body?.source;
    return backups.inspect(source);
  });
  app.post('/api/backup/restore', async (req) => backups.restore(req.body ?? {}));
}
