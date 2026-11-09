import path from 'node:path';

const env = process.env;

/** Process-level configuration (environment). User-facing options live in settings.js. */
export const config = {
  port: Number(env.PORT || 8095),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  handbrakeCli: env.HANDBRAKE_CLI || 'HandBrakeCLI',
  ffprobe: env.FFPROBE || 'ffprobe',
  ffmpeg: env.FFMPEG || 'ffmpeg',
  mkvmerge: env.MKVMERGE || 'mkvmerge',
  // Only used to seed the settings the first time the app starts.
  initialSourceRoot: env.SOURCE_ROOT || '/mnt/downloads',
  initialTargetRoot: env.TARGET_ROOT || '/mnt/converted',
  webDir: path.resolve(env.WEB_DIR || path.join(import.meta.dirname, '../../web/dist')),
  logLevel: env.LOG_LEVEL || 'info',
};
