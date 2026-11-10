import { finishTime } from './schedule.js';
import { elapsed } from './format.js';

/**
 * How long the queue still needs and when it will be done.
 *
 * Each job's time = its source length × the seconds of work per second of video
 * measured on recent conversions with the same preset (encode plus the check after
 * it; server: History.speeds). Without history for a preset, the overall figure is
 * used, and without any history, the speed of the job converting now.
 * Jobs whose length is not known yet (scan pending) get the average length.
 *
 * Returns null when there is nothing to estimate, else
 * { seconds, finishAt, startsAt, estimated, unknown, perJob: Map(id → seconds) }.
 */
export function queueEstimate(jobs, queue, settings, now = Date.now()) {
  const active = jobs.find((j) => j.status === 'running' || j.status === 'paused');
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.position - b.position);
  if (!active && !queued.length) return null;

  const speeds = queue?.speeds ?? {};
  let fallback = speeds.overall ?? null;
  // No history at all: use the job being converted now, once it is far enough along.
  const activeLen = active?.sourceInfo?.duration;
  if (fallback == null && active?.phase === 'encoding' && active.progress > 0.05 && activeLen > 0) {
    fallback = elapsed(active, now) / active.progress / activeLen;
  }
  const ratioFor = (j) => speeds.byPreset?.[j.presetName] ?? fallback;

  const known = queued.map((j) => j.sourceInfo?.duration).filter((x) => x > 0);
  const avgLen = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;

  const perJob = new Map();
  let unknown = 0;
  let estimated = 0;
  const times = [];
  for (const j of queued) {
    let len = j.sourceInfo?.duration;
    if (!(len > 0)) {
      len = avgLen;
      estimated++;
    }
    const r = ratioFor(j);
    if (len == null || r == null) {
      unknown++;
      continue;
    }
    perJob.set(j.id, len * r);
    times.push(len * r);
  }

  let runningLeft = 0;
  if (active) {
    const r = ratioFor(active);
    const spent = elapsed(active, now) ?? 0;
    if (r != null && activeLen > 0) runningLeft = Math.max(r * activeLen - spent, active.eta ?? 0, 30);
    else if (active.eta != null) runningLeft = active.eta;
    else unknown++;
    perJob.set(active.id, runningLeft);
  }

  const seconds = runningLeft + times.reduce((a, b) => a + b, 0);
  const schedule = settings?.schedule;
  const ignoreWindow = !!queue?.schedule?.override;
  const finish = finishTime(schedule, times, { now: new Date(now), runningLeft, ignoreWindow });
  const startsAt = !active && queue?.schedule?.nextStart && !ignoreWindow ? queue.schedule.nextStart : null;
  return {
    seconds,
    finishAt: finish ? finish.getTime() : null,
    startsAt,
    estimated,
    unknown,
    perJob,
    jobs: queued.length + (active ? 1 : 0),
  };
}
