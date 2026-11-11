import fs from 'node:fs/promises';
import path from 'node:path';
import { tx } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';
import {
  collectVideos, extensionForFormat, isInside, makeFileMatcher, plannedOutputPath,
  resolveUnderAny, uniquePath,
} from './paths.js';
import { inWindow, nextWindowStart, windowEnd } from './schedule.js';

const ACTIVE = ['running', 'paused'];
const FINISHED = ['done', 'failed', 'cancelled'];
const LIST_COLUMNS = `id, status, phase, position, source_path, output_path, preset_id, preset_name,
  format, created_at, started_at, finished_at, paused_ms, progress, fps, avg_fps, eta, pass,
  pass_count, source_size, output_size, source_info, scan_error, exit_code, error, attempts, rename_note, verify, verify_status, origin`;

// Pause/resume send SIGSTOP/SIGCONT. Windows has no such signals: Node would
// terminate HandBrakeCLI instead, so pausing is turned off there.
const CAN_PAUSE = process.platform !== 'win32';

function rowToJob(r) {
  if (!r) return r;
  return {
    id: r.id,
    status: r.status,
    phase: r.phase,
    position: r.position,
    sourcePath: r.source_path,
    outputPath: r.output_path,
    presetId: r.preset_id,
    presetName: r.preset_name,
    format: r.format,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    pausedMs: r.paused_ms,
    progress: r.progress,
    fps: r.fps,
    avgFps: r.avg_fps,
    eta: r.eta,
    pass: r.pass,
    passCount: r.pass_count,
    sourceSize: r.source_size,
    outputSize: r.output_size,
    sourceInfo: r.source_info ? JSON.parse(r.source_info) : null,
    scanError: r.scan_error,
    exitCode: r.exit_code,
    error: r.error,
    attempts: r.attempts,
    renameNote: r.rename_note,
    verifyStatus: r.verify_status,
    verify: r.verify ? JSON.parse(r.verify) : null,
    origin: r.origin ?? null,
  };
}

export class Queue {
  constructor({ db, settings, presets, handbrake, verifier, events, dataDir, log, history = null, notifier = null }) {
    this.db = db;
    this.settings = settings;
    this.presets = presets;
    this.hb = handbrake;
    this.verifier = verifier;
    this.manualChecks = Promise.resolve();
    this.events = events;
    this.log = log;
    this.logDir = path.join(dataDir, 'logs');
    this.tmpDir = path.join(dataDir, 'tmp');
    this.active = null; // { id, child, partPath, finalPath, presetFile, cancelled, pausedAt }
    this.scanQueue = [];
    this.scanning = false;
    this.lastEmit = 0;
    this.lastSave = 0;
    this.history = history;
    this.notifier = notifier;
    // Start pressed with "Start now" outside the conversion window: ignore the window until the queue stops.
    this.scheduleOverride = false;
    // Jobs started since Start was pressed, for the "queue finished" notification.
    this.run = null;
    this.lastInWindow = null;
  }

  // ---------------------------------------------------------------- startup

  /** Jobs interrupted by a restart go back to the queue; their partial files are removed. */
  async recover() {
    const stale = this.db
      .prepare(`SELECT id, output_path, phase FROM jobs WHERE status IN ('running', 'paused')`)
      .all();
    for (const j of stale.filter((x) => x.phase === 'verifying')) {
      // The encode had finished; only the check was interrupted.
      const size = await fs.stat(j.output_path).then((st) => st.size, () => null);
      if (size == null) continue;
      this.db
        .prepare(`UPDATE jobs SET status = 'done', phase = NULL, progress = 1, eta = 0, fps = NULL, output_size = ?,
          finished_at = COALESCE(finished_at, ?), verify_status = 'skipped', verify = ? WHERE id = ?`)
        .run(size, Date.now(), JSON.stringify({ status: 'skipped', checks: [], note: 'Check interrupted by a restart', noteCode: 'interrupted' }), j.id);
      j.recovered = true;
    }
    for (const j of stale.filter((x) => !x.recovered)) {
      await fs.rm(j.output_path + '.part', { force: true }).catch(() => {});
      this.db
        .prepare(`UPDATE jobs SET status = 'queued', phase = NULL, progress = 0, fps = NULL, eta = NULL,
          started_at = NULL, paused_ms = 0, error = 'Interrupted by a restart; queued again' WHERE id = ?`)
        .run(j.id);
    }
    if (stale.length) this.log.info(`Recovered ${stale.length} interrupted job(s)`);
    this.db.prepare(`UPDATE jobs SET verify_status = 'skipped' WHERE verify_status = 'running'`).run();
    for (const r of this.db.prepare(`SELECT id FROM jobs WHERE source_info IS NULL AND scan_error IS NULL`).all()) {
      this.scanQueue.push(r.id);
    }
    this.runScans();
    this.tick();
  }

  // ---------------------------------------------------------------- reads

  list() {
    return this.db
      .prepare(`SELECT ${LIST_COLUMNS} FROM jobs ORDER BY
        CASE WHEN status IN ('running','paused') THEN 0 WHEN status = 'queued' THEN 1 ELSE 2 END,
        CASE WHEN status = 'queued' THEN position END,
        COALESCE(finished_at, created_at) DESC`)
      .all()
      .map(rowToJob);
  }

  get(id) {
    const job = rowToJob(this.db.prepare(`SELECT ${LIST_COLUMNS} FROM jobs WHERE id = ?`).get(id));
    if (!job) throw notFound(`Job ${id} not found`);
    return job;
  }

  state() {
    const counts = Object.fromEntries(
      this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map((r) => [r.status, r.n]),
    );
    const schedule = this.settings.get('schedule');
    const now = new Date();
    const open = inWindow(schedule, now);
    const running = this.settings.get('queueRunning');
    return {
      running,
      activeJobId: this.active?.id ?? null,
      // The active job was started alone with "Convert now"; the queue stays stopped after it.
      activeSingle: !!this.active?.single,
      canPause: CAN_PAUSE,
      counts,
      schedule: {
        enabled: !!schedule?.enabled,
        open,
        override: this.scheduleOverride,
        // Started, but holding the next job until the window opens.
        waiting: running && !this.active && !open && !this.scheduleOverride && (counts.queued ?? 0) > 0,
        nextStart: schedule?.enabled && !open ? nextWindowStart(schedule, now)?.getTime() ?? null : null,
        closesAt: schedule?.enabled && open ? windowEnd(schedule, now)?.getTime() ?? null : null,
      },
      // Seconds of work per second of video, from recent conversions (for the finish time).
      speeds: this.history?.speeds() ?? null,
    };
  }

  /** True when the queue may start a new job now (conversion window). */
  mayStartNow() {
    return this.scheduleOverride || inWindow(this.settings.get('schedule'));
  }

  /**
   * Called every 30 s: starts the queue when the window opens (setting "autoStart")
   * and wakes a queue that was waiting for it.
   */
  scheduleTick() {
    const schedule = this.settings.get('schedule');
    const open = inWindow(schedule);
    const opened = this.lastInWindow === false && open;
    const changed = this.lastInWindow !== null && this.lastInWindow !== open;
    this.lastInWindow = open;
    if (!schedule?.enabled) return;
    if (opened && schedule.autoStart && !this.settings.get('queueRunning')) {
      const queued = this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'`).get().n;
      if (queued) {
        this.log.info(`Conversion window opened: starting the queue (${queued} job(s))`);
        this.setRunning(true);
        return;
      }
    }
    if (changed) {
      this.events.emit('queue', this.state());
      this.tick();
    }
  }

  /** The schedule was edited: a window that is open now does not count as "just opened". */
  scheduleChanged() {
    this.lastInWindow = inWindow(this.settings.get('schedule'));
    this.events.emit('queue', this.state());
    this.tick();
  }

  /** Latest job status per source path, for the file browser badges. */
  statusForPaths(paths) {
    if (!paths.length) return {};
    const stmt = this.db.prepare(
      `SELECT status FROM jobs WHERE source_path = ? ORDER BY
        CASE WHEN status IN ('running','paused') THEN 0 WHEN status = 'queued' THEN 1 WHEN status = 'done' THEN 2 ELSE 3 END,
        id DESC LIMIT 1`,
    );
    const out = {};
    for (const p of paths) {
      const r = stmt.get(p);
      if (r) out[p] = r.status;
    }
    return out;
  }

  /** Per-folder job counts by status, for the file browser badges. */
  statusForDirs(dirs) {
    const stmt = this.db.prepare(
      `SELECT status, COUNT(DISTINCT source_path) AS n FROM jobs WHERE substr(source_path, 1, ?) = ? GROUP BY status`,
    );
    const out = {};
    for (const d of dirs) {
      const prefix = d.endsWith(path.sep) ? d : d + path.sep;
      const rows = stmt.all(prefix.length, prefix);
      if (rows.length) out[d] = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    }
    return out;
  }

  /** Queued, converting or paused jobs whose source is p or somewhere under it. */
  pendingSourcesUnder(p) {
    const prefix = p.endsWith(path.sep) ? p : p + path.sep;
    return this.db
      .prepare(`SELECT DISTINCT source_path AS path, status FROM jobs
        WHERE status IN ('queued', 'running', 'paused') AND (source_path = ? OR substr(source_path, 1, ?) = ?)`)
      .all(p, prefix.length, prefix);
  }

  // ---------------------------------------------------------------- adding

  /**
   * Adds files and folders (absolute paths under a source root).
   * Returns { added: [ids], skipped: [{ path, code, reason }] } (reason: English, code: for the web app).
   */
  async add({ paths, presetId, position = 'end', origin = null }) {
    if (!Array.isArray(paths) || !paths.length) throw badRequest('Nothing to add');
    const sourceRoots = this.settings.get('sourceRoots');
    const preset = this.presets.resolve(presetId);
    const format = preset.summary.format;
    const matcher = makeFileMatcher(this.settings);

    const files = [];
    const skipped = [];
    for (const p of paths) {
      const { path: abs } = await resolveUnderAny(sourceRoots, p);
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        const found = await collectVideos(abs, { recursive: this.settings.get('recursive'), matcher });
        if (!found.length) skipped.push({ path: abs, code: 'noVideoInFolder', reason: 'no video files in folder' });
        files.push(...found);
      } else if (matcher.isVideo(abs)) {
        files.push(abs);
      } else {
        skipped.push({ path: abs, code: 'notVideo', reason: 'not a video file' });
      }
    }

    const unique = [...new Set(files)];
    const statuses = this.statusForPaths(unique);
    const toAdd = [];
    for (const f of unique) {
      const s = statuses[f];
      if (s === 'queued' || ACTIVE.includes(s)) skipped.push({ path: f, code: 'alreadyQueued', reason: 'already in the queue' });
      else if (s === 'done' && this.settings.get('skipConverted')) skipped.push({ path: f, code: 'alreadyConverted', reason: 'already converted' });
      else toAdd.push(f);
    }

    const sizes = await Promise.all(toAdd.map((f) => fs.stat(f).then((s) => s.size, () => null)));
    const ids = tx(this.db, () => {
      let pos = this.nextPosition(position, toAdd.length);
      const insert = this.db.prepare(
        `INSERT INTO jobs (status, position, source_path, output_path, preset_id, preset_name, preset_json,
          format, created_at, source_size, origin) VALUES ('queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      return toAdd.map((f, i) => {
        const r = insert.run(
          pos++, f, plannedOutputPath(f, this.settings, format), preset.id, preset.name, preset.json,
          format, Date.now(), sizes[i], origin,
        );
        return Number(r.lastInsertRowid);
      });
    });

    this.scanQueue.push(...ids);
    this.runScans();
    this.events.emit('jobs');
    this.tick();
    return { added: ids, skipped };
  }

  /** Queue position for new jobs: after the last one, or before the first. */
  nextPosition(where, count) {
    if (where === 'next') {
      const r = this.db.prepare(`SELECT MIN(position) AS p FROM jobs WHERE status = 'queued'`).get();
      return (r.p ?? 0) - count - 1;
    }
    const r = this.db.prepare('SELECT MAX(position) AS p FROM jobs').get();
    return (r.p ?? 0) + 1;
  }

  /** Background scans of new jobs' sources (one at a time, low priority). */
  async runScans() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      while (this.scanQueue.length) {
        const id = this.scanQueue.shift();
        const row = this.db.prepare('SELECT source_path FROM jobs WHERE id = ?').get(id);
        if (!row) continue;
        try {
          const info = await this.hb.scan(row.source_path);
          this.db.prepare('UPDATE jobs SET source_info = ?, scan_error = NULL WHERE id = ?').run(JSON.stringify(info), id);
        } catch (err) {
          this.db.prepare('UPDATE jobs SET scan_error = ? WHERE id = ?').run(err.message, id);
        }
        this.emitJob(id);
      }
    } finally {
      this.scanning = false;
    }
  }

  // ---------------------------------------------------------------- editing

  /** Changes preset and/or output path of a queued job. */
  async update(id, { presetId, outputPath }) {
    const job = this.get(id);
    if (job.status !== 'queued') throw conflict('Only queued jobs can be edited');
    if (presetId != null && presetId !== job.presetId) {
      const preset = this.presets.get(presetId);
      const format = preset.summary.format;
      const out = job.outputPath.slice(0, -path.extname(job.outputPath).length) + extensionForFormat(format);
      this.db
        .prepare('UPDATE jobs SET preset_id = ?, preset_name = ?, preset_json = ?, format = ?, output_path = ? WHERE id = ?')
        .run(preset.id, preset.name, preset.json, format, out, id);
    }
    if (outputPath != null) {
      const targetRoot = this.settings.get('targetRoot');
      const abs = path.resolve(outputPath);
      if (!isInside(targetRoot, abs) || abs === path.resolve(targetRoot)) {
        throw badRequest(`The output must be a file inside ${targetRoot}`);
      }
      const format = this.db.prepare('SELECT format FROM jobs WHERE id = ?').get(id).format;
      const ext = extensionForFormat(format);
      const fixed = path.extname(abs).toLowerCase() === ext ? abs : abs + ext;
      this.db.prepare('UPDATE jobs SET output_path = ? WHERE id = ?').run(fixed, id);
    }
    this.emitJob(id);
    return this.get(id);
  }

  /** Sets the order of queued jobs. ids lists queued jobs in the wanted order. */
  reorder(ids) {
    if (!Array.isArray(ids)) throw badRequest('ids must be a list');
    const queued = this.db.prepare(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY position`).all().map((r) => r.id);
    const wanted = ids.map(Number).filter((id) => queued.includes(id));
    const rest = queued.filter((id) => !wanted.includes(id));
    tx(this.db, () => {
      const stmt = this.db.prepare('UPDATE jobs SET position = ? WHERE id = ?');
      [...wanted, ...rest].forEach((id, i) => stmt.run(i + 1, id));
    });
    this.events.emit('jobs');
  }

  move(id, where) {
    const queued = this.db.prepare(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY position`).all().map((r) => r.id);
    const i = queued.indexOf(id);
    if (i < 0) throw conflict('Only queued jobs can be moved');
    queued.splice(i, 1);
    const at = { top: 0, bottom: queued.length, up: Math.max(0, i - 1), down: Math.min(queued.length, i + 1) }[where];
    if (at === undefined) throw badRequest('where must be top, bottom, up or down');
    queued.splice(at, 0, id);
    this.reorder(queued);
  }

  /** Puts a finished job back in the queue (same job, same preset). */
  retry(id) {
    const job = this.get(id);
    if (!FINISHED.includes(job.status)) throw conflict('Only finished jobs can be retried');
    this.db
      .prepare(`UPDATE jobs SET status = 'queued', phase = NULL, position = ?, progress = 0, fps = NULL,
        avg_fps = NULL, eta = NULL, pass = NULL, pass_count = NULL, started_at = NULL, finished_at = NULL,
        paused_ms = 0, output_size = NULL, exit_code = NULL, error = NULL, verify = NULL, verify_status = NULL,
        output_path = ? WHERE id = ?`)
      .run(this.nextPosition('end', 1), plannedOutputPath(job.sourcePath, this.settings, job.format), id);
    this.emitJob(id);
    this.tick();
  }

  /** Creates a new job for the same source, optionally with another preset. */
  async convertAgain(id, { presetId, position } = {}) {
    const job = this.get(id);
    const preset = presetId != null ? this.presets.get(presetId) : null;
    const presetJson = preset ? preset.json : this.db.prepare('SELECT preset_json FROM jobs WHERE id = ?').get(id).preset_json;
    const format = preset ? preset.summary.format : job.format;
    const size = await fs.stat(job.sourcePath).then((s) => s.size, () => null);
    const r = this.db
      .prepare(`INSERT INTO jobs (status, position, source_path, output_path, preset_id, preset_name, preset_json,
        format, created_at, source_size, source_info) VALUES ('queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        this.nextPosition(position, 1), job.sourcePath, plannedOutputPath(job.sourcePath, this.settings, format),
        preset ? preset.id : job.presetId, preset ? preset.name : job.presetName, presetJson, format, Date.now(),
        size, job.sourceInfo ? JSON.stringify(job.sourceInfo) : null,
      );
    const newId = Number(r.lastInsertRowid);
    if (!job.sourceInfo) {
      this.scanQueue.push(newId);
      this.runScans();
    }
    this.events.emit('jobs');
    this.tick();
    return newId;
  }

  async remove(ids) {
    for (const id of ids) {
      const job = this.get(id);
      if (ACTIVE.includes(job.status)) throw conflict(`Job ${id} is running; cancel it first`);
    }
    for (const id of ids) {
      this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
      await fs.rm(this.logFile(id), { force: true });
    }
    this.events.emit('jobs');
  }

  async clearFinished(statuses = FINISHED) {
    const wanted = statuses.filter((s) => FINISHED.includes(s));
    if (!wanted.length) return 0;
    const ids = this.db
      .prepare(`SELECT id FROM jobs WHERE status IN (${wanted.map(() => '?').join(',')})`)
      .all(...wanted)
      .map((r) => r.id);
    await this.remove(ids);
    return ids.length;
  }

  // ---------------------------------------------------------------- queue control

  /** Starts or stops the queue. `now` ignores the conversion window until the queue stops. */
  setRunning(running, { now = false } = {}) {
    const wasRunning = this.settings.get('queueRunning');
    if (running && !wasRunning) this.run = null;
    this.scheduleOverride = !!running && (now || (this.scheduleOverride && wasRunning));
    this.settings.set('queueRunning', !!running);
    this.events.emit('queue', this.state());
    this.tick();
  }

  /**
   * "Convert now": encodes one queued job while the queue is stopped and idle, ignoring the
   * conversion window. The queue stays stopped afterwards (Start still runs the rest).
   */
  async convertNow(id) {
    const job = this.get(id);
    if (job.status !== 'queued') throw conflict('Only queued jobs can be converted now');
    if (this.settings.get('queueRunning')) throw conflict('The queue is running; move the job to the top instead');
    if (this.active || this.starting) throw conflict('Another conversion is running; wait for it to finish');
    this.starting = true;
    try {
      await this.start(id, { single: true });
    } finally {
      this.starting = false;
    }
  }

  pause(id) {
    const a = this.requireActive(id);
    if (!CAN_PAUSE) throw conflict('Pausing a conversion is not supported on Windows; cancel it instead');
    if (a.pausedAt) return;
    a.child.kill('SIGSTOP');
    a.pausedAt = Date.now();
    this.db.prepare(`UPDATE jobs SET status = 'paused', fps = NULL WHERE id = ?`).run(id);
    this.emitJob(id);
  }

  resume(id) {
    const a = this.requireActive(id);
    if (!a.pausedAt) return;
    a.child.kill('SIGCONT');
    const pausedFor = Date.now() - a.pausedAt;
    a.pausedAt = null;
    this.db.prepare(`UPDATE jobs SET status = 'running', paused_ms = paused_ms + ? WHERE id = ?`).run(pausedFor, id);
    this.emitJob(id);
  }

  cancel(id) {
    const job = this.get(id);
    if (job.status === 'queued') {
      this.db.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(Date.now(), id);
      this.emitJob(id);
      return;
    }
    const a = this.requireActive(id);
    a.cancelled = true;
    if (a.pausedAt) a.child.kill('SIGCONT');
    a.child.kill('SIGINT');
    setTimeout(() => {
      if (this.active === a) a.child.kill('SIGKILL');
    }, 15_000).unref();
  }

  requireActive(id) {
    if (!this.active || this.active.id !== id) throw conflict(`Job ${id} is not running`);
    return this.active;
  }

  /** Stops the current encode (used on shutdown). */
  async shutdown() {
    const a = this.active;
    if (!a) return;
    a.shuttingDown = true;
    if (a.pausedAt) a.child.kill('SIGCONT');
    a.child.kill('SIGINT');
    await Promise.race([a.exited, new Promise((r) => setTimeout(r, 10_000))]);
  }

  // ---------------------------------------------------------------- worker

  logFile(id) {
    return path.join(this.logDir, `job-${id}.log`);
  }

  tick() {
    if (this.active || this.starting || !this.settings.get('queueRunning')) return;
    const next = this.db.prepare(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY position LIMIT 1`).get();
    if (!next) {
      // Nothing left: stop, so files added later wait for a manual Start.
      this.settings.set('queueRunning', false);
      this.scheduleOverride = false;
      const finished = this.ranSinceStart === true;
      this.events.emit('queue', { ...this.state(), finished });
      this.ranSinceStart = false;
      if (finished) this.notifyRunFinished();
      return;
    }
    // Outside the conversion window the next job waits (a running one was allowed to finish).
    if (!this.mayStartNow()) return;
    this.starting = true;
    this.start(next.id)
      .catch((err) => this.log.error(err, `Job ${next.id} failed to start`))
      .finally(() => {
        this.starting = false;
        if (!this.active) setImmediate(() => this.tick());
      });
  }

  /** Starts one job. single: started with "Convert now", so not part of a queue run. */
  async start(id, { single = false } = {}) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    const countInRun = () => {
      if (single) return;
      this.ranSinceStart = true;
      this.run ??= { startedAt: Date.now(), ids: [] };
      this.run.ids.push(id);
    };
    const fail = (msg) => {
      this.db
        .prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, attempts = attempts + 1 WHERE id = ?`)
        .run(msg, Date.now(), id);
      this.emitJob(id);
      countInRun();
      this.notifier?.notify('jobFailed', this.get(id));
    };

    const sourceStat = await fs.stat(row.source_path).catch(() => null);
    if (!sourceStat?.isFile()) return fail(`Source file not found: ${row.source_path}`);

    let finalPath;
    try {
      await fs.mkdir(path.dirname(row.output_path), { recursive: true });
      finalPath = await uniquePath(row.output_path);
    } catch (err) {
      return fail(`Cannot prepare the output folder: ${err.message}`);
    }
    const partPath = finalPath + '.part';
    const presetFile = path.join(this.tmpDir, `job-${id}-preset.json`);
    await fs.writeFile(presetFile, row.preset_json);
    const presetName = JSON.parse(row.preset_json).PresetList[0].PresetName;
    await fs.rm(this.logFile(id), { force: true });

    this.db
      .prepare(`UPDATE jobs SET status = 'running', phase = 'scanning', output_path = ?, started_at = ?,
        finished_at = NULL, paused_ms = 0, progress = 0, fps = NULL, avg_fps = NULL, eta = NULL, error = NULL,
        exit_code = NULL, output_size = NULL, source_size = ?, rename_note = NULL, verify = NULL, verify_status = NULL,
        attempts = attempts + 1 WHERE id = ?`)
      .run(finalPath, Date.now(), sourceStat.size, id);

    const active = { id, partPath, finalPath, presetFile, source: row.source_path, cancelled: false, pausedAt: null, single };
    active.exited = new Promise((resolve) => {
      active.child = this.hb.encode({
        presetFile,
        presetName,
        input: row.source_path,
        output: partPath,
        format: row.format,
        nice: this.settings.get('niceLevel'),
        logFile: this.logFile(id),
        onProgress: (p) => this.onProgress(active, p),
        onExit: (code, signal, err) => {
          this.onExit(active, code, signal, err).finally(resolve);
        },
      });
    });
    this.active = active;
    countInRun();
    this.log.info(`Job ${id}${single ? ' (convert now)' : ''}: encoding ${row.source_path} -> ${finalPath}`);
    this.emitJob(id);
    this.events.emit('queue', this.state());
  }

  onProgress(active, p) {
    if (active.pausedAt) return;
    const now = Date.now();
    const fields = {};
    if (p.State === 'SCANNING') fields.phase = 'scanning';
    else if (p.State === 'WORKING' && p.Working) {
      const w = p.Working;
      Object.assign(fields, {
        phase: 'encoding',
        progress: w.Progress,
        fps: w.Rate,
        avg_fps: w.RateAvg,
        eta: w.ETASeconds,
        pass: w.Pass,
        pass_count: w.PassCount,
      });
    } else if (p.State === 'MUXING') Object.assign(fields, { phase: 'muxing', progress: 1, eta: 0 });
    else return;

    active.latest = { ...active.latest, ...fields };
    const phaseChanged = fields.phase !== active.phase;
    active.phase = fields.phase;
    if (phaseChanged || now - this.lastSave > 5000) {
      this.lastSave = now;
      this.saveProgress(active);
    }
    if (phaseChanged || now - this.lastEmit > 1000) {
      this.lastEmit = now;
      this.events.emit('progress', { id: active.id, ...toProgressEvent(active.latest) });
    }
  }

  saveProgress(active) {
    const l = active.latest ?? {};
    this.db
      .prepare('UPDATE jobs SET phase = ?, progress = ?, fps = ?, avg_fps = ?, eta = ?, pass = ?, pass_count = ? WHERE id = ?')
      .run(l.phase ?? null, l.progress ?? 0, l.fps ?? null, l.avg_fps ?? null, l.eta ?? null, l.pass ?? null, l.pass_count ?? null, active.id);
  }

  async onExit(active, code, signal, spawnErr) {
    const { id, partPath, finalPath } = active;
    this.saveProgress(active);
    const now = Date.now();
    const partSize = await fs.stat(partPath).then((s) => s.size, () => 0);

    if (active.shuttingDown) {
      // Left as 'running': recover() re-queues it on the next start.
      await fs.rm(partPath, { force: true }).catch(() => {});
    } else if (active.cancelled) {
      await fs.rm(partPath, { force: true }).catch(() => {});
      this.db
        .prepare(`UPDATE jobs SET status = 'cancelled', phase = NULL, finished_at = ?, exit_code = ?, eta = NULL, fps = NULL WHERE id = ?`)
        .run(now, code, id);
    } else if (code === 0 && partSize > 0) {
      try {
        await fs.rename(partPath, finalPath);
        const verify = await this.verifyActive(active);
        this.db
          .prepare(`UPDATE jobs SET status = 'done', phase = NULL, finished_at = ?, exit_code = 0, progress = 1,
            eta = 0, fps = NULL, output_size = ?, verify_status = ?, verify = ? WHERE id = ?`)
          .run(now, partSize, verify?.status ?? null, verify ? JSON.stringify(verify) : null, id);
        if (verify?.status === 'error') {
          if (this.settings.get('autoRename')) {
            this.db.prepare('UPDATE jobs SET rename_note = ? WHERE id = ?').run('Not renamed automatically: the check found problems', id);
          }
        } else {
          await this.maybeAutoRename(id, finalPath);
        }
      } catch (err) {
        await this.markFailed(id, now, code, `Encoded, but could not rename the output: ${err.message}`);
      }
    } else {
      await fs.rm(partPath, { force: true }).catch(() => {});
      const reason = spawnErr
        ? `Could not start HandBrakeCLI: ${spawnErr.message}`
        : code === 0
          ? 'HandBrake finished but produced no output'
          : await this.errorFromLog(id, code, signal);
      await this.markFailed(id, now, code, reason);
    }

    await fs.rm(active.presetFile, { force: true }).catch(() => {});
    this.log.info(`Job ${id}: finished (code=${code}${signal ? ` signal=${signal}` : ''})`);
    if (!active.shuttingDown) this.afterFinish(id);
    if (this.active === active) this.active = null;
    if (!active.shuttingDown) {
      this.emitJob(id);
      this.events.emit('queue', this.state());
      this.tick();
    }
  }

  /** Checks the finished output (setting "verifyMode"); the job stays "running" meanwhile. */
  async verifyActive(active) {
    const mode = this.settings.get('verifyMode');
    if (!this.verifier || mode === 'off') return null;
    active.verifying = true;
    active.latest = { phase: 'verifying', progress: 0, fps: null, eta: null };
    active.phase = 'verifying';
    this.saveProgress(active);
    this.events.emit('progress', { id: active.id, phase: 'verifying', progress: 0, fps: null, eta: null });
    let last = 0;
    const result = await this.verifier.verify({
      output: active.finalPath,
      source: active.source,
      logFile: this.logFile(active.id),
      mode,
      nice: this.settings.get('niceLevel'),
      isStopped: () => active.cancelled || active.shuttingDown,
      onChild: (child) => {
        active.child = child;
        if (active.pausedAt) child.kill('SIGSTOP');
      },
      onProgress: (p) => {
        active.latest = { ...active.latest, progress: p };
        if (Date.now() - last > 1000) {
          last = Date.now();
          this.events.emit('progress', { id: active.id, phase: 'verifying', progress: p });
        }
      },
    });
    if (active.cancelled || active.shuttingDown) {
      return { ...result, status: 'skipped', checks: [], note: active.cancelled ? 'Check skipped' : 'Check interrupted by a restart', noteCode: active.cancelled ? 'checkSkipped' : 'interrupted' };
    }
    this.log.info(`Job ${active.id}: check ${result.status}`);
    return result;
  }

  /** Checks a finished job's output again, outside the queue (one at a time). */
  verifyJob(id) {
    const job = this.get(id);
    if (job.status !== 'done') throw conflict('Only converted jobs can be checked');
    if (job.verifyStatus === 'running') throw conflict('This job is being checked already');
    if (!this.verifier) throw conflict('Checking is not available');
    this.db.prepare(`UPDATE jobs SET verify_status = 'running' WHERE id = ?`).run(id);
    this.emitJob(id);
    this.manualChecks = this.manualChecks.then(async () => {
      let last = 0;
      const mode = this.settings.get('verifyMode') === 'quick' ? 'quick' : 'full';
      const result = await this.verifier
        .verify({
          output: job.outputPath,
          source: job.sourcePath,
          logFile: this.logFile(id),
          mode,
          nice: this.settings.get('niceLevel'),
          onProgress: (p) => {
            if (Date.now() - last > 1000) {
              last = Date.now();
              this.events.emit('progress', { id, verifyProgress: p });
            }
          },
        })
        .catch((err) => ({ status: 'error', checks: [{ id: 'internal', label: 'Check', labelCode: 'internal', status: 'error', detail: err.message, detailCode: 'message', detailParams: { message: err.message } }] }));
      if (!this.db.prepare('SELECT id FROM jobs WHERE id = ?').get(id)) return;
      this.db.prepare('UPDATE jobs SET verify_status = ?, verify = ? WHERE id = ?').run(result.status, JSON.stringify(result), id);
      this.emitJob(id);
    });
  }

  /** Optional automatic rename after a successful encode (setting "autoRename"). */
  async maybeAutoRename(id, file) {
    if (!this.renamer || !this.settings.get('autoRename')) return;
    try {
      const r = await this.renamer.autoRename(file);
      if (r.note) this.db.prepare('UPDATE jobs SET rename_note = ? WHERE id = ?').run(r.note, id);
      else if (r.path !== file) this.log.info(`Job ${id}: renamed to ${path.basename(r.path)}`);
    } catch (err) {
      this.log.error(err, `Job ${id}: automatic rename failed`);
      this.db.prepare('UPDATE jobs SET rename_note = ? WHERE id = ?').run(`Automatic rename failed: ${err.message}`, id);
    }
  }

  /** Records a finished job in the history and sends its notification. */
  afterFinish(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!row) return;
    try {
      this.history?.record(row);
    } catch (err) {
      this.log.error(err, `Job ${id}: could not record it in the history`);
    }
    const job = rowToJob(row);
    if (job.status === 'failed') this.notifier?.notify('jobFailed', job);
    else if (job.status === 'done') this.notifier?.notify(job.verifyStatus === 'error' ? 'checkFailed' : 'jobDone', job);
  }

  /** "Queue finished" notification with what this run did. */
  notifyRunFinished() {
    const run = this.run;
    this.run = null;
    if (!run?.ids.length) return;
    const get = this.db.prepare(`SELECT ${LIST_COLUMNS} FROM jobs WHERE id = ?`);
    const jobs = run.ids.map((id) => rowToJob(get.get(id))).filter(Boolean);
    this.notifier?.notify('queueFinished', { jobs, startedAt: run.startedAt, finishedAt: Date.now() });
  }

  async markFailed(id, now, code, reason) {
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', phase = NULL, finished_at = ?, exit_code = ?, error = ?, eta = NULL, fps = NULL WHERE id = ?`)
      .run(now, code, reason, id);
  }

  async errorFromLog(id, code, signal) {
    const text = await fs.readFile(this.logFile(id), 'utf8').catch(() => '');
    const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const errs = lines.filter((l) => /error|failed|invalid|cannot|not found/i.test(l));
    const detail = (errs.length ? errs.slice(-3) : lines.slice(-3)).join(' | ').slice(0, 600);
    const head = signal ? `HandBrake was stopped by ${signal}` : `HandBrake exited with code ${code}`;
    return detail ? `${head}: ${detail}` : head;
  }

  emitJob(id) {
    const row = this.db.prepare(`SELECT ${LIST_COLUMNS} FROM jobs WHERE id = ?`).get(id);
    if (row) this.events.emit('job', rowToJob(row));
  }
}

function toProgressEvent(l) {
  return {
    phase: l.phase,
    progress: l.progress,
    fps: l.fps,
    avgFps: l.avg_fps,
    eta: l.eta,
    pass: l.pass,
    passCount: l.pass_count,
  };
}
