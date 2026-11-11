// Quality check: probes every video in the chosen folders (sub-folders included) and
// flags old formats, low resolutions and low bitrates. The criteria are a setting,
// and the results are evaluated again with the current criteria every time they
// are read, so changing a criterion does not need a new scan.
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, conflict, notFound } from './errors.js';
import { collectVideos, makeFileMatcher, rootOf, resolveUnderAny } from './paths.js';

export const DEFAULT_QUALITY = {
  // ffprobe codec names (codec_name).
  badVideoCodecs: [
    'mpeg1video', 'mpeg2video', 'mpeg4', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'wmv1', 'wmv2', 'wmv3',
    'h263', 'flv1', 'rv10', 'rv20', 'rv30', 'rv40', 'theora', 'vp6', 'vp6f', 'cinepak', 'svq1', 'svq3',
    'indeo3', 'indeo4', 'indeo5',
  ],
  badAudioCodecs: ['wmav1', 'wmav2', 'cook', 'ra_144', 'ra_288', 'sipr', 'atrac3', 'amr_nb', 'amr_wb'],
  // File extensions.
  badContainers: ['avi', 'wmv', 'asf', 'flv', 'mpg', 'mpeg', 'vob', 'rm', 'rmvb', 'divx', '3gp', 'ogm'],
  // Lowest acceptable resolution, as a picture height (720 = 720p). 0 = no check.
  minHeight: 720,
  // Lowest acceptable video bitrate per resolution class, for H.264-class codecs. 0 = no check.
  minKbps: { sd: 700, hd: 1200, fhd: 2500, uhd: 6000 },
  // Codecs that need less bitrate for the same quality, and how much less.
  efficientCodecs: ['hevc', 'av1', 'vp9'],
  efficientFactor: 0.6,
  flagInterlaced: false,
};

export const RESOLUTION_CLASSES = [
  { id: 'sd', label: 'SD (below 720p)' },
  { id: 'hd', label: '720p' },
  { id: 'fhd', label: '1080p' },
  { id: 'uhd', label: '4K' },
];

/** Validates criteria coming from the UI; missing fields take the defaults. */
export function normalizeQuality(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw badRequest('quality must be an object');
  const q = { ...DEFAULT_QUALITY, ...input, minKbps: { ...DEFAULT_QUALITY.minKbps, ...(input.minKbps ?? {}) } };
  const list = (key, ext) => {
    if (!Array.isArray(q[key])) throw badRequest(`quality.${key} must be a list`);
    const clean = (v) => {
      const t = String(v).trim().toLowerCase();
      return ext ? t.replace(/^\./, '') : t;
    };
    return [...new Set(q[key].map(clean).filter(Boolean))];
  };
  const whole = (v, name, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw badRequest(`${name} must be a whole number between 0 and ${max}`);
    return n;
  };
  const out = {
    badVideoCodecs: list('badVideoCodecs'),
    badAudioCodecs: list('badAudioCodecs'),
    badContainers: list('badContainers', true),
    minHeight: whole(q.minHeight, 'Minimum resolution', 4320),
    minKbps: Object.fromEntries(RESOLUTION_CLASSES.map((c) => [c.id, whole(q.minKbps[c.id], `Minimum ${c.label} bitrate`, 200000)])),
    efficientCodecs: list('efficientCodecs'),
    efficientFactor: Number(q.efficientFactor),
    flagInterlaced: q.flagInterlaced,
  };
  if (!Number.isFinite(out.efficientFactor) || out.efficientFactor < 0.1 || out.efficientFactor > 1) {
    throw badRequest('The efficient codec factor must be between 0.1 and 1');
  }
  out.efficientFactor = Math.round(out.efficientFactor * 100) / 100;
  if (typeof out.flagInterlaced !== 'boolean') throw badRequest('quality.flagInterlaced must be true or false');
  return out;
}

// ------------------------------------------------------------------ measuring

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "00:43:36.656000000" -> seconds. */
function tagSeconds(v) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const tag = (s, name) => s?.tags?.[name] ?? s?.tags?.[`${name}-eng`] ?? s?.tags?.[name.toLowerCase()];

/** Bits per second of a stream: its own value, or the statistics tag mkvmerge writes. */
const streamBps = (s) => num(s?.bit_rate) ?? num(tag(s, 'BPS'));

function frameRate(v) {
  for (const r of [v?.avg_frame_rate, v?.r_frame_rate]) {
    const [a, b] = String(r ?? '').split('/').map(Number);
    if (a > 0 && b > 0 && a / b < 400) return Math.round((a / b) * 1000) / 1000;
  }
  return null;
}

/** Everything the check needs, from ffprobe's JSON. Pure, so it is unit tested. */
export function describeMedia(probe, { file, size }) {
  const streams = probe?.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const duration = num(probe?.format?.duration) ?? num(v?.duration) ?? tagSeconds(tag(v, 'DURATION'));
  const info = {
    container: path.extname(file).slice(1).toLowerCase(),
    format: probe?.format?.format_name ?? null,
    duration,
    size,
    audio: audio.map((a) => ({
      codec: a.codec_name ?? 'unknown',
      channels: a.channels ?? null,
      kbps: streamBps(a) ? Math.round(streamBps(a) / 1000) : null,
      language: tag(a, 'language') ?? null,
    })),
    subtitles: streams.filter((s) => s.codec_type === 'subtitle').length,
    video: null,
  };
  if (!v) return info;

  const [sarW, sarH] = String(v.sample_aspect_ratio ?? '').split(':').map(Number);
  const sar = sarW > 0 && sarH > 0 ? sarW / sarH : 1;
  const width = v.width ?? 0;
  const height = v.height ?? 0;
  let bps = streamBps(v);
  let estimated = false;
  if (!bps) {
    // Whole file minus the audio we know about (unknown audio tracks count as 192 kbps).
    const total = num(probe?.format?.bit_rate) ?? (size && duration ? (size * 8) / duration : null);
    if (total) {
      const audioBps = audio.reduce((sum, a) => sum + (streamBps(a) ?? 192_000), 0);
      bps = Math.max(total - audioBps, total * 0.5);
      estimated = true;
    }
  }
  info.video = {
    codec: v.codec_name ?? 'unknown',
    profile: v.profile ?? null,
    width,
    height,
    displayWidth: Math.round(width * sar),
    fps: frameRate(v),
    kbps: bps ? Math.round(bps / 1000) : null,
    kbpsEstimated: estimated,
    interlaced: ['tt', 'bb', 'tb', 'bt'].includes(v.field_order),
    bitDepth: Number(v.bits_per_raw_sample) || Number(/(10|12)(le|be)$/.exec(v.pix_fmt ?? '')?.[1] ?? 8),
  };
  return info;
}

/** Picture height a 16:9 frame of the same width would have, so cropped widescreen keeps its class. */
export function effectiveHeight(video) {
  if (!video) return 0;
  return Math.round(Math.max(video.height, (video.displayWidth * 9) / 16));
}

export function resolutionClass(effHeight) {
  if (effHeight >= 1900) return 'uhd';
  if (effHeight >= 1000) return 'fhd';
  if (effHeight >= 700) return 'hd';
  return 'sd';
}

const classLabel = (id) => RESOLUTION_CLASSES.find((c) => c.id === id)?.label ?? id;

/**
 * Checks one file's description against the criteria. Pure, so it is unit tested.
 * Returns a list of issues: { kind, code, params, text }. kind: error | format | resolution |
 * bitrate | interlaced. text is the English wording (notifications, CSV); the web app shows
 * code + params in the user's language.
 */
export function evaluateQuality(info, criteria) {
  const issue = (kind, code, params, text) => ({ kind, code, params, text });
  if (info.error) return [issue('error', 'cannotRead', { message: info.error }, `Cannot read: ${info.error}`)];
  const issues = [];
  if (criteria.badContainers.includes(info.container)) {
    issues.push(issue('format', 'oldContainer', { container: info.container }, `Old container: .${info.container}`));
  }
  const v = info.video;
  if (!v) {
    issues.push(issue('error', 'noVideo', {}, 'No video track'));
    return issues;
  }
  if (criteria.badVideoCodecs.includes(v.codec)) issues.push(issue('format', 'oldVideoCodec', { codec: v.codec }, `Old video codec: ${v.codec}`));
  const badAudio = [...new Set(info.audio.map((a) => a.codec).filter((c) => criteria.badAudioCodecs.includes(c)))];
  if (badAudio.length) issues.push(issue('format', 'oldAudioCodec', { codecs: badAudio.join(', ') }, `Old audio codec: ${badAudio.join(', ')}`));

  const eff = effectiveHeight(v);
  if (criteria.minHeight && eff < criteria.minHeight * 0.97) {
    issues.push(issue('resolution', 'lowResolution', { width: v.width, height: v.height, minHeight: criteria.minHeight },
      `Low resolution: ${v.width}×${v.height} (below ${criteria.minHeight}p)`));
  }

  const cls = resolutionClass(eff);
  const efficient = criteria.efficientCodecs.includes(v.codec);
  const min = Math.round((criteria.minKbps[cls] ?? 0) * (efficient ? criteria.efficientFactor : 1));
  if (min && v.kbps != null && v.kbps < min) {
    // Four wordings: measured or estimated, for "video" or for an efficient codec by name.
    const code = `lowBitrate${efficient ? 'Codec' : ''}${v.kbpsEstimated ? 'Estimated' : ''}`;
    issues.push(issue('bitrate', code, { kbps: v.kbps, min, resolution: cls, codec: efficient ? v.codec.toUpperCase() : null },
      `Low bitrate: ${v.kbps}${v.kbpsEstimated ? ' (est.)' : ''} kbps, below ${min} kbps for ${classLabel(cls)} ${efficient ? v.codec.toUpperCase() : 'video'}`));
  }
  if (criteria.flagInterlaced && v.interlaced) issues.push(issue('interlaced', 'interlaced', {}, 'Interlaced'));
  return issues;
}

// ------------------------------------------------------------------ scanning

const META_COLUMNS = 'id, status, paths, created_at, finished_at, total, scanned, error';

function rowToScan(r) {
  return {
    id: r.id,
    status: r.status, // running | done | cancelled | failed
    paths: JSON.parse(r.paths),
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    total: r.total,
    scanned: r.scanned,
    error: r.error,
  };
}

const KEEP_SCANS = 20;

export class QualityScanner {
  constructor({ db, settings, verifier, events, queue, log }) {
    this.db = db;
    this.settings = settings;
    this.verifier = verifier;
    this.events = events;
    this.queue = queue;
    this.log = log;
    this.active = null; // { id, cancelled, child, results, scan }
    this.lastEmit = 0;
  }

  /** Roots the check may read: every source folder and the target folder. */
  roots() {
    return [...this.settings.get('sourceRoots'), this.settings.get('targetRoot')];
  }

  /** Scans interrupted by a restart keep what they had found. */
  recover() {
    this.db
      .prepare(`UPDATE quality_scans SET status = 'cancelled', error = 'Interrupted by a restart', finished_at = ? WHERE status = 'running'`)
      .run(Date.now());
  }

  list() {
    return this.db.prepare(`SELECT ${META_COLUMNS} FROM quality_scans ORDER BY id DESC`).all().map((r) => {
      const scan = rowToScan(r);
      if (this.active?.id === scan.id) Object.assign(scan, this.progress());
      return scan;
    });
  }

  /** One scan with its results, checked against the current criteria. */
  get(id) {
    const r = this.db.prepare(`SELECT ${META_COLUMNS}, results FROM quality_scans WHERE id = ?`).get(id);
    if (!r) throw notFound(`Quality check ${id} not found`);
    const scan = rowToScan(r);
    const results = this.active?.id === id ? this.active.results : JSON.parse(r.results ?? '[]');
    if (this.active?.id === id) Object.assign(scan, this.progress());
    const criteria = this.settings.get('quality');
    const sourceRoots = this.settings.get('sourceRoots');
    const inSource = results.filter((f) => rootOf(sourceRoots, f.path)).map((f) => f.path);
    const jobs = this.queue ? this.queue.statusForPaths(inSource) : {};
    const inSourceSet = new Set(inSource);
    scan.results = results.map((f) => ({
      ...f,
      issues: evaluateQuality(f, criteria),
      inSource: inSourceSet.has(f.path),
      job: jobs[f.path] ?? null,
    }));
    scan.flagged = scan.results.filter((f) => f.issues.length).length;
    return scan;
  }

  progress() {
    const a = this.active;
    return { scanned: a.results.length, total: a.total, current: a.current ?? null };
  }

  async start({ paths }) {
    if (this.active) throw conflict('A quality check is already running');
    if (!Array.isArray(paths) || !paths.length) throw badRequest('Choose at least one folder or file');
    const roots = this.roots();
    const matcher = makeFileMatcher(this.settings);
    const targets = [];
    for (const p of paths) targets.push((await resolveUnderAny(roots, p)).path);

    const r = this.db
      .prepare(`INSERT INTO quality_scans (status, paths, created_at, total, scanned) VALUES ('running', ?, ?, 0, 0)`)
      .run(JSON.stringify(targets), Date.now());
    const id = Number(r.lastInsertRowid);
    this.active = { id, cancelled: false, child: null, results: [], total: null, current: 'Listing files…' };
    this.prune();
    this.events.emit('qualityScans');
    this.run(id, targets, matcher).catch((err) => this.log.error(err));
    return { id };
  }

  async run(id, targets, matcher) {
    const a = this.active;
    let status = 'done';
    let error = null;
    try {
      const files = [];
      for (const t of targets) {
        const st = await fs.stat(t);
        if (st.isDirectory()) files.push(...(await collectVideos(t, { recursive: true, matcher })));
        else if (st.isFile()) files.push(t);
      }
      const unique = [...new Set(files)];
      a.total = unique.length;
      this.db.prepare('UPDATE quality_scans SET total = ? WHERE id = ?').run(unique.length, id);
      this.emitProgress(true);

      for (const file of unique) {
        if (a.cancelled) break;
        a.current = file;
        this.emitProgress();
        a.results.push(await this.inspect(file, a));
      }
      if (a.cancelled) status = 'cancelled';
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
    this.db
      .prepare('UPDATE quality_scans SET status = ?, error = ?, finished_at = ?, scanned = ?, results = ? WHERE id = ?')
      .run(status, error, Date.now(), a.results.length, JSON.stringify(a.results), id);
    this.active = null;
    this.events.emit('qualityScans');
    this.events.emit('qualityScan', { id, status });
  }

  async inspect(file, a) {
    const st = await fs.stat(file).catch(() => null);
    const size = st?.size ?? null;
    const mtime = st?.mtimeMs ?? null; // for sorting by date
    try {
      const probe = await this.verifier.probe(file, { nice: this.settings.get('niceLevel'), onChild: (c) => (a.child = c) });
      return { path: file, mtime, ...describeMedia(probe, { file, size }) };
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('ffprobe is not installed');
      return { path: file, size, mtime, container: path.extname(file).slice(1).toLowerCase(), error: err.message };
    } finally {
      a.child = null;
    }
  }

  emitProgress(force) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 500) return;
    this.lastEmit = now;
    this.events.emit('qualityProgress', { id: this.active.id, ...this.progress() });
  }

  cancel(id) {
    if (this.active?.id !== id) throw conflict('This quality check is not running');
    this.active.cancelled = true;
    this.active.child?.kill('SIGTERM');
  }

  remove(id) {
    if (this.active?.id === id) throw conflict('Stop the quality check first');
    this.db.prepare('DELETE FROM quality_scans WHERE id = ?').run(id);
    this.events.emit('qualityScans');
  }

  /** Keeps the newest scans only. */
  prune() {
    this.db
      .prepare(`DELETE FROM quality_scans WHERE status != 'running' AND id NOT IN (SELECT id FROM quality_scans ORDER BY id DESC LIMIT ?)`)
      .run(KEEP_SCANS);
  }
}
