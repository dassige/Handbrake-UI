import { badRequest } from './errors.js';

/** Stats, watch folders and notifications. */
export function registerAutomationRoutes(app, { history, watcher, notifier }) {
  // days = 7 | 30 | 90 | 365 | 0 (everything)
  app.get('/api/stats', async (req) => {
    const days = req.query.days == null ? 30 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw badRequest('days must be a whole number of days (0 = everything)');
    return history.stats({ days });
  });

  app.get('/api/watch', async () => watcher.status());
  app.post('/api/watch/scan', async () => {
    const r = await watcher.scan();
    return { added: r?.added?.length ?? 0, status: watcher.status() };
  });

  app.get('/api/notifications/recent', async () => notifier.recent());
  // Sends a test through one channel using the settings in the body (not yet saved).
  app.post('/api/notifications/test', async (req) => {
    const { channel, notifications } = req.body ?? {};
    return notifier.test(channel, notifications);
  });
}
