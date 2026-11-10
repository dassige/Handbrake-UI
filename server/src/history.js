// One row per finished conversion attempt (done, failed or cancelled after it
// started). Unlike the jobs table it is not emptied by "Clear", so the Stats page
// and the queue finish time keep working after the queue is tidied up.

const DAY = 86_400_000;
// Recent conversions per preset used for the speed estimate.
const SPEED_SAMPLES = 20;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Copies finished jobs into job_history (first start after the table was added). */
export function backfillHistory(db) {
  db.exec(`INSERT INTO job_history (job_id, status, finished_at, preset_name, source_path, output_path, source_size,
      output_size, media_seconds, encode_seconds, avg_fps, verify_status, origin)
    SELECT id, status, finished_at, preset_name, source_path, output_path, source_size, output_size,
      json_extract(source_info, '$.duration'),
      CASE WHEN started_at IS NOT NULL THEN MAX(0, (finished_at - started_at - paused_ms) / 1000.0) END,
      avg_fps, verify_status, origin
    FROM jobs
    WHERE status IN ('done', 'failed', 'cancelled') AND finished_at IS NOT NULL AND started_at IS NOT NULL
    ORDER BY finished_at`);
}

export class History {
  constructor({ db }) {
    this.db = db;
    this.speedCache = null;
  }

  /** Records a job that just finished (row from the jobs table). */
  record(row) {
    if (!row?.started_at || !row.finished_at) return;
    const info = row.source_info ? JSON.parse(row.source_info) : null;
    this.db
      .prepare(`INSERT INTO job_history (job_id, status, finished_at, preset_name, source_path, output_path, source_size,
        output_size, media_seconds, encode_seconds, avg_fps, verify_status, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        row.id, row.status, row.finished_at, row.preset_name, row.source_path, row.output_path, row.source_size ?? null,
        row.output_size ?? null, info?.duration ?? null,
        Math.max(0, (row.finished_at - row.started_at - (row.paused_ms ?? 0)) / 1000), row.avg_fps ?? null,
        row.verify_status ?? null, row.origin ?? null,
      );
    this.speedCache = null;
  }

  /**
   * Seconds of work per second of video (encode plus the check after it), as the
   * median of recent conversions: per preset, and over all presets.
   */
  speeds() {
    if (this.speedCache) return this.speedCache;
    const rows = this.db
      .prepare(`SELECT preset_name AS preset, encode_seconds / media_seconds AS r FROM job_history
        WHERE status = 'done' AND media_seconds > 30 AND encode_seconds > 0 ORDER BY finished_at DESC LIMIT 1000`)
      .all();
    const byPreset = {};
    for (const { preset, r } of rows) {
      const list = (byPreset[preset] ??= []);
      if (list.length < SPEED_SAMPLES) list.push(r);
    }
    this.speedCache = {
      overall: median(rows.slice(0, SPEED_SAMPLES * 2).map((x) => x.r)),
      byPreset: Object.fromEntries(Object.entries(byPreset).map(([k, v]) => [k, median(v)])),
    };
    return this.speedCache;
  }

  /** Totals, per-preset figures and a time series for the last `days` days (0 = everything). */
  stats({ days = 30, now = Date.now() } = {}) {
    const since = days > 0 ? now - days * DAY : 0;
    const rows = this.db
      .prepare(`SELECT status, finished_at, preset_name, source_path, output_path, source_size, output_size, media_seconds,
        encode_seconds, avg_fps, verify_status, origin FROM job_history WHERE finished_at >= ? ORDER BY finished_at`)
      .all(since);
    const first = this.db.prepare('SELECT MIN(finished_at) AS t FROM job_history').get().t;

    const blank = () => ({
      done: 0, failed: 0, cancelled: 0, sourceBytes: 0, outputBytes: 0, savedBytes: 0, mediaSeconds: 0, encodeSeconds: 0,
      fpsSum: 0, fpsCount: 0,
    });
    const add = (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      if (r.status !== 'done') return;
      if (r.source_size && r.output_size) {
        acc.sourceBytes += r.source_size;
        acc.outputBytes += r.output_size;
        acc.savedBytes += r.source_size - r.output_size;
      }
      acc.mediaSeconds += r.media_seconds ?? 0;
      acc.encodeSeconds += r.encode_seconds ?? 0;
      if (r.avg_fps) {
        acc.fpsSum += r.avg_fps;
        acc.fpsCount++;
      }
    };
    const finish = ({ fpsSum, fpsCount, ...acc }) => ({
      ...acc,
      avgFps: fpsCount ? fpsSum / fpsCount : null,
      // How many seconds of video one second of work converts (×real time).
      speed: acc.encodeSeconds > 0 && acc.mediaSeconds > 0 ? acc.mediaSeconds / acc.encodeSeconds : null,
      reduction: acc.sourceBytes > 0 ? 1 - acc.outputBytes / acc.sourceBytes : null,
    });

    const totals = blank();
    const presets = new Map();
    const checks = {};
    let watched = 0;
    for (const r of rows) {
      add(totals, r);
      const name = r.preset_name ?? '(unknown)';
      if (!presets.has(name)) presets.set(name, blank());
      add(presets.get(name), r);
      if (r.status === 'done') {
        const c = r.verify_status ?? 'off';
        checks[c] = (checks[c] ?? 0) + 1;
      }
      if (r.origin === 'watch') watched++;
    }

    // Time series: days for up to ~4 months, months beyond that.
    const span = days > 0 ? days : first ? Math.ceil((now - first) / DAY) : 0;
    const bucket = span > 120 ? 'month' : 'day';
    const keyOf = bucket === 'month' ? monthKey : dayKey;
    const series = new Map();
    const startAt = days > 0 ? since : first ?? now;
    if (bucket === 'day') {
      for (let d = new Date(startAt); d <= new Date(now); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        series.set(dayKey(d), null);
      }
    } else {
      const s = new Date(startAt);
      for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= new Date(now); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        series.set(monthKey(d), null);
      }
    }
    for (const r of rows) {
      const k = keyOf(new Date(r.finished_at));
      const acc = series.get(k) ?? { done: 0, failed: 0, savedBytes: 0, encodeSeconds: 0 };
      if (r.status === 'done') {
        acc.done++;
        if (r.source_size && r.output_size) acc.savedBytes += r.source_size - r.output_size;
        acc.encodeSeconds += r.encode_seconds ?? 0;
      } else if (r.status === 'failed') acc.failed++;
      series.set(k, acc);
    }

    const top = rows
      .filter((r) => r.status === 'done' && r.source_size && r.output_size)
      .map((r) => ({ path: r.source_path, output: r.output_path, sourceSize: r.source_size, outputSize: r.output_size, saved: r.source_size - r.output_size }))
      .sort((a, b) => b.saved - a.saved)
      .slice(0, 5);

    return {
      days,
      since: days > 0 ? since : first,
      firstAt: first,
      totals: finish(totals),
      checks,
      watched,
      presets: [...presets.entries()].map(([name, acc]) => ({ name, ...finish(acc) })).sort((a, b) => b.done - a.done),
      bucket,
      series: [...series.entries()].map(([key, v]) => ({ key, done: 0, failed: 0, savedBytes: 0, encodeSeconds: 0, ...v })),
      top,
    };
  }
}
