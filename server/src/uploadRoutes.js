import { MAX_CHUNK } from './upload.js';

/** Changes to the sources folders: uploads, new folders and deleting. */
export function registerUploadRoutes(app, { uploads, sourceFiles }) {
  // Upload chunks arrive as raw bytes; the handler streams them to disk.
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

  app.post('/api/upload/check', async (req) => uploads.check(req.body ?? {}));
  app.put('/api/upload', { bodyLimit: MAX_CHUNK }, async (req) =>
    uploads.chunk(req.query, req.body, req.headers['content-length']),
  );
  app.post('/api/upload/discard', async (req) => uploads.discard(req.body ?? {}));
  app.post('/api/folders', async (req) => uploads.mkdir(req.body ?? {}));
  // { paths } -> what would be deleted, for the confirmation; then the real thing.
  app.post('/api/files/delete/preview', async (req) => sourceFiles.preview(req.body ?? {}));
  app.post('/api/files/delete', async (req) => sourceFiles.remove(req.body ?? {}));
}
