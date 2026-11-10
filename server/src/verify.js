// Checks a converted file: readable, video present, real length matching the
// source, every audio track complete, the subtitle tracks HandBrake wrote, and
// (full mode) a complete decode without errors.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

export const VERIFY_MODES = ['full', 'quick', 'off'];

/** Allowed difference between two lengths, in seconds. */
const okDiff = (len) => Math.max(2, len * 0.005);
const warnDiff = (len) => Math.max(10, len * 0.02);

/** Reads what HandBrake planned and found, from its log of the encode. */
export function parseHandBrakeLog(text) {
  const audio = new Set();
  const subtitles = new Set();
  const burned = new Set();
  let decoderErrors = 0;
  let decodedFrames = 0;
  for (const line of text.split('\n')) {
    let m = /\* audio track (\d+)/.exec(line);
    if (m) audio.add(Number(m[1]));
    m = /\* subtitle track (\d+),.*-> (Passthru|Render\/Burn-in)/.exec(line);
    if (m) (m[2] === 'Passthru' ? subtitles : burned).add(Number(m[1]));
    m = /-decoder done: (\d+) frames, (\d+) decoder errors/.exec(line);
    if (m) {
      decodedFrames += Number(m[1]);
      decoderErrors += Number(m[2]);
    }
  }
  return {
    found: audio.size > 0 || decodedFrames > 0,
    audioTracks: audio.size,
    subtitleTracks: subtitles.size,
    burnedSubtitles: burned.size,
    decoderErrors,
  };
}

/** "00:43:36.656000000" -> seconds. */
function tagSeconds(v) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Length of the main video stream from ffprobe JSON (stream, tag, then container). */
/** The main video stream: not a cover picture, which ffprobe also lists as "video" (e.g. a PNG). */
export function mainVideo(probe) {
  return probe?.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? null;
}

/**
 * ffmpeg arguments for the full decode. Only the main video stream is mapped: with "-map 0:v"
 * a cover picture came along, and ffmpeg's reported end time dropped to ~0 (a false "Output is
 * 43:18 shorter than the source: 0:00").
 */
export function decodeArgs(file, videoIndex) {
  const v = Number.isInteger(videoIndex) ? `0:${videoIndex}` : '0:v:0';
  return ['-nostdin', '-v', 'error', '-i', file, '-map', v, '-map', '0:a?', '-fps_mode', 'passthrough', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats'];
}

export function videoLength(probe) {
  const v = mainVideo(probe);
  return num(v?.duration) ?? tagSeconds(v?.tags?.DURATION ?? v?.tags?.duration) ?? num(probe?.format?.duration);
}

export const fmtSec = (s) => {
  if (s == null) return '?';
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const diffText = (d) => (Math.abs(d) < 60 ? `${Math.abs(d).toFixed(1)} s` : fmtSec(Math.abs(d)));

/**
 * Turns the measurements into checks. Pure, so it is unit tested.
 * input: { sourceLength, probe, packets: { [index]: { end, count } }, decode, log }
 */
export function evaluate({ sourceLength, probe, packets, decode, log, sourceLabel = 'source' }) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const streams = probe?.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');

  if (!video) {
    add('video', 'Video', 'error', 'The file has no video stream');
    return finish(checks);
  }
  add('video', 'Video', 'ok', `${video.codec_name} ${video.width}×${video.height}`);

  // Real length: where the video packets actually end (metadata can claim more).
  const videoEnd = packets?.[video.index]?.end ?? null;
  // A decode end of (almost) zero while the packets run for minutes is a measuring problem,
  // not a short file: trust the packets then.
  const rawDecoded = decode?.end ?? null;
  const decodedEnd = rawDecoded != null && videoEnd != null && rawDecoded < 1 && videoEnd > 60 ? null : rawDecoded;
  const outLength = decodedEnd != null && videoEnd != null ? Math.min(decodedEnd, videoEnd) : decodedEnd ?? videoEnd ?? videoLength(probe);
  if (sourceLength == null || outLength == null) {
    add('length', 'Length', 'info', `Output ${fmtSec(outLength)}; the ${sourceLabel} length is unknown`);
  } else {
    const d = outLength - sourceLength;
    const status = Math.abs(d) <= okDiff(sourceLength) ? 'ok' : Math.abs(d) <= warnDiff(sourceLength) ? 'warning' : 'error';
    add('length', `Length matches the ${sourceLabel}`, status,
      status === 'ok'
        ? `${fmtSec(outLength)} (${sourceLabel} ${fmtSec(sourceLength)})`
        : `Output is ${diffText(d)} ${d < 0 ? 'shorter' : 'longer'} than the ${sourceLabel}: ${fmtSec(outLength)} vs ${fmtSec(sourceLength)}`);
  }

  // Audio tracks: how many HandBrake meant to write, and each one complete.
  if (log?.found) {
    add('audioCount', 'Audio tracks', audio.length === log.audioTracks ? 'ok' : 'error',
      audio.length === log.audioTracks
        ? `${audio.length} (${audio.map((a) => a.tags?.language ?? '?').join(', ') || 'none'})`
        : `HandBrake wrote ${log.audioTracks}, the file has ${audio.length}`);
  } else {
    add('audioCount', 'Audio tracks', audio.length ? 'info' : 'warning', `${audio.length} (no HandBrake log to compare with)`);
  }
  const ref = videoEnd ?? outLength;
  const short = [];
  for (const [i, a] of audio.entries()) {
    const p = packets?.[a.index];
    if (!p || !p.count) short.push(`track ${i + 1} is empty`);
    else if (ref != null && ref - p.end > okDiff(ref)) short.push(`track ${i + 1} (${a.tags?.language ?? '?'}) ends ${diffText(ref - p.end)} early`);
  }
  if (audio.length) add('audioLength', 'Audio length', short.length ? 'error' : 'ok', short.length ? short.join('; ') : 'Every track lasts as long as the video');

  // Subtitles: tracks passed through by HandBrake (burned-in ones are part of the picture).
  const subDetail = subs.map((s) => `${s.tags?.language ?? '?'} ${s.codec_name}${packets?.[s.index]?.count === 0 ? ' (no lines)' : ''}`).join(', ');
  if (log?.found) {
    const burned = log.burnedSubtitles ? `; ${log.burnedSubtitles} burned into the picture` : '';
    if (subs.length === log.subtitleTracks) add('subtitles', 'Subtitle tracks', 'ok', `${subs.length}${subs.length ? `: ${subDetail}` : ''}${burned}`);
    else add('subtitles', 'Subtitle tracks', subs.length < log.subtitleTracks ? 'warning' : 'info', `HandBrake wrote ${log.subtitleTracks}, the file has ${subs.length}${burned}`);
  } else if (subs.length) {
    add('subtitles', 'Subtitle tracks', 'info', `${subs.length}: ${subDetail}`);
  }

  // Full decode.
  if (decode) {
    if (decode.failed) add('decode', 'Full decode', 'error', decode.failed);
    else if (decode.errors.length === 0) add('decode', 'Full decode', 'ok', 'Every video and audio frame decodes without errors');
    else {
      const status = decode.errors.length > 10 ? 'error' : 'warning';
      add('decode', 'Full decode', status, `${decode.errors.length} decoding error${decode.errors.length > 1 ? 's' : ''}, e.g. ${decode.errors[0]}`);
    }
  }

  if (log?.decoderErrors) {
    add('sourceErrors', 'Source', 'warning', `HandBrake found ${log.decoderErrors} decoding error${log.decoderErrors > 1 ? 's' : ''} in the source; the damage may be visible in the output too`);
  }
  return finish(checks);
}

function finish(checks) {
  const status = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warning') ? 'warning' : 'ok';
  return { status, checks };
}

// ------------------------------------------------------------------ running the tools

function run(cmd, args, { nice = 0, onChild, onStdout, maxStdout = 64 << 20 } = {}) {
  return new Promise((resolve, reject) => {
    const useNice = process.platform !== 'win32' && nice > 0;
    const child = spawn(useNice ? 'nice' : cmd, useNice ? ['-n', String(nice), cmd, ...args] : args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onChild?.(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => {
      if (onStdout) onStdout(d);
      else if (stdout.length < maxStdout) stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d) => {
      if (stderr.length < 1 << 20) stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

export class Verifier {
  constructor({ ffprobe = 'ffprobe', ffmpeg = 'ffmpeg' } = {}) {
    this.ffprobe = ffprobe;
    this.ffmpeg = ffmpeg;
  }

  async probe(file, opts) {
    const r = await run(this.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], opts);
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `ffprobe exited with code ${r.code}`);
    return JSON.parse(r.stdout);
  }

  /** Reads every packet (no decoding): where each stream really ends, and how many packets it has. */
  async packets(file, opts) {
    const out = {};
    let rest = '';
    const take = (line) => {
      const [idx, pts, dur] = line.split(',');
      if (idx === '' || idx == null) return;
      const p = (out[idx] ??= { end: 0, count: 0 });
      p.count++;
      const end = Number(pts) + (Number(dur) || 0);
      if (Number.isFinite(end) && end > p.end) p.end = end;
    };
    const r = await run(
      this.ffprobe,
      ['-v', 'error', '-show_entries', 'packet=stream_index,pts_time,duration_time', '-of', 'csv=p=0', file],
      {
        ...opts,
        onStdout: (d) => {
          const lines = (rest + d).split('\n');
          rest = lines.pop();
          for (const l of lines) take(l.trim());
        },
      },
    );
    if (rest.trim()) take(rest.trim());
    if (r.code !== 0 && !Object.keys(out).length) throw new Error(r.stderr.trim().split('\n').pop() || 'Cannot read the packets');
    return out;
  }

  /** Decodes every video and audio frame; returns { end, errors[] } or { failed }. */
  async decode(file, length, { onProgress, videoIndex, ...opts }) {
    let end = null;
    let rest = '';
    const r = await run(
      this.ffmpeg,
      decodeArgs(file, videoIndex),
      {
        ...opts,
        onStdout: (d) => {
          const lines = (rest + d).split('\n');
          rest = lines.pop();
          for (const l of lines) {
            const m = /^out_time_us=(\d+)/.exec(l);
            if (m) {
              end = Number(m[1]) / 1e6;
              if (length) onProgress?.(Math.min(1, end / length));
            }
          }
        },
      },
    );
    if (r.signal) return { failed: `Stopped (${r.signal})`, end, errors: [] };
    // "[null @ …]" lines are timestamp complaints of the null output, not decoding errors.
    const errors = r.stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^\[null @/.test(l));
    if (r.code !== 0) return { failed: errors.at(-1) ?? `ffmpeg exited with code ${r.code}`, end, errors };
    return { end, errors };
  }

  /**
   * Checks output against source. mode: 'full' | 'quick'.
   * Returns { status, mode, checks, checkedAt, tookMs } — status 'skipped' when stopped.
   */
  async verify({
    output, source, sourceLength: givenLength, logFile, expected, mode = 'full', nice = 0, onProgress, onChild,
    isStopped = () => false, sourceLabel,
  }) {
    const started = Date.now();
    const opts = { nice, onChild };
    const done = (r) => ({ ...r, mode, checkedAt: Date.now(), tookMs: Date.now() - started });
    try {
      let probe;
      try {
        probe = await this.probe(output, opts);
      } catch (err) {
        if (err.code === 'ENOENT') return done({ status: 'skipped', checks: [], note: 'ffprobe is not installed' });
        return done({ status: 'error', checks: [{ id: 'readable', label: 'Readable', status: 'error', detail: `Cannot read the file: ${err.message}` }] });
      }
      const sourceProbe = source ? await this.probe(source, opts).catch(() => null) : null;
      const sourceLength = givenLength ?? videoLength(sourceProbe);
      // expected: track counts given by the caller (e.g. a merge), instead of a HandBrake log.
      const log = expected ?? (logFile ? parseHandBrakeLog(await fs.readFile(logFile, 'utf8').catch(() => '')) : null);
      onProgress?.(0.02);
      const packets = await this.packets(output, opts);
      if (isStopped()) return done({ status: 'skipped', checks: [], note: 'Check stopped' });
      onProgress?.(mode === 'full' ? 0.08 : 1);
      let decode = null;
      if (mode === 'full') {
        const len = videoLength(probe);
        decode = await this.decode(output, len, {
          ...opts,
          videoIndex: mainVideo(probe)?.index,
          onProgress: (p) => onProgress?.(0.08 + p * 0.92),
        });
        if (isStopped()) return done({ status: 'skipped', checks: [], note: 'Check stopped' });
      }
      const result = evaluate({ sourceLength, probe, packets, decode, log, sourceLabel });
      return done({ ...result, checks: [{ id: 'readable', label: 'Readable', status: 'ok', detail: probe.format?.format_long_name ?? 'yes' }, ...result.checks] });
    } catch (err) {
      if (err.code === 'ENOENT') return done({ status: 'skipped', checks: [], note: 'ffmpeg/ffprobe are not installed' });
      return done({ status: 'error', checks: [{ id: 'internal', label: 'Check', status: 'error', detail: err.message }] });
    }
  }
}
