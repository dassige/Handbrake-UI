// Docs of authRoutes.js (login, password, sessions, API keys). Conventions: ../index.js.

const authStatus = {
  type: 'object',
  description: 'Login state, and how this request was let in.',
  properties: {
    enabled: { type: 'boolean', description: 'Login is required now.' },
    forcedOff: { type: 'boolean', description: 'DISABLE_LOGIN is set on the server: login is off whatever savedEnabled says.' },
    savedEnabled: { type: 'boolean', description: 'Login is turned on in the settings.' },
    passwordSet: { type: 'boolean' },
    via: { type: ['string', 'null'], enum: ['open', 'session', 'key', null], description: 'open: login is off; session: a signed-in browser; key: an API key; null: not let in.' },
    scope: { type: ['string', 'null'], enum: ['read', 'queue', 'admin', null] },
    keyName: { type: ['string', 'null'], description: 'The API key’s name, when one was used.' },
  },
};

export const schemas = [
  { $id: 'Ok', type: 'object', properties: { ok: { type: 'boolean', const: true } } },
  {
    $id: 'Error',
    type: 'object',
    properties: {
      error: { type: 'string', description: 'What went wrong, in English.' },
      code: { type: 'string', description: 'A machine-readable reason, for some errors (e.g. signInRequired, invalidApiKey, scope, wrongPassword).' },
    },
    required: ['error'],
  },
  { $id: 'AuthStatus', ...authStatus },
  {
    $id: 'ApiKey',
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      scope: { type: 'string', enum: ['read', 'queue', 'admin'], description: 'read, queue or admin (shown as “Full” in the app).' },
      prefix: { type: 'string', description: 'The key’s first characters, to tell keys apart (ef_ + 4).' },
      createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
      lastUsedAt: { type: ['integer', 'null'] },
      lastUsedIp: { type: ['string', 'null'] },
    },
  },
];

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const ok = { 200: { description: 'Done.', $ref: 'Ok#' } };

export const paths = {
  'GET /api/auth/status': {
    operationId: 'getAuthStatus',
    tags: ['Auth'],
    summary: 'Login state',
    description: 'Whether login is on, and how this request was let in (via null: it would have to sign in). A signed-in browser gets its cookie renewed.',
    response: { 200: { $ref: 'AuthStatus#' } },
  },
  'POST /api/auth/login': {
    operationId: 'login',
    tags: ['Auth'],
    summary: 'Sign in',
    description: 'Checks the password and sets the session cookie (`encforge_session`, HttpOnly, SameSite=Strict, 30 days). After 5 wrong passwords from one address, sign-in from there is refused for 15 minutes (429).',
    body: { type: 'object', properties: { password: { type: 'string' } } },
    response: {
      200: { $ref: 'AuthStatus#' },
      401: { description: 'Wrong password (code wrongPassword).', $ref: 'Error#' },
      409: { description: 'Login is off.', $ref: 'Error#' },
      429: { description: 'Too many failed attempts (code tooManyAttempts).', $ref: 'Error#' },
    },
  },
  'POST /api/auth/logout': {
    operationId: 'logout',
    tags: ['Auth'],
    summary: 'Sign out',
    description: 'Ends this browser’s session and clears its cookie.',
    response: ok,
  },
  'PUT /api/auth/password': {
    operationId: 'setPassword',
    tags: ['Auth'],
    summary: 'Set or change the password',
    description: 'At least 8 characters. `current` is needed when a password is set (not with DISABLE_LOGIN). Signs every other browser out.',
    body: {
      type: 'object',
      properties: { current: { type: ['string', 'null'] }, password: { type: 'string' } },
      required: ['password'],
    },
    response: { 200: { $ref: 'AuthStatus#' }, 400: { description: 'Too short or long (passwordTooShort, passwordTooLong), or the current password is wrong (wrongPassword).', $ref: 'Error#' } },
  },
  'PUT /api/auth/settings': {
    operationId: 'setLoginRequired',
    tags: ['Auth'],
    summary: 'Turn login on or off',
    description: 'Turning it on needs a password; a browser that is not signed in yet gets signed in. Turning it off signs every browser out.',
    body: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
    response: { 200: { $ref: 'AuthStatus#' }, 400: { description: 'No password yet (code noPassword).', $ref: 'Error#' }, 409: { description: 'DISABLE_LOGIN is set.', $ref: 'Error#' } },
  },
  'GET /api/auth/sessions': {
    operationId: 'listSessions',
    tags: ['Auth'],
    summary: 'Signed-in browsers',
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            current: { type: 'boolean', description: 'This browser.' },
            createdAt: { type: 'integer' },
            lastSeenAt: { type: 'integer' },
            ip: { type: ['string', 'null'] },
            userAgent: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
  'DELETE /api/auth/sessions': {
    operationId: 'signOutOtherSessions',
    tags: ['Auth'],
    summary: 'Sign out every other browser',
    response: { 200: { type: 'object', properties: { removed: { type: 'integer' } } } },
  },
  'GET /api/auth/keys': {
    operationId: 'listApiKeys',
    tags: ['Auth'],
    summary: 'API keys',
    response: { 200: { type: 'array', items: { $ref: 'ApiKey#' } } },
  },
  'POST /api/auth/keys': {
    operationId: 'createApiKey',
    tags: ['Auth'],
    summary: 'Create an API key',
    description: 'The key itself (`token`) is in this answer only: only its hash is kept.',
    body: {
      type: 'object',
      properties: { name: { type: 'string', description: 'At most 40 characters.' }, scope: { type: 'string', enum: ['read', 'queue', 'admin'] } },
      required: ['name', 'scope'],
    },
    response: { 200: { type: 'object', properties: { key: { $ref: 'ApiKey#' }, token: { type: 'string', description: 'ef_ followed by 32 characters.' } } } },
  },
  'DELETE /api/auth/keys/:id': {
    operationId: 'deleteApiKey',
    tags: ['Auth'],
    summary: 'Revoke an API key',
    params: idParam,
    response: { ...ok, 404: { $ref: 'Error#' } },
  },
};

export const examples = [
  { method: 'GET', url: '/api/auth/status' },
  { method: 'POST', url: '/api/auth/login', body: { password: 'correct horse' } },
  { method: 'POST', url: '/api/auth/logout', body: {} },
  { method: 'PUT', url: '/api/auth/password', body: { password: 'correct horse' } },
  { method: 'PUT', url: '/api/auth/password', body: { current: 'correct horse', password: 'battery staple' } },
  { method: 'PUT', url: '/api/auth/settings', body: { enabled: true } },
  { method: 'DELETE', url: '/api/auth/sessions' },
  { method: 'POST', url: '/api/auth/keys', body: { name: 'Sonarr', scope: 'queue' } },
  { method: 'DELETE', url: '/api/auth/keys/3' },
];
