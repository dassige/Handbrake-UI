// The API description (OpenAPI 3.1), served as /api/openapi.json and browsable at /api/docs.
//
// The docs of each route live in openapi/paths/<area>.js, keyed by "METHOD /url", and are
// attached to the route when it is registered (onRoute), so the route files stay as they are.
// test/openapi.test.js fails when a route has no docs or docs have no route.
//
// What a docs entry does:
// - params, querystring, body: JSON Schema that Fastify VALIDATES (ajv: coerceTypes 'array',
//   useDefaults, removeAdditional only where additionalProperties is false). They must never be
//   stricter than the handler: no additionalProperties: false, no `default` (ajv would insert it),
//   enums only where the handler refuses other values, null allowed where the web app sends it.
// - response: documentation only. Responses are not serialized from it (see SERIALIZE_AS_IS),
//   so a wrong or partial schema can never change what a client gets.
// - docBody: a request body that is documented but not validated (raw uploads), in OpenAPI
//   form: { content: { '<type>': { schema } } }.
// The access level (auth.js routeAccess) is added to every operation, with its security.
import fs from 'node:fs';
import path from 'node:path';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { routeAccess } from '../auth.js';
import { DOCS, SCHEMAS } from './paths/index.js';

/** Tags in the order the docs page lists them. */
export const TAGS = [
  { name: 'Status', description: 'Version, health, about, and the live event stream.' },
  { name: 'Auth', description: 'Login, password, signed-in browsers and API keys. A signed-in browser only (or anyone while login is off); never an API key.' },
  { name: 'Settings', description: 'The settings of the Settings page.' },
  { name: 'Folders', description: 'Listing the sources and target folders, making folders, deleting files.' },
  { name: 'Presets', description: 'HandBrake presets: list, import, edit, export.' },
  { name: 'Jobs', description: 'Conversion jobs: add, change, control, logs.' },
  { name: 'Queue', description: 'Starting and stopping the queue.' },
  { name: 'Subtitles', description: 'Subtitle files next to a job’s source video.' },
  { name: 'Rename', description: 'Rename rule sets, previews, renaming files and undoing it.' },
  { name: 'Naming', description: 'Naming checks: which files do not follow a rule set.' },
  { name: 'Merge', description: 'Joining video files (parts of one film) into one.' },
  { name: 'Quality', description: 'Quality checks of existing video files.' },
  { name: 'Uploads', description: 'Uploading files into a sources folder, in chunks.' },
  { name: 'Downloads', description: 'Downloading files and folders (as ZIP).' },
  { name: 'Media', description: 'Playing video files: their details, the file itself, or a stream any browser can play.' },
  { name: 'Backup', description: 'Backups of settings and data, and restoring them.' },
  { name: 'Automation', description: 'Statistics, watch folders and notifications.' },
];
export const TAG_NAMES = TAGS.map((t) => t.name);

const ACCESS_NOTE = {
  public: '**Access:** public, also while login is on.',
  session: '**Access:** a signed-in browser (or anyone while login is off); API keys are refused.',
  read: '**Access:** any API key (read, queue or full).',
  queue: '**Access:** an API key with queue or full access.',
  admin: '**Access:** an API key with full access.',
};

const DESCRIPTION = `
The API the EncForge web app itself uses. Everything is JSON under \`/api/\`, unless an
operation says otherwise (downloads, logs, uploads).

## Authentication

Login is off by default: then every request is let in. Once login is turned on (Settings →
Security), a request needs either the browser's session cookie or an **API key**, made in
Settings → Security and sent as \`Authorization: Bearer ef_…\` or \`X-API-Key: ef_…\`.
A key that is sent is checked also while login is off.

| Access | Allows |
|---|---|
| read | every \`GET\`: queue, jobs, presets, settings (webhook headers hidden), stats, folder lists, downloads, the event stream |
| queue | also every other change: add and control jobs, the queue, uploads, new folders, quality and naming checks |
| full | also settings, presets, rename rule sets, renaming and deleting files, merges, backups and restore |

Each operation below says what it needs. Requests from a browser on another website that would
change something are refused (\`403\`, code \`crossSite\`).

## Errors

An error answers with a 4xx/5xx status and \`{ "error": "message" }\`; some add a
machine-readable \`code\`, e.g. \`signInRequired\` (401), \`invalidApiKey\` (401), \`scope\` (403).
A request that does not match the documented parameters gets \`400\` with code \`invalidRequest\`.

## Paths

Files and folders are identified by their **absolute path on the server** (with Docker: as seen
inside the container, e.g. \`/mnt/downloads/Film.mkv\`), and must be inside the sources folders
(or the target folder, where an operation says so).

## Live updates

\`GET /api/events\` is a Server-Sent Events stream: \`job\`, \`progress\`, \`queue\`, \`jobs\`,
\`presets\`, \`settings\` and others, each with a JSON payload. The web app uses it to stay
current without polling.

## Stability

Fields and operations are only added within this version of the API; anything that would break
a client would move to a new path (\`/api/v2/\`).
`.trim();

/** Responses are sent as the handlers return them: response schemas only document. */
const SERIALIZE_AS_IS = () => (data) => JSON.stringify(data);

const isApiRoute = (url) => url.startsWith('/api/') && !url.startsWith('/api/docs') && url !== '/api/openapi.json';

/**
 * Adds the docs to every API route registered after it, and the docs pages.
 * Call before registering any route.
 */
export async function registerOpenApi(app, { version = '0.0.0', webDir = null } = {}) {
  app.setSerializerCompiler(SERIALIZE_AS_IS);
  for (const s of SCHEMAS) app.addSchema(s);

  app.addHook('onRoute', (route) => {
    const methods = [route.method].flat();
    if (!isApiRoute(route.url) || methods.includes('HEAD')) return;
    const doc = DOCS[`${methods[0]} ${route.url}`];
    if (!doc) return; // test/openapi.test.js makes sure this does not happen
    const { docBody, ...schema } = doc;
    route.schema = { ...schema, ...(docBody ? { 'x-doc-body': docBody } : {}), ...route.schema };
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'EncForge API', version, description: DESCRIPTION },
      tags: TAGS,
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer', description: 'An API key (ef_…) from Settings → Security.' },
          apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'The same API key, in another header.' },
          session: { type: 'apiKey', in: 'cookie', name: 'encforge_session', description: 'The cookie a browser gets when signing in.' },
        },
      },
      security: [{ apiKey: [] }, { apiKeyHeader: [] }, { session: [] }],
    },
    // Shared schemas appear under their own name (Job, Preset…) instead of def-0, def-1…
    refResolver: { buildLocalReference: (json, baseUri, fragment, i) => json.$id || `def-${i}` },
    transform: ({ schema, url, route }) => {
      if (!schema || schema.hide) return { schema, url };
      const { 'x-doc-body': docBody, ...out } = schema;
      const access = routeAccess([route.method].flat()[0], route.url);
      out['x-access'] = access;
      if (access === 'public') out.security = [];
      if (access === 'session') out.security = [{ session: [] }];
      out.description = [schema.description, ACCESS_NOTE[access]].filter(Boolean).join('\n\n');
      if (docBody) out.body = docBody;
      return { schema: out, url };
    },
  });

  const icon = webDir ? path.join(webDir, 'icon-192.png') : null;
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, defaultModelsExpandDepth: 0, tryItOutEnabled: false },
    theme: { title: 'EncForge API' },
    ...(icon && fs.existsSync(icon) ? { logo: { type: 'image/png', content: fs.readFileSync(icon) } } : {}),
    logLevel: 'warn',
  });
  app.get('/api/openapi.json', { schema: { hide: true }, logLevel: 'warn' }, async () => app.swagger());
}
