import { badRequest } from './errors.js';
import { clearSessionCookie, readCookie, setSessionCookie } from './auth.js';

/**
 * Login, password and API keys (auth.js). Status, login and logout are public; the rest
 * is only for a signed-in browser (or anyone while login is off), never for an API key.
 */
export function registerAuthRoutes(app, { auth, events }) {
  // Something changed that other open Settings pages show; streams reconnect and are checked again.
  const changed = ({ reconnect = false } = {}) => {
    events.emit('auth');
    if (reconnect) events.disconnectAll();
  };

  app.get('/api/auth/status', async (req, reply) => {
    // Each visit renews the cookie, so a browser in use stays signed in.
    if (req.auth?.via === 'session') setSessionCookie(reply, req, readCookie(req));
    return auth.status(req.auth);
  });

  // body: { password }
  app.post('/api/auth/login', async (req, reply) => {
    const token = await auth.login(req.body?.password, req);
    setSessionCookie(reply, req, token);
    changed();
    return auth.status({ via: 'session', scope: 'admin' });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = readCookie(req);
    if (sid) auth.deleteSession(sid);
    clearSessionCookie(reply, req);
    if (sid) changed();
    return { ok: true };
  });

  // body: { current?, password }
  app.put('/api/auth/password', async (req) => {
    const first = !auth.passwordSet();
    await auth.setPassword(req.body ?? {}, { keepSession: req.auth.sessionHash ?? null, ip: req.ip });
    changed({ reconnect: !first });
    return auth.status(req.auth);
  });

  // body: { enabled }. Turning login on from a browser that is not signed in yet signs it in.
  app.put('/api/auth/settings', async (req, reply) => {
    const enabled = req.body?.enabled;
    auth.setEnabled(enabled);
    let principal = req.auth;
    if (enabled && principal.via === 'open') {
      setSessionCookie(reply, req, auth.createSession(req));
      principal = { via: 'session', scope: 'admin' };
    }
    if (!enabled) clearSessionCookie(reply, req);
    changed({ reconnect: true });
    return auth.status(enabled ? principal : { via: 'open', scope: 'admin' });
  });

  app.get('/api/auth/sessions', async (req) => auth.listSessions(req.auth.sessionHash ?? null));
  // Signs out every other browser.
  app.delete('/api/auth/sessions', async (req) => {
    const removed = auth.deleteSessions({ except: req.auth.sessionHash ?? null });
    changed({ reconnect: true });
    return { removed };
  });

  app.get('/api/auth/keys', async () => auth.listKeys());
  // body: { name, scope: read | queue | admin } → { key, token }; the token is shown only here.
  app.post('/api/auth/keys', async (req) => {
    const result = auth.createKey(req.body ?? {});
    changed();
    return result;
  });
  app.delete('/api/auth/keys/:id', async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest('Invalid id');
    auth.deleteKey(id);
    changed({ reconnect: true });
    return { ok: true };
  });
}
