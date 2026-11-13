// Playing videos in the browser (the web app's player).
//
// Two ways, the player picks one per file:
// - direct: the file itself, with Range (seeking), for what browsers play natively
//   (H.264/VP8/VP9/AV1, sometimes HEVC, with AAC/MP3/Opus/Vorbis/FLAC audio, in MP4/WebM/MKV);
// - compatible: ffmpeg converts it on the fly to fragmented MP4 (H.264 + stereo AAC, at most
//   1280 pixels wide), from a chosen second and with a chosen audio track. Old formats (AVI,
//   DivX, MPEG-2, WMV…) and AC3/DTS audio need this. The ffmpeg process ends as soon as the
//   player stops reading (pause for long, seek, close), and runs at the CPU priority of conversions.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError, badRequest } from './errors.js';
import { resolveUnderAny } from './paths.js';
import { parseRange } from './download.js';
import { mainVideo, videoLength } from './verify.js';

const DIRECT_CONTAINERS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska' };
const DIRECT_VIDEO = ['h264', 'vp8', 'vp9', 'av1', 'hevc'];
const DIRECT_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
export const MAX_STREAMS = 3;

const extOf = (p) => path.extname(p).slice(1).toLowerCase();

/** What the player needs to know about a file, from ffprobe. */
export function describeForPlayer(probe, file) {
  const v = mainVideo(probe);
  const audio = (probe?.streams ?? []).filter((s) => s.codec_type === 'audio').map((s) => ({
    codec: s.codec_name ?? null,
    channels: s.channels ?? null,
    language: s.tags?.language && s.tags.language !== 'und' ? s.tags.language : null,
    title: s.tags?.title ?? null,
  }));
  const video = v ? { codec: v.codec_name ?? null, width: v.width ?? null, height: v.height ?? null, interlaced: !!v.field_order && !['progressive', 'unknown'].includes(v.field_order) } : null;
  // Whether a browser can probably play the file itself (the player checks HEVC, and falls back anyway).
  const direct = !!DIRECT_CONTAINERS[extOf(file)] && !!video && DIRECT_VIDEO.includes(video.codec)
    && (!audio.length || DIRECT_AUDIO.includes(audio[0].codec));
  return { duration: videoLength(probe) ?? null, video, audio, direct };
}

/** ffmpeg arguments for the compatible stream. */
export function streamArgs(file, { start = 0, audio = 0 } = {}) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', file,
    '-map', '0:v:0', '-map', `0:a:${audio}?`, '-sn', '-dn',
    '-vf', "yadif=deint=interlaced,scale='min(1280,iw)':-2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '50', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  ];
}

export class Media {
  constructor({ settings, verifier, ffmpeg = 'ffmpeg', log, spawnFn = spawn }) {
    Object.assign(this, { settings, verifier, ffmpeg, log, spawnFn });
    this.streams = new Set();
  }

  roots() {
    return [...this.settings.get('sourceRoots'), this.settings.get('targetRoot')];
  }

  async resolveFile(p) {
    const { path: abs } = await resolveUnderAny(this.roots(), p);
    const st = await fs.stat(abs);
    if (!st.isFile()) throw badRequest('Not a file');
    return { abs, st };
  }

  /** GET /api/media/info: codecs, length, audio tracks, and whether to try direct playback. */
  async info(p) {
    const { abs, st } = await this.resolveFile(p);
    const probe = await this.verifier.probe(abs).catch((err) => {
      throw new HttpError(422, `The file cannot be read as a video: ${err.message}`, 'unreadable');
    });
    return { path: abs, name: path.basename(abs), size: st.size, ...describeForPlayer(probe, abs) };
  }

  /** GET /api/media/file: the file itself for the player, with Range (seeking). */
  async sendFile(req, reply) {
    const { abs, st } = await this.resolveFile(req.query.path);
    reply.headers({
      'Content-Type': DIRECT_CONTAINERS[extOf(abs)] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    const range = parseRange(req.headers.range, st.size);
    if (range === 'invalid') {
      reply.code(416).header('Content-Range', `bytes */${st.size}`);
      return reply.send();
    }
    const { start, end } = range ?? { start: 0, end: Math.max(0, st.size - 1) };
    if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${st.size}`);
    reply.header('Content-Length', st.size ? end - start + 1 : 0);
    return reply.send(st.size ? createReadStream(abs, { start, end, highWaterMark: 1 << 20 }) : '');
  }

  /** GET /api/media/stream: the compatible stream, from second t, with audio track a (0 = first). */
  async stream(req, reply) {
    const { abs } = await this.resolveFile(req.query.path);
    const start = Math.max(0, Number(req.query.t) || 0);
    const audio = Math.max(0, Math.floor(Number(req.query.audio) || 0));
    if (this.streams.size >= MAX_STREAMS) {
      throw new HttpError(429, `At most ${MAX_STREAMS} videos can play in compatible mode at the same time`, 'tooManyStreams');
    }
    const args = streamArgs(abs, { start, audio });
    const nice = Number(this.settings.get('niceLevel')) || 0;
    const useNice = process.platform !== 'win32' && nice > 0;
    const child = this.spawnFn(useNice ? 'nice' : this.ffmpeg, useNice ? ['-n', String(nice), this.ffmpeg, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.streams.add(child);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    const stop = () => {
      if (child.exitCode == null && !child.killed) child.kill('SIGKILL');
    };
    child.on('error', (err) => {
      this.log?.warn(`Player: could not start ffmpeg: ${err.message}`);
      child.stdout.destroy(err);
    });
    child.on('close', (code, signal) => {
      this.streams.delete(child);
      if (code && !signal) this.log?.warn(`Player: ffmpeg stopped (${code}) on ${abs}: ${stderr.trim().split('\n').pop() ?? ''}`);
    });
    // The player stopped reading (seek, close, another file): ffmpeg stops too. The response's
    // close, not the request's (that one fires as soon as the request has been read).
    reply.raw.on('close', stop);
    reply.headers({ 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    return reply.send(child.stdout);
  }
}
