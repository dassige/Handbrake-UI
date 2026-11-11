export function registerDownloadRoutes(app, { downloads }) {
  // GET /api/download?path=<file>: one file, resumable.
  app.get('/api/download', async (req, reply) => downloads.sendFile(req, reply));
  // POST { paths } -> { files: { video: [subtitle paths] }, count }: the subtitle files that go with the videos.
  app.post('/api/download/subtitles', async (req) => downloads.subtitlesFor(req.body?.paths));
  // POST { paths, name?, withSubtitles? } -> { id, name, files, size, subtitles }; then GET /api/download/zip/<id>.
  app.post('/api/download/zip', async (req) => downloads.prepareZip(req.body ?? {}));
  app.get('/api/download/zip/:id', async (req, reply) => downloads.sendZip(req, reply));
}
