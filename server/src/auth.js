// Login for the web app and API keys for other programs.
//
// Login is off by default: then every request is let in, as before. Once a password is set
// and login turned on, every /api request needs either
//   - the session cookie the browser gets when signing in (full access), or
//   - an API key: "Authorization: Bearer ef_…" or "X-API-Key: ef_…", whose scope limits it.
// An API key is checked (and its scope applied) also while login is off, so an integration
// can be tried before login is turned on.
//
// Scopes, each including the one before it:
//   read   GET requests: queue, jobs, presets, settings (webhook headers hidden), stats,
//          folder lists, file downloads, the event stream
//   queue  also every other change: add and control jobs, upload, new folders, merges
//          (that keep the parts), quality and naming checks
//   admin  also ADMIN_ROUTES: settings, presets and rename rules, renaming and deleting files,
//          backups and restore
// Login, password and API keys themselves can only be managed from a signed-in browser
// (or by anyone while login is off).
//
// The password (scrypt), the sessions and the keys (SHA-256: they are long random tokens)
// live in tables of their own, left out of backups and never restored.
// DISABLE_LOGIN=true in the environment turns login off whatever the setting says, and lets
// the password be set without the current one: the way back in after forgetting it.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from './errors.js';

const scrypt = promisify(scryptCb);

export const SCOPES = ['read', 'queue', 'admin'];
const RANK = { read: 1, queue: 2, admin: 3 };

export const COOKIE = 'encforge_session';
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;
// last-seen times are written at most this often (every request would be a database write).
const TOUCH_MS = 5 * 60_000;
const KEY_TOUCH_MS = 60_000;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
export const MAX_KEYS = 50;
export const MAX_KEY_NAME = 40;
const KEY_PREFIX = 'ef_';
// Failed sign-ins from one address before it has to wait LOCK_MS.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** Tables that hold credentials: not in backups. */
export const AUTH_TABLES = ['auth', 'auth_sessions', 'api_keys'];

/** Routes anyone may call, also when login is on. */
const PUBLIC = new Set(['GET /api/health', 'GET /api/auth/status', 'POST /api/auth/login', 'POST /api/auth/logout']);

/** Routes that need an admin key; other GETs need read, other changes queue. */
export const ADMIN_ROUTES = [
  'PUT /api/settings',
  'POST /api/notifications/test',
  'POST /api/presets',
  'POST /api/presets/new',
  'PUT /api/presets/:id',
  'POST /api/presets/:id/default',
  'DELETE /api/presets/:id',
  'POST /api/rename/rules',
  'POST /api/rename/rules/import',
  'PUT /api/rename/rules/:id',
  'DELETE /api/rename/rules/:id',
  'POST /api/rename/apply',
  'POST /api/rename/history/:id/undo',
  'POST /api/files/delete',
  // Deletes or moves the original.
  'POST /api/jobs/:id/replace-original',
  'POST /api/replace',
  'POST /api/replace/stop',
  'DELETE /api/replace',
  // A merge can remove its parts afterwards.
  'POST /api/merge',
  'GET /api/backup',
  'GET /api/backup/snapshots',
  'POST /api/backup/snapshots',
  'GET /api/backup/snapshots/:name',
  'DELETE /api/backup/snapshots/:name',
  'GET /api/backup/scheduled',
  'POST /api/backup/scheduled/run',
  'GET /api/backup/scheduled/:name',
  'DELETE /api/backup/scheduled/:name',
  'POST /api/backup/inspect',
  'POST /api/backup/restore',
];
const ADMIN = new Set(ADMIN_ROUTES);

/** 'public' | 'session' | 'read' | 'queue' | 'admin' for a method and a route pattern (undefined: no such route). */
export function routeAccess(method, url) {
  const m = method === 'HEAD' ? 'GET' : method;
  const key = `${m} ${url}`;
  if (PUBLIC.has(key)) return 'public';
  // The API docs (openapi/): the page, its files and the description itself.
  if (url === '/api/openapi.json' || url === '/api/docs' || url?.startsWith('/api/docs/')) return 'public';
  if (url === '/api/auth' || url?.startsWith('/api/auth/')) return 'session';
  if (ADMIN.has(key)) return 'admin';
  return m === 'GET' ? 'read' : 'queue';
}

export const hasScope = (scope, needed) => (RANK[scope] ?? 0) >= RANK[needed];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const randomToken = (bytes) => randomBytes(bytes).toString('base64url');

/** The API key sent with a request, or null. Other Authorization schemes (e.g. a proxy's Basic) are ignored. */
export function requestKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '');
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : null;
}

/** One cookie's value from the Cookie header, or null. */
export function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** HTTPS directly or behind a proxy that says so (only used to add Secure to the cookie). */
const isHttps = (req) => req.protocol === 'https' || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';

export function setSessionCookie(reply, req, token) {
  const secure = isHttps(req) ? '; Secure' : '';
  reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`);
}

export function clearSessionCookie(reply, req) {
  const secure = isHttps(req) ? '; Secure' : '';
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

function checkNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw badRequest(`The password must be at least ${MIN_PASSWORD} characters`, 'passwordTooShort');
  }
  if (password.length > MAX_PASSWORD) throw badRequest(`The password can be at most ${MAX_PASSWORD} characters`, 'passwordTooLong');
}

const publicKey = (r) => ({
  id: r.id, name: r.name, scope: r.scope, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at, lastUsedIp: r.last_used_ip,
});

export class Auth {
  /** forcedOff: DISABLE_LOGIN is set. now: replaceable clock (tests). */
  constructor({ db, forcedOff = false, now = () => Date.now() }) {
    Object.assign(this, { db, forcedOff, now });
    this.failures = new Map(); // ip → { count, until }
  }

  // ---------------------------------------------------------------- stored values

  value(key) {
    const row = this.db.prepare('SELECT value FROM auth WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  store(key, value) {
    this.db.prepare('INSERT INTO auth (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  /** Login is required now (on in the settings, and not turned off by DISABLE_LOGIN). */
  get enabled() {
    return !this.forcedOff && this.value('enabled') === true;
  }

  passwordSet() {
    return !!this.value('passwordHash');
  }

  /** What a client may know about login, and how it is let in (principal: identify()'s result). */
  status(principal) {
    return {
      enabled: this.enabled,
      // DISABLE_LOGIN is set: login is off whatever savedEnabled says.
      forcedOff: this.forcedOff,
      savedEnabled: this.value('enabled') === true,
      passwordSet: this.passwordSet(),
      via: principal?.via ?? null,
      scope: principal?.scope ?? null,
      keyName: principal?.name ?? null,
    };
  }

  // ---------------------------------------------------------------- who is asking

  /**
   * { via: 'key', scope, keyId, name } | { via: 'session', scope: 'admin', sessionHash }
   * | { via: 'open', scope: 'admin' } (login off) | null (must sign in).
   * Throws 401 for an unknown API key.
   */
  identify(req) {
    const key = requestKey(req);
    if (key) {
      const row = this.keyFor(key, req.ip);
      if (!row) throw unauthorized('Unknown or revoked API key', 'invalidApiKey');
      return { via: 'key', scope: row.scope, keyId: row.id, name: row.name };
    }
    const sid = readCookie(req);
    const session = sid ? this.session(sid) : null;
    if (session) return { via: 'session', scope: 'admin', sessionHash: session.id_hash };
    if (!this.enabled) return { via: 'open', scope: 'admin' };
    return null;
  }

  /** Fastify onRequest hook for every /api request. */
  hook() {
    return async (req) => {
      if (!req.url.startsWith('/api/')) return;
      // Browsers say where a request comes from: another website may not change anything here.
      // (With login on, the SameSite cookie already stops it; with login off this is the only guard.)
      const site = req.headers['sec-fetch-site'];
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (site === 'cross-site' || site === 'same-site')) {
        throw forbidden('Requests from other websites are refused', 'crossSite');
      }
      const access = routeAccess(req.method, req.routeOptions?.url);
      if (access === 'public') {
        try {
          req.auth = this.identify(req);
        } catch {
          req.auth = null;
        }
        return;
      }
      req.auth = this.identify(req);
      if (!req.auth) throw unauthorized('Sign in first', 'signInRequired');
      if (access === 'session') {
        if (req.auth.via === 'key') throw forbidden('Login and API keys can only be managed from a signed-in browser', 'browserOnly');
        return;
      }
      if (!hasScope(req.auth.scope, access)) {
        throw forbidden(`This API key has ${req.auth.scope} access; this request needs ${access}`, 'scope');
      }
    };
  }

  // ---------------------------------------------------------------- password and login

  checkThrottle(ip) {
    const f = this.failures.get(ip);
    if (f?.until && f.until > this.now()) {
      const minutes = Math.ceil((f.until - this.now()) / 60_000);
      throw new HttpError(429, `Too many failed attempts: try again in ${minutes} minute${minutes === 1 ? '' : 's'}`, 'tooManyAttempts');
    }
  }

  failed(ip) {
    const now = this.now();
    let f = this.failures.get(ip);
    if (!f || (f.until && f.until <= now) || now - f.last > LOCK_MS) f = { count: 0, until: 0, last: now };
    f.count += 1;
    f.last = now;
    if (f.count >= MAX_FAILURES) f.until = now + LOCK_MS;
    this.failures.set(ip, f);
    // Keep the map small.
    if (this.failures.size > 1000) for (const [k, v] of this.failures) if (now - v.last > LOCK_MS) this.failures.delete(k);
  }

  /** Signs in: returns the new session's token. */
  async login(password, req) {
    const ip = req.ip ?? '';
    this.checkThrottle(ip);
    if (!this.enabled) throw conflict('Login is off');
    const ok = typeof password === 'string' && password.length <= MAX_PASSWORD && (await verifyPassword(password, this.value('passwordHash')));
    if (!ok) {
      this.failed(ip);
      throw unauthorized('Wrong password', 'wrongPassword');
    }
    this.failures.delete(ip);
    return this.createSession(req);
  }

  /**
   * Sets or changes the password. The current one is needed when there is one,
   * except with DISABLE_LOGIN. Every other session is signed out.
   */
  async setPassword({ current, password }, { keepSession = null, ip = '' } = {}) {
    checkNewPassword(password);
    if (this.passwordSet() && !this.forcedOff) {
      this.checkThrottle(ip);
      const ok = typeof current === 'string' && current.length <= MAX_PASSWORD && (await verifyPassword(current, this.value('passwordHash')));
      if (!ok) {
        this.failed(ip);
        throw badRequest('The current password is wrong', 'wrongPassword');
      }
    }
    this.store('passwordHash', await hashPassword(password));
    this.deleteSessions({ except: keepSession });
  }

  /** Turns login on (needs a password) or off. Off signs every browser out (their sessions would be stale). */
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw badRequest('enabled must be true or false');
    if (enabled && !this.passwordSet()) throw badRequest('Set a password first', 'noPassword');
    if (enabled && this.forcedOff) throw conflict('Login is turned off on the server (DISABLE_LOGIN); remove it to turn login on');
    this.store('enabled', enabled);
    if (!enabled) this.deleteSessions();
  }

  // ---------------------------------------------------------------- sessions

  createSession(req) {
    const now = this.now();
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    const token = randomToken(32);
    this.db.prepare(`INSERT INTO auth_sessions (id_hash, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(sha256(token), now, now, now + SESSION_MS, req.ip ?? null, String(req.headers?.['user-agent'] ?? '').slice(0, 200) || null);
    return token;
  }

  /** The session row for a cookie value, or null; keeps it alive (it ends after SESSION_DAYS unused). */
  session(token) {
    const now = this.now();
    const row = this.db.prepare('SELECT * FROM auth_sessions WHERE id_hash = ?').get(sha256(token));
    if (!row) return null;
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(row.id_hash);
      return null;
    }
    if (now - row.last_seen_at > TOUCH_MS) {
      this.db.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(now, now + SESSION_MS, row.id_hash);
    }
    return row;
  }

  deleteSession(token) {
    this.db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(sha256(token));
  }

  /** Signs out every browser, but the one whose session hash is except. Returns how many. */
  deleteSessions({ except = null } = {}) {
    return Number(this.db.prepare('DELETE FROM auth_sessions WHERE id_hash IS NOT ?').run(except).changes);
  }

  listSessions(currentHash) {
    return this.db.prepare('SELECT * FROM auth_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC').all(this.now()).map((r) => ({
      current: r.id_hash === currentHash, createdAt: r.created_at, lastSeenAt: r.last_seen_at, ip: r.ip, userAgent: r.user_agent,
    }));
  }

  // ---------------------------------------------------------------- API keys

  listKeys() {
    return this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC, id DESC').all().map(publicKey);
  }

  /** Returns { key, token }: the token is shown once and only its hash is kept. */
  createKey({ name, scope } = {}) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!n) throw badRequest('The key needs a name');
    if (n.length > MAX_KEY_NAME) throw badRequest(`A key name can be at most ${MAX_KEY_NAME} characters`);
    if (!SCOPES.includes(scope)) throw badRequest(`scope must be one of ${SCOPES.join(', ')}`);
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM api_keys').get().n;
    if (count >= MAX_KEYS) throw badRequest(`At most ${MAX_KEYS} API keys`);
    const token = KEY_PREFIX + randomToken(24);
    const r = this.db.prepare('INSERT INTO api_keys (name, scope, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(n, scope, sha256(token), token.slice(0, KEY_PREFIX.length + 4), this.now());
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(r.lastInsertRowid));
    return { key: publicKey(row), token };
  }

  deleteKey(id) {
    const r = this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    if (!r.changes) throw notFound(`API key ${id} not found`);
  }

  /** The key row for a token, or null; records when (and from where) it was last used. */
  keyFor(token, ip) {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE hash = ?').get(sha256(token));
    if (!row) return null;
    const now = this.now();
    if (!row.last_used_at || now - row.last_used_at > KEY_TOUCH_MS || row.last_used_ip !== (ip ?? null)) {
      this.db.prepare('UPDATE api_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?').run(now, ip ?? null, row.id);
    }
    return row;
  }
}
