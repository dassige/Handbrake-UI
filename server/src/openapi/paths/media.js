// Docs of mediaRoutes.js (the web app's player). Conventions: ../index.js.

const pathQuery = {
  type: 'object',
  properties: { path: { type: 'string', description: 'Absolute path of a video file in a sources folder or the target folder.' } },
  required: ['path'],
};

export const schemas = [
  {
    $id: 'MediaInfo',
    type: 'object',
    properties: {
      path: { type: 'string' },
      name: { type: 'string' },
      size: { type: 'integer' },
      duration: { type: ['number', 'null'], description: 'Seconds.' },
      video: {
        type: ['object', 'null'],
        properties: { codec: { type: ['string', 'null'] }, width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] }, interlaced: { type: 'boolean' } },
      },
      audio: {
        type: 'array',
        description: 'The audio tracks, in order (the `audio` of the stream counts from 0 in this list).',
        items: { type: 'object', properties: { codec: { type: ['string', 'null'] }, channels: { type: ['integer', 'null'] }, language: { type: ['string', 'null'] }, title: { type: ['string', 'null'] } } },
      },
      direct: { type: 'boolean', description: 'A browser can probably play the file itself (`/api/media/file`); otherwise use `/api/media/stream`.' },
    },
  },
];

export const paths = {
  'GET /api/media/info': {
    operationId: 'getMediaInfo',
    tags: ['Media'],
    summary: 'What a video file contains, for playing it',
    description: 'Read with ffprobe: length, video and audio codecs, audio tracks, and whether a browser can probably play the file directly.',
    querystring: pathQuery,
    response: { 200: { $ref: 'MediaInfo#' }, 422: { description: 'Not a readable video (code unreadable).', $ref: 'Error#' } },
  },
  'GET /api/media/file': {
    operationId: 'getMediaFile',
    tags: ['Media'],
    summary: 'A video file, for playing it directly',
    description: 'The file as it is, shown inline (not as a download), with `Range` support so a player can seek.',
    querystring: pathQuery,
    response: {
      200: { description: 'The file.', content: { 'video/*': { schema: { type: 'string', format: 'binary' } } } },
      206: { description: 'Part of the file (Range).', content: { 'video/*': { schema: { type: 'string', format: 'binary' } } } },
    },
  },
  'GET /api/media/stream': {
    operationId: 'streamMedia',
    tags: ['Media'],
    summary: 'A video converted on the fly, for any browser',
    description: 'ffmpeg converts the file while it is sent: fragmented MP4 with H.264 video (at most 1280 pixels wide, deinterlaced when needed) and stereo AAC audio. It cannot be seeked: to jump, ask again with another `t`. The conversion stops when the client stops reading. At most 3 at a time (429, code tooManyStreams).',
    querystring: {
      type: 'object',
      properties: {
        path: pathQuery.properties.path,
        t: { type: 'string', description: 'Second to start at (decimals allowed); 0 or missing: the start.' },
        audio: { type: 'string', description: 'Audio track, counting from 0 in `audio` of the info; missing: the first.' },
      },
      required: ['path'],
    },
    response: {
      200: { description: 'The stream.', content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } } },
      429: { description: 'Too many streams at once.', $ref: 'Error#' },
    },
  },
};

export const examples = [
  { method: 'GET', url: '/api/media/info?path=%2Fmnt%2Fdownloads%2FFilm.avi' },
  { method: 'GET', url: '/api/media/file?path=%2Fmnt%2Fdownloads%2FFilm.mkv' },
  { method: 'GET', url: '/api/media/stream?path=%2Fmnt%2Fdownloads%2FFilm.avi&t=125.5&audio=1' },
];
