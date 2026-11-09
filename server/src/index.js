import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { openDb } from './db.js';
import { Settings } from './settings.js';
import { HandBrake } from './handbrake.js';
import { Presets } from './presets.js';
import { Queue } from './queue.js';
import { Events } from './events.js';
import { registerRoutes } from './routes.js';
import { Renamer } from './rename/renamer.js';
import { Verifier } from './verify.js';
import { registerRenameRoutes } from './rename/routes.js';

const { version } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'));

for (const dir of ['', 'logs', 'tmp']) fs.mkdirSync(path.join(config.dataDir, dir), { recursive: true });

const app = Fastify({
  logger: { level: config.logLevel },
  bodyLimit: 10 * 1024 * 1024,
});

const db = openDb(path.join(config.dataDir, 'handbrake-ui.db'));
const settings = new Settings(db, config);
const handbrake = new HandBrake(config.handbrakeCli);
const events = new Events();
const presets = new Presets({ db, settings, handbrake, tmpDir: path.join(config.dataDir, 'tmp') });
const verifier = new Verifier({ ffprobe: config.ffprobe, ffmpeg: config.ffmpeg });
const queue = new Queue({ db, settings, presets, handbrake, verifier, events, dataDir: config.dataDir, log: app.log });
const renamer = new Renamer({ db, settings, events, log: app.log });
queue.renamer = renamer;

app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode ?? (err.code === 'ENOENT' ? 404 : 500);
  if (status >= 500) req.log.error(err);
  reply.status(status).send({ error: err.message });
});

// Per-request access logs are noise here (the UI polls); keep warnings and errors.
await app.register(
  async (api) => {
    registerRoutes(api, { settings, presets, queue, events, handbrake, renamer, version });
    registerRenameRoutes(api, { renamer });
  },
  {
    logLevel: 'warn',
  },
);

if (fs.existsSync(config.webDir)) {
  await app.register(fastifyStatic, { root: config.webDir, wildcard: false, logLevel: 'warn' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) reply.status(404).send({ error: 'Not found' });
    else reply.sendFile('index.html');
  });
} else {
  app.log.warn(`Web UI not found at ${config.webDir} (run "npm run build" in web/)`);
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, stopping`);
  await queue.shutdown();
  events.close();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`Data: ${config.dataDir}  HandBrakeCLI: ${config.handbrakeCli}`);
await queue.recover();
