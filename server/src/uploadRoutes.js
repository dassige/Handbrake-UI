import { MAX_CHUNK } from './upload.js';

export function registerUploadRoutes(app, { uploads }) {
  // Upload chunks arrive as raw bytes; the handler streams them to disk.
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

  app.post('/api/upload/check', async (req) => uploads.check(req.body ?? {}));
  app.put('/api/upload', { bodyLimit: MAX_CHUNK }, async (req) =>
    uploads.chunk(req.query, req.body, req.headers['content-length']),
  );
  app.post('/api/upload/discard', async (req) => uploads.discard(req.body ?? {}));
  app.post('/api/folders', async (req) => uploads.mkdir(req.body ?? {}));
}
