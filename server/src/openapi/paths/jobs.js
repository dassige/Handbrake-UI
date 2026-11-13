// Docs of the jobs routes: jobs, sidecar subtitles and the queue. Conventions: ../index.js; example: ./auth.js.

const EMBED_MODES = ['never', 'missing', 'always'];
const COPY_MODES = ['never', 'notEmbedded', 'always'];

const subtitleEdits = {
  type: ['object', 'null'],
  description: 'Changes to one subtitle file; the source file itself is never changed. Fields left out or empty mean “no change”. Bad values are refused with 400.',
  properties: {
    offsetMs: { type: ['number', 'null'], description: 'Shift all cues, in milliseconds (positive: later). At most 24 hours either way.' },
    fps: {
      type: ['object', 'null'],
      description: 'Stretch the timing from one frame rate to another. `from` and `to` must each be one of 23.976, 24, 25, 29.97, 30.',
      properties: { from: { type: ['number', 'null'] }, to: { type: ['number', 'null'] } },
    },
    codeset: { type: ['string', 'null'], description: 'Character set to read the file with (e.g. `windows-1252`); empty: detected automatically.' },
    cleanup: {
      type: ['object', 'null'],
      description: 'Clean-up options, each switched on with `true`.',
      properties: {
        hi: { type: 'boolean', description: 'Remove hearing-impaired notes such as [door slams] and speaker names.' },
        tags: { type: 'boolean', description: 'Remove formatting tags.' },
        ads: { type: 'boolean', description: 'Remove credits and adverts added by subtitle sites.' },
        overlaps: { type: 'boolean', description: 'Fix cues that overlap in time.' },
      },
    },
  },
};

const subtitleFile = {
  type: 'object',
  description: 'A subtitle file found next to the job’s source video, with the choices made for it.',
  properties: {
    path: { type: 'string', description: 'Absolute path of the file.' },
    name: { type: 'string', description: 'Name relative to the video’s folder.' },
    format: { type: 'string', description: 'File format, e.g. srt, ass, ssa, vtt, sub, sup.' },
    match: { type: 'string', description: 'How the file was matched to the video.' },
    size: { type: ['integer', 'null'], description: 'Bytes.' },
    extra: { type: 'array', items: { type: 'string' }, description: 'Extra words in the file name (e.g. `forced`, `sdh`).' },
    detected: {
      type: 'object',
      description: 'Language and flags as detected from the name.',
      properties: { lang: { type: ['string', 'null'] }, forced: { type: 'boolean' }, sdh: { type: 'boolean' } },
    },
    include: { type: 'boolean', description: 'false: this file is left out (not embedded, not copied).' },
    lang: { type: ['string', 'null'], description: 'Language code (ISO 639-2), or null when unknown.' },
    forced: { type: 'boolean' },
    sdh: { type: 'boolean', description: 'For the deaf and hard of hearing.' },
    edits: { type: 'object', description: 'The edits saved for this file (same fields as in the PATCH body, only the ones in effect).' },
  },
};

const subtitleVerdict = {
  type: 'object',
  description: 'What will happen to one subtitle file: its fields plus the two below.',
  allOf: [{ $ref: 'JobSubtitleFile#' }],
  properties: {
    embed: { type: 'boolean', description: 'It goes into the converted file.' },
    copy: { type: 'boolean', description: 'It is copied next to the converted file.' },
    why: { type: 'string', enum: ['excluded', 'never', 'always', 'missing', 'present', 'unknownLang', 'container'], description: 'Why it is or is not embedded: excluded (left out), never/always (the mode), missing (the output has no track in this language), present (it already has one), unknownLang (no language, and the output has subtitles already), container (the output format cannot hold it).' },
  },
};

export const schemas = [
  {
    $id: 'Job',
    type: 'object',
    description: 'One conversion job. Times are milliseconds since 1970.',
    properties: {
      id: { type: 'integer' },
      status: { type: 'string', enum: ['queued', 'running', 'paused', 'done', 'failed', 'cancelled'] },
      phase: { type: ['string', 'null'], description: 'While running: scanning, encoding, muxing (adding picture subtitles) or verifying (the automatic check). Otherwise null.' },
      position: { type: 'integer', description: 'Order among queued jobs (lower runs first).' },
      sourcePath: { type: 'string', description: 'Absolute path of the source video.' },
      outputPath: { type: 'string', description: 'Absolute path of the converted file (planned, until it is made).' },
      presetId: { type: ['integer', 'null'] },
      presetName: { type: ['string', 'null'], description: 'Name of the preset when the job was added.' },
      format: { type: ['string', 'null'], description: 'HandBrake container format of the output, e.g. av_mkv.' },
      createdAt: { type: 'integer' },
      startedAt: { type: ['integer', 'null'] },
      finishedAt: { type: ['integer', 'null'] },
      pausedMs: { type: ['integer', 'null'], description: 'Total time spent paused, in milliseconds.' },
      progress: { type: ['number', 'null'], description: '0 to 1.' },
      fps: { type: ['number', 'null'], description: 'Current encoding speed, frames per second.' },
      avgFps: { type: ['number', 'null'] },
      eta: { type: ['integer', 'null'], description: 'Seconds left.' },
      pass: { type: ['integer', 'null'], description: 'Current pass, for multi-pass encodes.' },
      passCount: { type: ['integer', 'null'] },
      sourceSize: { type: ['integer', 'null'], description: 'Bytes.' },
      outputSize: { type: ['integer', 'null'], description: 'Bytes, once converted.' },
      sourceInfo: { type: ['object', 'null'], description: 'What the scan of the source found (duration, resolution, audio and subtitle tracks…). null until the scan has run.' },
      scanError: { type: ['string', 'null'], description: 'Why the scan failed, if it did.' },
      exitCode: { type: ['integer', 'null'], description: 'HandBrakeCLI’s exit code.' },
      error: { type: ['string', 'null'], description: 'Why the job failed.' },
      attempts: { type: ['integer', 'null'] },
      renameNote: { type: ['string', 'null'], description: 'Note from the automatic rename after the conversion.' },
      verifyStatus: { type: ['string', 'null'], description: 'State of the check of the converted file: running, or its result (e.g. ok, warning, error, skipped). null: not checked.' },
      verify: { type: ['object', 'null'], description: 'Result of the check: `status`, a list of `checks`, and for some results a `note`.' },
      origin: { type: ['string', 'null'], description: '`watch`: added by a watch folder; `quality`: added from the quality check, to replace the original once converted (`POST /api/jobs/{id}/replace-original`); null otherwise.' },
      replaced: {
        type: ['object', 'null'],
        description: 'Set once the original was replaced by the converted file.',
        properties: {
          at: { type: 'integer' },
          original: { type: 'string', description: 'Where the original was.' },
          converted: { type: 'string', description: 'Where the converted file was.' },
          path: { type: 'string', description: 'Where the converted file now replaces the original (also the job’s outputPath, unless keptConverted).' },
          keptConverted: { type: 'boolean', description: 'The converted file was copied: it is also still at `converted`.' },
          backup: { type: ['string', 'null'], description: 'Where the original was kept; null: deleted.' },
          subtitles: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, backup: { type: ['string', 'null'] } } } },
          warnings: { type: 'array', items: { type: 'string' }, description: 'Steps after the replacement that failed (e.g. a subtitle copy that could not be moved).' },
        },
      },
      tag: { type: ['string', 'null'], description: 'The tag given when the job was added (e.g. an integration’s own reference); null when none. Kept by “convert again” and sent in notifications.' },
      subtitles: { type: ['array', 'null'], items: { $ref: 'JobSubtitleFile#' }, description: 'Subtitle files found next to the source; null until they have been looked for.' },
      subEmbed: { type: ['string', 'null'], enum: [...EMBED_MODES, null], description: 'This job’s own embed mode; null: follow the queue or Settings.' },
      subCopy: { type: ['string', 'null'], enum: [...COPY_MODES, null], description: 'This job’s own copy mode; null: follow the queue or Settings.' },
      subtitleResult: { type: ['object', 'null'], description: 'What was done with the subtitle files: `embedded`, `copied`, `muxed` and `errors`.' },
    },
  },
  {
    $id: 'QueueState',
    type: 'object',
    description: 'State of the queue as a whole.',
    properties: {
      running: { type: 'boolean', description: 'The queue is started: it takes the next job when one ends.' },
      activeJobId: { type: ['integer', 'null'], description: 'The job being converted now (running or paused).' },
      activeSingle: { type: 'boolean', description: 'The active job was started alone with convert-now; the queue stays stopped after it.' },
      canPause: { type: 'boolean', description: 'false on Windows, where jobs cannot be paused.' },
      counts: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Number of jobs per status (a status with no jobs is missing).' },
      schedule: {
        type: 'object',
        description: 'The conversion window.',
        properties: {
          enabled: { type: 'boolean' },
          open: { type: 'boolean', description: 'Now is inside the window (always true when it is not enabled).' },
          override: { type: 'boolean', description: 'The queue was started with `now`: the window is ignored until it stops.' },
          waiting: { type: 'boolean', description: 'Started, with jobs queued, but waiting for the window to open.' },
          nextStart: { type: ['integer', 'null'], description: 'When the window opens next.' },
          closesAt: { type: ['integer', 'null'], description: 'When the open window closes.' },
        },
      },
      speeds: { type: ['object', 'null'], description: 'Seconds of work per second of video, from recent conversions, used to estimate finish times.' },
    },
  },
  { $id: 'JobSubtitleFile', ...subtitleFile },
  {
    $id: 'JobSubtitles',
    type: 'object',
    description: 'The subtitle files of a job and what will happen to them.',
    properties: {
      embed: { type: ['string', 'null'], enum: [...EMBED_MODES, null], description: 'The job’s own embed mode; null: follow the queue or Settings.' },
      copy: { type: ['string', 'null'], enum: [...COPY_MODES, null], description: 'The job’s own copy mode; null: follow the queue or Settings.' },
      effective: {
        type: 'object',
        description: 'The modes in force.',
        properties: {
          embed: { type: 'string', enum: EMBED_MODES },
          copy: { type: 'string', enum: COPY_MODES },
          embedFrom: { type: 'string', enum: ['job', 'queue', 'settings'], description: 'Where the embed mode comes from.' },
          copyFrom: { type: 'string', enum: ['job', 'queue', 'settings'], description: 'Where the copy mode comes from.' },
        },
      },
      files: { type: 'array', items: subtitleVerdict },
    },
  },
];

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const ok = { 200: { description: 'Done.', $ref: 'Ok#' } };
const idsBody = (description) => ({
  type: 'object',
  properties: { ids: { type: 'array', items: { type: 'integer' }, description } },
  required: ['ids'],
});
const jobErrors = {
  400: { description: 'Invalid id or request.', $ref: 'Error#' },
  404: { description: 'No such job.', $ref: 'Error#' },
};
const conflict = (what) => ({ 409: { description: what, $ref: 'Error#' } });
const positionProp = { type: ['string', 'null'], description: '`next`: before the first queued job; anything else or empty: after the last one.' };

schemas.push({
  $id: 'ReplaceBatch',
  type: 'object',
  properties: {
    running: { type: 'boolean' },
    stopping: { type: 'boolean', description: 'Stop was asked: the file being replaced is finished, the rest skipped.' },
    startedAt: { type: 'integer' },
    finishedAt: { type: ['integer', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The job.' },
          name: { type: 'string', description: 'The original’s file name.' },
          backup: { type: 'boolean' },
          keepConverted: { type: 'boolean' },
          status: { type: 'string', enum: ['waiting', 'replacing', 'done', 'failed', 'skipped'] },
          error: { type: ['string', 'null'] },
          code: { type: ['string', 'null'], description: 'Why it failed, when known (as for replace-original).' },
        },
      },
    },
    current: {
      type: ['object', 'null'],
      description: 'The job being replaced: step `converted` (copying the converted file next to the original) or `original` (copying the original to the originals folder), with bytes done and total. A move within one disk is instant and reports no bytes.',
      properties: { id: { type: 'integer' }, step: { type: ['string', 'null'] }, done: { type: 'integer' }, total: { type: ['integer', 'null'] } },
    },
  },
});

export const paths = {
  'GET /api/jobs': {
    operationId: 'listJobs',
    tags: ['Jobs'],
    summary: 'Jobs and the queue state',
    description: 'Running and paused jobs first, then queued ones in queue order, then finished ones, newest first. Without filters: every job still listed (cleared jobs are gone). Filters combine: e.g. `?tag=sonarr:1234&status=done,failed` tells whether an integration’s files are finished.',
    querystring: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Comma-separated statuses: queued, running, paused, done, failed, cancelled.' },
        tag: { type: 'string', description: 'Only jobs with exactly this tag.' },
        since: { type: 'string', description: 'Milliseconds since 1970: only jobs added or finished at or after it (for polling).' },
        limit: { type: 'string', description: 'At most this many jobs (1–10000), the first ones in the order above.' },
      },
    },
    response: {
      200: {
        type: 'object',
        properties: { jobs: { type: 'array', items: { $ref: 'Job#' } }, queue: { $ref: 'QueueState#' } },
      },
    },
  },
  'GET /api/jobs/:id': {
    operationId: 'getJob',
    tags: ['Jobs'],
    summary: 'One job',
    params: idParam,
    response: { 200: { $ref: 'Job#' }, ...jobErrors },
  },
  'GET /api/jobs/:id/log': {
    operationId: 'getJobLog',
    tags: ['Jobs'],
    summary: 'The job’s log',
    description: 'The HandBrake output of the job as plain text (empty when there is none). Only the last 2,000,000 characters are returned; a first line says how many were left out.',
    params: idParam,
    response: {
      200: { description: 'The log.', content: { 'text/plain': { schema: { type: 'string' } } } },
      404: { description: 'No such job.', $ref: 'Error#' },
    },
  },
  'POST /api/jobs': {
    operationId: 'addJobs',
    tags: ['Jobs'],
    summary: 'Add files or folders to the queue',
    description: 'Adds one job per video file. A folder adds the videos in it (and below it, when “recursive” is on in Settings). Paths must be inside the sources folders. Adding does not start the queue, unless `start` (waits for the conversion window, if one is set) or `startNow` (starts at once) is true. `tag` is kept with every job added, to find them later (`GET /api/jobs?tag=`) and to recognise them in notifications. Files that were not added are listed in `skipped` with a `code`: `noVideoInFolder`, `notVideo`, `alreadyQueued` (queued or converting), `alreadyConverted` (done, when “skip converted” is on). A preset that is not given (or null) uses the default preset.',
    body: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of video files or folders.' },
        presetId: { type: ['integer', 'null'], description: 'Preset to convert with; null or missing: the default preset.' },
        position: positionProp,
        tag: { type: ['string', 'null'], description: 'Free text up to 100 characters kept with each new job, e.g. `sonarr:1234`.' },
        origin: { type: ['string', 'null'], description: '`quality`: the files come from the quality check and their originals are to be replaced once converted. Other values are refused.' },
        start: { type: ['boolean', 'null'], description: 'Also start the queue, as `POST /api/queue/start` does.' },
        startNow: { type: ['boolean', 'null'], description: 'Also start the queue, even outside the conversion window.' },
      },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          added: { type: 'array', items: { type: 'integer' }, description: 'Ids of the new jobs.' },
          queue: { $ref: 'QueueState#' },
          skipped: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, code: { type: 'string', enum: ['noVideoInFolder', 'notVideo', 'alreadyQueued', 'alreadyConverted'] }, reason: { type: 'string', description: 'The code in English.' } },
            },
          },
        },
      },
      400: { description: 'No paths, or a path outside the sources folders.', $ref: 'Error#' },
      404: { description: 'A path does not exist, or no such preset.', $ref: 'Error#' },
    },
  },
  'PATCH /api/jobs/:id': {
    operationId: 'updateJob',
    tags: ['Jobs'],
    summary: 'Change the preset or output of a queued job',
    description: 'Only queued jobs. Changing the preset also changes the output file’s extension to the preset’s format. An output path must be a file inside the target folder; a missing or wrong extension is fixed.',
    params: idParam,
    body: {
      type: 'object',
      properties: {
        presetId: { type: ['integer', 'null'], description: 'New preset; null or missing: unchanged.' },
        outputPath: { type: ['string', 'null'], description: 'New absolute output path; null or missing: unchanged.' },
      },
    },
    response: { 200: { $ref: 'Job#' }, ...jobErrors, ...conflict('The job is not queued.') },
  },
  'POST /api/jobs/reorder': {
    operationId: 'reorderJobs',
    tags: ['Jobs'],
    summary: 'Set the order of the queued jobs',
    description: 'The listed queued jobs go first, in this order; queued jobs not listed follow in their old order. Ids that are not queued are ignored.',
    body: idsBody('Job ids in the wanted order.'),
    response: { ...ok, 400: { description: 'ids is not a list.', $ref: 'Error#' } },
  },
  'POST /api/jobs/remove': {
    operationId: 'removeJobs',
    tags: ['Jobs'],
    summary: 'Remove jobs',
    description: 'Deletes the jobs and their logs (never the video files). Nothing is removed when one of them is running or paused (409): cancel it first.',
    body: idsBody('Ids of the jobs to remove.'),
    response: { ...ok, 400: { description: 'ids is not a list.', $ref: 'Error#' }, 404: { description: 'A job does not exist.', $ref: 'Error#' }, ...conflict('A job is running.') },
  },
  'POST /api/jobs/clear': {
    operationId: 'clearJobs',
    tags: ['Jobs'],
    summary: 'Remove finished jobs',
    description: 'Removes the finished jobs that have one of the given statuses. Only `done`, `failed` and `cancelled` count; other values are ignored. Without `statuses`, all three.',
    body: {
      type: 'object',
      properties: { statuses: { type: 'array', items: { type: 'string' }, description: 'Some of done, failed, cancelled. Missing: all three.' } },
    },
    response: { 200: { type: 'object', properties: { removed: { type: 'integer', description: 'Number of jobs removed.' } } } },
  },
  'POST /api/jobs/:id/pause': {
    operationId: 'pauseJob',
    tags: ['Jobs'],
    summary: 'Pause the running job',
    description: 'Freezes the conversion. Not available on Windows (409). Pausing a paused job does nothing.',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is not the one running, or pausing is not supported.') },
  },
  'POST /api/jobs/:id/resume': {
    operationId: 'resumeJob',
    tags: ['Jobs'],
    summary: 'Resume a paused job',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is not the one running.') },
  },
  'POST /api/jobs/:id/cancel': {
    operationId: 'cancelJob',
    tags: ['Jobs'],
    summary: 'Cancel a job',
    description: 'A queued job becomes `cancelled` at once. A running or paused job is stopped; it becomes `cancelled` a moment later (the answer comes before that). During the automatic check after the conversion, the check is stopped and the job stays `done`.',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is neither queued nor running.') },
  },
  'POST /api/jobs/:id/retry': {
    operationId: 'retryJob',
    tags: ['Jobs'],
    summary: 'Queue a finished job again',
    description: 'Puts the same job (done, failed or cancelled) back at the end of the queue with its preset, clearing its progress and result.',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is not finished.') },
  },
  'POST /api/jobs/:id/again': {
    operationId: 'convertJobAgain',
    tags: ['Jobs'],
    summary: 'Convert the same source again as a new job',
    description: 'Creates a new queued job for the same source file, keeping the job’s subtitle choices. The job itself is not changed. Does not start the queue.',
    params: idParam,
    body: {
      type: 'object',
      properties: {
        presetId: { type: ['integer', 'null'], description: 'Preset for the new job; null or missing: the same preset as this job.' },
        position: positionProp,
      },
    },
    response: { 200: { type: 'object', properties: { id: { type: 'integer', description: 'Id of the new job.' } } }, ...jobErrors },
  },
  'POST /api/jobs/:id/move': {
    operationId: 'moveJob',
    tags: ['Jobs'],
    summary: 'Move a queued job in the queue',
    params: idParam,
    body: {
      type: 'object',
      properties: { where: { type: 'string', enum: ['top', 'bottom', 'up', 'down'], description: 'top/bottom: first/last in the queue; up/down: one place.' } },
      required: ['where'],
    },
    response: { ...ok, ...jobErrors, ...conflict('The job is not queued.') },
  },
  'POST /api/jobs/:id/verify': {
    operationId: 'verifyJob',
    tags: ['Jobs'],
    summary: 'Check a converted file',
    description: 'Starts a check of the converted file (readable, duration, streams…). It runs in the background, one at a time; the result appears in the job’s `verifyStatus` and `verify` (see the `job` events).',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is not done, is being checked already, or checking is not available.') },
  },
  'POST /api/jobs/:id/convert-now': {
    operationId: 'convertJobNow',
    tags: ['Jobs'],
    summary: 'Convert one queued job now',
    description: 'Converts this job alone, even outside the conversion window. Only while the queue is stopped and nothing else is converting. The queue stays stopped afterwards.',
    params: idParam,
    response: { ...ok, ...jobErrors, ...conflict('The job is not queued, the queue is running, or another conversion is running.') },
  },
  'POST /api/jobs/:id/replace-original': {
    operationId: 'replaceOriginal',
    tags: ['Jobs'],
    summary: 'Replace the original with the converted file',
    description: 'For a converted job added from the quality check (origin `quality`). The converted file takes the original’s place: the original’s folder and name, the converted file’s extension (Film.avi → Film.mkv). With `backup: true` the original is kept in the originals folder of Settings → Quality check (under the same path as in its sources folder); otherwise it is deleted. Subtitle copies written next to the converted file go with it, named after the original. Refused (409, with a `code`) when the check after conversion failed or is running (`checkFailed`, `checking`), the original is in a protected sources folder (`protected`) or queued again (`pending`), another file already has the new name (`nameTaken`), the converted file is gone (`noOutput`), or it was done already (`alreadyReplaced`). A step that fails undoes the ones before it.',
    params: idParam,
    body: {
      type: 'object',
      properties: {
        backup: { type: ['boolean', 'null'], description: 'Keep the original in the originals folder (which must be set).' },
        keepConverted: { type: ['boolean', 'null'], description: 'Copy the converted file instead of moving it: it stays in the target folder too (the job’s outputPath stays there).' },
      },
    },
    response: {
      200: { $ref: 'Job#' },
      400: { description: 'backup without an originals folder in the settings (code noBackupFolder).', $ref: 'Error#' },
      ...jobErrors,
      ...conflict('Cannot be replaced now; see `code`.'),
    },
  },
  'GET /api/replace': {
    operationId: 'getReplaceProgress',
    tags: ['Jobs'],
    summary: 'Originals being replaced in the background',
    description: 'The list started with `POST /api/replace`: each job’s status and, for the one being replaced, how far the copy is. Also sent as `replace` events on `/api/events`. null when there is none.',
    response: { 200: { oneOf: [{ $ref: 'ReplaceBatch#' }, { type: 'null' }] } },
  },
  'POST /api/replace': {
    operationId: 'replaceOriginals',
    tags: ['Jobs'],
    summary: 'Replace originals in the background',
    description: 'Adds converted quality-check jobs to the list of originals to replace (see `POST /api/jobs/{id}/replace-original` for what replacing does). The server works through the list one job at a time, also with no browser open; a job already in the list is not added twice. Jobs that cannot be replaced fail one by one, with the reason and `code`.',
    body: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'The jobs.' },
        backup: { type: ['boolean', 'null'], description: 'Keep the originals in the originals folder (which must be set).' },
        keepConverted: { type: ['boolean', 'null'], description: 'Copy the converted files instead of moving them: they stay in the target folder too.' },
      },
      required: ['ids'],
    },
    response: { 200: { $ref: 'ReplaceBatch#' }, 400: { description: 'No jobs, or backup without an originals folder (code noBackupFolder).', $ref: 'Error#' }, 404: { description: 'No such job.', $ref: 'Error#' } },
  },
  'POST /api/replace/stop': {
    operationId: 'stopReplacingOriginals',
    tags: ['Jobs'],
    summary: 'Stop after the original being replaced',
    description: 'The file being replaced is finished (a copy cannot be cut safely); the jobs still waiting are skipped.',
    response: { 200: { $ref: 'ReplaceBatch#' }, ...conflict('Nothing is being replaced.') },
  },
  'DELETE /api/replace': {
    operationId: 'clearReplaceProgress',
    tags: ['Jobs'],
    summary: 'Forget a finished list',
    description: 'Removes the summary of the last list (the app’s bar above the queue).',
    response: { ...ok, ...conflict('Originals are being replaced; stop first.') },
  },
  'GET /api/jobs/:id/subtitles': {
    operationId: 'getJobSubtitles',
    tags: ['Subtitles'],
    summary: 'Subtitle files of a job',
    description: 'The subtitle files found next to the source video, and for each what will be done with it.',
    params: idParam,
    response: { 200: { $ref: 'JobSubtitles#' }, ...jobErrors },
  },
  'PATCH /api/jobs/:id/subtitles': {
    operationId: 'updateJobSubtitles',
    tags: ['Subtitles'],
    summary: 'Change the subtitle choices of a job',
    description: 'Every field is optional; only the ones sent are changed. `embed` and `copy` set the job’s own mode, or null to follow the queue and Settings. `files` changes individual files, found by `path` (paths that are not the job’s are ignored); only the fields sent for a file change. Not while the job is running.',
    params: idParam,
    body: {
      type: 'object',
      properties: {
        embed: { type: ['string', 'null'], enum: [...EMBED_MODES, null], description: 'never: do not put files into the output; missing: only languages the output lacks; always.' },
        copy: { type: ['string', 'null'], enum: [...COPY_MODES, null], description: 'never; notEmbedded: copy the files that are not embedded; always: copy every file next to the output.' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Which file (its `path` in the list).' },
              include: { type: 'boolean' },
              lang: { type: ['string', 'null'], description: 'Language as a code or a name; null or empty: unknown. Unknown languages are refused with 400.' },
              forced: { type: 'boolean' },
              sdh: { type: 'boolean' },
              edits: subtitleEdits,
            },
          },
        },
      },
    },
    response: { 200: { $ref: 'JobSubtitles#' }, ...jobErrors, ...conflict('The job is converting.') },
  },
  'POST /api/jobs/:id/subtitles/detect': {
    operationId: 'detectJobSubtitles',
    tags: ['Subtitles'],
    summary: 'Look for subtitle files again',
    description: 'Searches next to the source video again. Choices made for files that are still there are kept. Not while the job is running.',
    params: idParam,
    response: { 200: { $ref: 'JobSubtitles#' }, ...jobErrors, ...conflict('The job is converting.') },
  },
  'POST /api/jobs/:id/subtitles/preview': {
    operationId: 'previewJobSubtitle',
    tags: ['Subtitles'],
    summary: 'Preview subtitle edits',
    description: 'The cues of one subtitle file before and after the given edits (at most a few thousand), without saving anything. Picture formats (`image: true`) have no cues. Without `edits`, the saved edits of the file are used.',
    params: idParam,
    body: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Which file (its `path` in the list).' },
        edits: subtitleEdits,
      },
      required: ['path'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          image: { type: 'boolean', description: 'A picture format: only `format` is given.' },
          format: { type: 'string' },
          codeset: { type: 'string', description: 'The character set used.' },
          autoCodeset: { type: 'boolean', description: 'It was detected, not chosen.' },
          original: { type: 'array', items: { $ref: 'JobSubtitleCue#' }, description: 'Cues as in the file.' },
          edited: { type: 'array', items: { $ref: 'JobSubtitleCue#' }, description: 'Cues after the edits.' },
          removed: { type: 'integer', description: 'Cues removed by the clean-up.' },
        },
      },
      ...jobErrors,
    },
  },
  'POST /api/jobs/:id/subtitles/write': {
    operationId: 'writeJobSubtitles',
    tags: ['Subtitles'],
    summary: 'Write the subtitle files next to the converted file again',
    description: 'For a converted job: writes the subtitle files to copy next to the converted file again, with the current edits and choices. Files copied before are replaced.',
    params: idParam,
    response: {
      200: {
        type: 'object',
        properties: {
          copied: { type: 'integer', description: 'Number of files written.' },
          errors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, error: { type: 'string' } } } },
        },
      },
      ...jobErrors,
      ...conflict('The job is not done, or the converted file is gone.'),
    },
  },
  'POST /api/queue/start': {
    operationId: 'startQueue',
    tags: ['Queue'],
    summary: 'Start the queue',
    description: 'The queue converts the queued jobs one after the other. When a conversion window is set and closed, it waits for the window to open (`schedule.waiting`) unless `now` is true.',
    body: {
      type: 'object',
      properties: { now: { type: 'boolean', description: 'Ignore the conversion window until the queue is stopped. Missing: false.' } },
    },
    response: { 200: { $ref: 'QueueState#' } },
  },
  'POST /api/queue/stop': {
    operationId: 'stopQueue',
    tags: ['Queue'],
    summary: 'Stop the queue',
    description: 'No new job is taken. The job being converted is not interrupted and finishes.',
    response: { 200: { $ref: 'QueueState#' } },
  },
};

// A cue of a subtitle preview.
schemas.push({
  $id: 'JobSubtitleCue',
  type: 'object',
  properties: {
    start: { type: 'number', description: 'Milliseconds from the start of the video.' },
    end: { type: 'number' },
    text: { type: 'string' },
    src: { type: 'integer', description: 'Index of the cue in the original file.' },
  },
});

export const examples = [
  { method: 'GET', url: '/api/jobs' },
  { method: 'GET', url: '/api/jobs?status=done,failed&tag=sonarr:1234&since=1700000000000&limit=50' },
  { method: 'GET', url: '/api/jobs/1' },
  { method: 'GET', url: '/api/jobs/1/log' },
  { method: 'POST', url: '/api/jobs', body: { paths: ['/mnt/downloads/Film.mkv', '/mnt/downloads/Series'], presetId: 1, position: 'end' } },
  { method: 'POST', url: '/api/jobs', body: { paths: ['/mnt/downloads/Film.mkv'], presetId: null, position: 'next' } },
  { method: 'POST', url: '/api/jobs', body: { paths: ['/mnt/downloads/Film.mkv'], tag: 'sonarr:1234', start: true } },
  { method: 'PATCH', url: '/api/jobs/1', body: { outputPath: '/mnt/converted/Film.mkv' } },
  { method: 'PATCH', url: '/api/jobs/1', body: { presetId: 2 } },
  { method: 'POST', url: '/api/jobs/reorder', body: { ids: [3, 1, 2] } },
  { method: 'POST', url: '/api/jobs/remove', body: { ids: [1] } },
  { method: 'POST', url: '/api/jobs/clear', body: { statuses: ['done', 'failed', 'cancelled'] } },
  { method: 'POST', url: '/api/jobs/1/pause', body: {} },
  { method: 'POST', url: '/api/jobs/1/resume', body: {} },
  { method: 'POST', url: '/api/jobs/1/cancel', body: {} },
  { method: 'POST', url: '/api/jobs/1/retry', body: {} },
  { method: 'POST', url: '/api/jobs/1/again', body: { position: 'end' } },
  { method: 'POST', url: '/api/jobs/1/again', body: { presetId: 2, position: 'end' } },
  { method: 'POST', url: '/api/jobs/1/move', body: { where: 'top' } },
  { method: 'POST', url: '/api/jobs/1/move', body: { where: 'up' } },
  { method: 'POST', url: '/api/jobs/1/move', body: { where: 'down' } },
  { method: 'POST', url: '/api/jobs/1/move', body: { where: 'bottom' } },
  { method: 'POST', url: '/api/jobs/1/verify', body: {} },
  { method: 'POST', url: '/api/jobs/1/convert-now', body: {} },
  { method: 'POST', url: '/api/jobs/1/replace-original', body: { backup: true } },
  { method: 'GET', url: '/api/replace' },
  { method: 'POST', url: '/api/replace', body: { ids: [1, 2, 3], backup: true } },
  { method: 'POST', url: '/api/replace', body: { ids: [1, 2], backup: false, keepConverted: true } },
  { method: 'POST', url: '/api/replace/stop', body: {} },
  { method: 'DELETE', url: '/api/replace' },
  { method: 'POST', url: '/api/jobs/1/replace-original', body: { backup: false } },
  { method: 'POST', url: '/api/jobs', body: { paths: ['/mnt/downloads/Old film.avi'], presetId: 1, position: 'end', origin: 'quality' } },
  { method: 'GET', url: '/api/jobs/1/subtitles' },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { embed: 'missing' } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { embed: null } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { copy: 'notEmbedded' } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { copy: null } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { files: [{ path: '/mnt/downloads/Film.en.srt', include: false }] } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { files: [{ path: '/mnt/downloads/Film.en.srt', lang: 'eng' }] } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { files: [{ path: '/mnt/downloads/Film.en.srt', lang: null }] } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { files: [{ path: '/mnt/downloads/Film.en.srt', forced: true }] } },
  { method: 'PATCH', url: '/api/jobs/1/subtitles', body: { files: [{ path: '/mnt/downloads/Film.en.srt', sdh: true }] } },
  {
    method: 'PATCH',
    url: '/api/jobs/1/subtitles',
    body: { files: [{ path: '/mnt/downloads/Film.en.srt', edits: { offsetMs: 1500, fps: { from: 23.976, to: 25 }, codeset: null, cleanup: { hi: true } } }] },
  },
  {
    method: 'PATCH',
    url: '/api/jobs/1/subtitles',
    body: { files: [{ path: '/mnt/downloads/Film.en.srt', edits: { offsetMs: 0, fps: null, codeset: null, cleanup: {} } }] },
  },
  { method: 'POST', url: '/api/jobs/1/subtitles/detect', body: {} },
  {
    method: 'POST',
    url: '/api/jobs/1/subtitles/preview',
    body: { path: '/mnt/downloads/Film.en.srt', edits: { offsetMs: 0, fps: null, codeset: null, cleanup: {} } },
  },
  { method: 'POST', url: '/api/jobs/1/subtitles/write', body: {} },
  { method: 'POST', url: '/api/queue/start', body: { now: false } },
  { method: 'POST', url: '/api/queue/start', body: { now: true } },
  { method: 'POST', url: '/api/queue/stop', body: {} },
];
