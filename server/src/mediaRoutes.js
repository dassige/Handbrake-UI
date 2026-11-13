/** The web app's player (media.js): what a file is, the file itself, or a compatible stream of it. */
export function registerMediaRoutes(app, { media }) {
  app.get('/api/media/info', async (req) => media.info(req.query.path));
  app.get('/api/media/file', async (req, reply) => media.sendFile(req, reply));
  // Query: path, t (second to start at), audio (audio track, 0 = first).
  app.get('/api/media/stream', async (req, reply) => media.stream(req, reply));
}
