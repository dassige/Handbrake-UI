// Docs of routes.js (status, settings, folders, presets) and automationRoutes.js (stats, watch, notifications).
// Conventions: ../index.js; example: ./auth.js.

const ms = 'Milliseconds since 1970.';

export const schemas = [
  {
    $id: 'Preset',
    type: 'object',
    description: 'A HandBrake preset as listed by the app (without its JSON).',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      category: { type: ['string', 'null'], description: 'The folder the preset is listed under, if any.' },
      description: { type: ['string', 'null'] },
      fileName: { type: ['string', 'null'], description: 'The file it was imported from; null for presets made in the app.' },
      summary: {
        type: 'object',
        description: 'The main settings in words, for lists.',
        properties: {
          format: { type: 'string', description: 'HandBrake container, e.g. av_mkv.' },
          videoEncoder: { type: 'string' },
          videoPreset: { type: ['string', 'null'] },
          quality: { type: ['string', 'null'], description: 'E.g. "RF 22" or "2500 kbps".' },
          qualityType: { type: ['string', 'null'], description: 'target size, avg bitrate or constant quality.' },
          multiPass: { type: 'boolean' },
          maxSize: { type: ['string', 'null'], description: 'Largest picture size, e.g. "1920×1080".' },
          framerate: { type: 'string' },
          audio: { type: 'array', items: { type: 'string' } },
          audioTracks: { type: ['string', 'null'] },
          subtitles: { type: ['string', 'null'] },
        },
      },
      createdAt: { type: 'integer', description: ms },
      updatedAt: { type: ['integer', 'null'], description: ms },
      isDefault: { type: 'boolean', description: 'The preset used when a job names none.' },
    },
  },
  {
    $id: 'Settings',
    type: 'object',
    description: 'The settings of the Settings page. A key not listed here is refused when saving.',
    properties: {
      sourceRoots: { type: 'array', items: { type: 'string' }, description: 'Sources folders (absolute paths, 1 to 20, none inside another).' },
      protectedRoots: { type: 'array', items: { type: 'string' }, description: 'Sources folders whose files cannot be deleted from the app.' },
      sourceNames: { type: 'object', additionalProperties: { type: 'string' }, description: 'Friendly name per sources folder, shown instead of the path (at most 40 characters, unique).' },
      targetRoot: { type: 'string', description: 'Where converted files go. Not inside a sources folder.' },
      outputLayout: { type: 'string', enum: ['parent', 'season', 'mirror', 'flat'], description: 'How the output is placed in the target folder.' },
      recursive: { type: 'boolean', description: 'Adding a folder includes its subfolders.' },
      skipConverted: { type: 'boolean', description: 'Skip files that already have an output.' },
      videoExtensions: { type: 'array', items: { type: 'string' }, description: 'Extensions counted as video, lower case, without a dot.' },
      excludePatterns: { type: 'array', items: { type: 'string' }, description: 'File names containing one of these words are marked excluded (default: sample).' },
      niceLevel: { type: 'integer', minimum: 0, maximum: 19, description: 'CPU priority of the encoder (higher is gentler). Default 10.' },
      defaultPresetId: { type: ['integer', 'null'], description: 'The default preset.' },
      queueRunning: { type: 'boolean', description: 'Whether the queue is started. Normally changed with the queue start/stop operations.' },
      autoRename: { type: 'boolean', description: 'Rename converted files with the rule set autoRenameRuleId.' },
      autoRenameRuleId: { type: ['integer', 'null'] },
      renameSeparator: { type: 'string', description: 'Up to 3 characters, no slashes. Default "_".' },
      verifyMode: { type: 'string', description: 'How a finished file is checked: off, quick or full (default full).' },
      subtitleEmbed: { type: 'string', description: 'Sidecar subtitles: never, missing or always.' },
      subtitleCopy: { type: 'string', description: 'Copy subtitle files next to the output: never, notEmbedded or always.' },
      subtitleExtensions: { type: 'array', items: { type: 'string' }, description: 'Subtitle file extensions looked for.' },
      subtitleCodeset: { type: 'string', description: 'Character set read when a subtitle file is neither UTF-8 nor has a BOM (default windows-1252).' },
      queueSubtitles: {
        type: 'object',
        description: 'Subtitle choices for every job that has none of its own; null follows the settings above.',
        properties: { embed: { type: ['string', 'null'] }, copy: { type: ['string', 'null'] } },
      },
      quality: { type: 'object', description: 'Criteria of the quality checks (bad codecs and containers, minimum height and bitrate).' },
      schedule: {
        type: 'object',
        description: 'The conversion window.',
        properties: {
          enabled: { type: 'boolean' },
          start: { type: 'string', description: 'HH:MM.' },
          end: { type: 'string', description: 'HH:MM; earlier than start means overnight.' },
          days: { type: 'array', items: { type: 'integer' }, description: 'Days the window opens on, 0 = Sunday … 6 = Saturday.' },
          autoStart: { type: 'boolean', description: 'Start the queue when the window opens.' },
        },
      },
      watch: {
        type: 'object',
        description: 'Watch folders.',
        properties: {
          enabled: { type: 'boolean' },
          folders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                presetId: { type: ['integer', 'null'], description: 'null: the default preset.' },
                recursive: { type: 'boolean' },
              },
            },
          },
          settleMinutes: { type: 'integer', description: 'A file is added after this many quiet minutes (1 to 1440).' },
          intervalMinutes: { type: 'integer', description: 'Scan interval (1 to 60).' },
          autoStart: { type: 'boolean', description: 'Start the queue after adding files.' },
        },
      },
      notifications: {
        type: 'object',
        description: 'Webhooks and e-mail. With less than full access, each webhook has headers "" and hasHeaders says whether it has some; the e-mail password is never returned (hasPassword says whether one is set).',
        properties: {
          events: { type: 'object', description: 'Which events notify: queueFinished, jobFailed, checkFailed, jobDone, watchAdded, backupFailed (booleans).' },
          appUrl: { type: 'string', description: 'Shown as a link in messages.' },
          webhooks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                url: { type: 'string' },
                headers: { type: 'string', description: 'One "Name: value" per line.' },
                hasHeaders: { type: 'boolean', description: 'Only in answers.' },
                events: { type: ['object', 'null'], description: 'null: use the general events.' },
              },
            },
          },
          email: { type: 'object', description: 'enabled, host, port, security (starttls, tls, none), user, from, to.' },
        },
      },
      backupSchedule: { type: 'object', description: 'Scheduled backups.' },
      language: { type: 'string', enum: ['auto', 'en', 'it', 'de', 'fr', 'es'], description: 'Language of the web app; auto follows the browser.' },
    },
  },
  {
    $id: 'BrowseResult',
    type: 'object',
    description: 'One folder, with its content.',
    properties: {
      root: { type: 'string', description: 'The configured folder this one is under.' },
      path: { type: 'string', description: 'The folder listed (absolute).' },
      parent: { type: ['string', 'null'], description: 'null at the root.' },
      crumbs: {
        type: 'array',
        description: 'From the root down to this folder.',
        items: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } } },
      },
      items: {
        type: 'array',
        description: 'Folders first, then files, each in natural order.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
            type: { type: 'string', enum: ['dir', 'file'] },
            size: { type: 'integer', description: 'Files only, bytes.' },
            mtime: { type: 'number', description: ms },
            excluded: { type: 'boolean', description: 'Files only: the name matches an exclude pattern.' },
            subtitles: {
              type: 'array',
              description: 'Source listings only: subtitle files next to the video.',
              items: { type: 'object', properties: { lang: { type: ['string', 'null'] }, forced: { type: 'boolean' }, sdh: { type: 'boolean' }, format: { type: 'string' } } },
            },
            jobs: { type: ['object', 'string', 'null'], description: 'Source listings only: job status of the file (a status), or counts for a folder; null if none.' },
          },
        },
      },
    },
  },
];

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const ok = { 200: { description: 'Done.', $ref: 'Ok#' } };
const notFound = { description: 'No such preset.', $ref: 'Error#' };
const handbrakeInfo = {
  type: 'object',
  description: 'HandBrakeCLI: version and usable video encoders, or an error when it is missing.',
  properties: {
    version: { type: 'string' },
    encoders: { type: 'array', items: { type: 'string' } },
    error: { type: 'string', description: 'Present instead of the above when HandBrakeCLI cannot be run.' },
  },
};
const presetNames = {
  name: { type: 'string', description: 'Required to create; at most 120 characters, no / or \\. Unique within its category.' },
  category: { type: ['string', 'null'], description: 'Folder to list the preset under; empty or null for none.' },
  description: { type: ['string', 'null'] },
  version: { type: ['object', 'null'], description: 'The HandBrake format version that came with the preset (VersionMajor, VersionMinor, VersionMicro).' },
};
const idName = { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } };

export const paths = {
  'GET /api/info': {
    operationId: 'getInfo',
    tags: ['Status'],
    summary: 'Versions, queue state and clock',
    description: 'What the web app asks first: version numbers, HandBrake, the queue state and the server clock (the conversion window follows it).',
    response: {
      200: {
        type: 'object',
        properties: {
          app: { type: 'object', description: 'The EncForge version.' },
          server: { type: 'object', description: 'The server package version.' },
          handbrake: handbrakeInfo,
          queue: { type: 'object', description: 'Queue state: running, activeJobId, counts per status, schedule (enabled, open, nextStart, closesAt), speeds.' },
          time: {
            type: 'object',
            properties: {
              zone: { type: 'string', description: 'IANA time zone of the server.' },
              offset: { type: 'integer', description: 'Minutes east of UTC.' },
              now: { type: 'integer', description: ms },
            },
          },
        },
      },
    },
  },
  'GET /api/about': {
    operationId: 'getAbout',
    tags: ['Status'],
    summary: 'About this installation',
    description: 'Author, licence, release notes and where the server runs.',
    response: {
      200: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          author: { type: 'string' },
          license: { type: 'string' },
          licenseText: { type: ['string', 'null'] },
          repositoryUrl: { type: 'string' },
          releaseNotesUrl: { type: 'string' },
          releasesUrl: { type: 'string' },
          versions: { type: 'object' },
          releases: {
            type: 'array',
            description: 'Latest releases, newest first.',
            items: { type: 'object', properties: { version: { type: 'string' }, date: { type: ['string', 'null'] }, notes: { type: 'array', items: { type: 'string' } } } },
          },
          runtime: {
            type: 'object',
            properties: { node: { type: 'string' }, os: { type: 'string' }, docker: { type: 'boolean' }, dataDir: { type: 'string' } },
          },
          handbrake: handbrakeInfo,
        },
      },
    },
  },
  'GET /api/health': {
    operationId: 'getHealth',
    tags: ['Status'],
    summary: 'Health check',
    description: 'Answers `{ "ok": true }` whenever the server is up, also when login is on. For Docker or monitoring.',
    response: ok,
  },
  'GET /api/events': {
    operationId: 'streamEvents',
    tags: ['Status'],
    summary: 'Live event stream',
    description: [
      'A Server-Sent Events stream that never ends. Each message has an `event:` name and a JSON `data:` payload; a `: ping` comment is sent every 25 seconds, and the client is told to retry after 3 seconds. The stream is closed when login settings change, so reconnect.',
      '',
      'Events:',
      '- `job`: one job, as in the jobs list, after any change to it.',
      '- `jobs`: the jobs list changed (no payload; fetch it again).',
      '- `progress`: `{ id, progress, fps, eta, phase }` of the running job (phase `verifying` or `muxing` at the end; `verifyProgress` while re-checking). For a merge: `{ mergeId, progress, phase }`.',
      '- `queue`: the queue state (as `queue` in /api/info); `finished` is added when the queue has just finished.',
      '- `settings`: the settings after a save. Below full access the webhook headers are blanked.',
      '- `presets`, `renameRules`, `renameHistory`, `merges`, `qualityScans`, `namingChecks`: that list changed (no payload).',
      '- `merge`, `qualityScan`, `namingCheck`: one item changed, `{ id, status }` or the item itself; `qualityProgress` and `namingProgress`: `{ id, ...progress }` of the running check.',
      '- `watch`: the watch folder status (as GET /api/watch).',
      '- `backupSchedule`: the scheduled backup status.',
      '- `files`: files were uploaded or deleted: `{ dir }` or `{ deleted }`.',
      '- `auth`: login state changed.',
    ].join('\n'),
    response: { 200: { description: 'An open `text/event-stream`.', content: { 'text/event-stream': { schema: { type: 'string' } } } } },
  },
  'GET /api/settings': {
    operationId: 'getSettings',
    tags: ['Settings'],
    summary: 'Read the settings',
    description: 'Below full access (any API key but a full one), the webhook headers are blanked: each webhook has `headers: ""` and `hasHeaders` says whether it has some. The e-mail password is never returned (`hasPassword` says whether one is saved).',
    response: { 200: { $ref: 'Settings#' } },
  },
  'PUT /api/settings': {
    operationId: 'updateSettings',
    tags: ['Settings'],
    summary: 'Change settings',
    description: [
      'A partial update: send only the keys to change (see Settings for the keys). An unknown key, or a value that is not valid, answers 400 with the reason and nothing is saved.',
      'Folder paths must exist on the server. Nested objects (`quality`, `schedule`, `watch`, `notifications`, `backupSchedule`, `queueSubtitles`) are sent whole, not as single sub-keys. In `notifications.email`, leaving out `password` keeps the saved one.',
      'Answers with the settings as saved (as GET /api/settings) and sends a `settings` event.',
    ].join('\n\n'),
    body: { type: 'object', description: 'Any of the keys of Settings.' },
    response: { 200: { $ref: 'Settings#' }, 400: { description: 'Invalid value or unknown key.', $ref: 'Error#' }, 404: { description: 'autoRenameRuleId or a watch folder preset does not exist.', $ref: 'Error#' } },
  },
  'GET /api/browse': {
    operationId: 'browseFolder',
    tags: ['Folders'],
    summary: 'List a folder',
    description: [
      'Lists one folder under the configured folders; any other path is refused (400).',
      '`root` says which: `source` (default; also for any unknown value): the sources folders, with folders and video files, subtitle files and job status; `target`: the target folder, with every file; `any`: sources and target, folders and video files.',
      '`path` is an absolute path; without it the first folder of that kind is listed. Hidden names are left out.',
    ].join('\n\n'),
    querystring: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'source, target or any.' },
        path: { type: 'string', description: 'Absolute folder path.' },
      },
    },
    response: { 200: { $ref: 'BrowseResult#' }, 400: { description: 'Not a folder, or outside the configured folders.', $ref: 'Error#' } },
  },
  'GET /api/presets': {
    operationId: 'listPresets',
    tags: ['Presets'],
    summary: 'List presets',
    description: 'Uncategorised presets first, then by category and name.',
    response: { 200: { type: 'array', items: { $ref: 'Preset#' } } },
  },
  'GET /api/presets/options': {
    operationId: 'getPresetOptions',
    tags: ['Presets'],
    summary: 'Encoders and choices for the preset editor',
    description: 'The encoders and option lists of the installed HandBrakeCLI, or a built-in fallback list when it is missing. The shape follows HandBrake and may change with it.',
    response: { 200: { type: 'object', description: 'Encoders, mixdowns, framerates and other option lists.' } },
  },
  'GET /api/presets/builtin': {
    operationId: 'listBuiltinPresets',
    tags: ['Presets'],
    summary: 'HandBrake’s built-in presets',
    description: 'To start a new preset from (see POST /api/presets/new). `available` is false when HandBrakeCLI is not installed.',
    response: {
      200: {
        type: 'object',
        properties: {
          available: { type: 'boolean' },
          presets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, category: { type: ['string', 'null'] }, description: { type: ['string', 'null'] } } } },
        },
      },
    },
  },
  'GET /api/presets/:id': {
    operationId: 'getPreset',
    tags: ['Presets'],
    summary: 'One preset, with its JSON',
    params: idParam,
    response: {
      200: {
        description: 'The preset with `json`: the HandBrake preset file as an object (`PresetList`, version keys).',
        allOf: [{ $ref: 'Preset#' }, { type: 'object', properties: { json: { type: 'object' } } }],
      },
      404: notFound,
    },
  },
  'GET /api/presets/:id/editable': {
    operationId: 'getEditablePreset',
    tags: ['Presets'],
    summary: 'A preset ready for editing',
    description: 'The preset converted to the installed HandBrake’s format with every setting filled in (without HandBrakeCLI: filled from a template). Send `preset` and `version` back to PUT /api/presets/{id}.',
    params: idParam,
    response: {
      200: {
        allOf: [
          { $ref: 'Preset#' },
          { type: 'object', properties: { preset: { type: 'object', description: 'One HandBrake preset.' }, version: { type: 'object', description: 'VersionMajor, VersionMinor, VersionMicro.' } } },
        ],
      },
      404: notFound,
    },
  },
  'POST /api/presets/new': {
    operationId: 'createPreset',
    tags: ['Presets'],
    summary: 'Make a preset',
    description: 'Its settings come from `builtin` (name of a HandBrake built-in preset), `fromId` (a copy of one of ours) or `preset` (a full preset from the editor, with `version`). The first preset made becomes the default. 409 when the name is taken in that category.',
    body: {
      type: 'object',
      properties: {
        ...presetNames,
        builtin: { type: ['string', 'null'], description: 'A name from GET /api/presets/builtin.' },
        fromId: { type: ['integer', 'null'], description: 'Id of a preset to copy.' },
        preset: { type: ['object', 'null'], description: 'A HandBrake preset (from GET /api/presets/{id}/editable).' },
      },
      required: ['name'],
    },
    response: { 200: idName, 400: { description: 'Missing name or unusable settings.', $ref: 'Error#' }, 409: { description: 'Name taken, or no HandBrakeCLI for a built-in preset.', $ref: 'Error#' } },
  },
  'PUT /api/presets/:id': {
    operationId: 'updatePreset',
    tags: ['Presets'],
    summary: 'Change a preset',
    description: 'Send `preset` (with `version`) to change its settings, and/or `name`, `category`, `description`. Left-out properties stay. Jobs already queued keep their own copy of the preset.',
    params: idParam,
    body: {
      type: 'object',
      properties: { ...presetNames, preset: { type: ['object', 'null'], description: 'A full HandBrake preset, as from GET /api/presets/{id}/editable.' } },
    },
    response: { 200: idName, 400: { $ref: 'Error#' }, 404: notFound, 409: { description: 'Name taken in that category.', $ref: 'Error#' } },
  },
  'POST /api/presets': {
    operationId: 'importPresets',
    tags: ['Presets'],
    summary: 'Import a preset file',
    description: 'A HandBrake preset export (`PresetList`, possibly with folders). A preset with the same name and category replaces the existing one.',
    body: {
      type: 'object',
      properties: {
        fileName: { type: ['string', 'null'], description: 'Name of the file, kept for display.' },
        content: { description: 'The file’s content: the JSON text, or the parsed object.' },
      },
    },
    response: {
      200: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, action: { type: 'string', enum: ['added', 'updated'] } } },
      },
      400: { description: 'Not valid JSON, not a preset file, or rejected by HandBrake.', $ref: 'Error#' },
    },
  },
  'GET /api/presets/:id/export': {
    operationId: 'exportPreset',
    tags: ['Presets'],
    summary: 'Download a preset file',
    description: 'The preset as a JSON file HandBrake (desktop or CLI) can import, sent as an attachment named after the preset.',
    params: idParam,
    response: {
      200: { description: 'A HandBrake preset file.', content: { 'application/json': { schema: { type: 'string' } } } },
      404: notFound,
    },
  },
  'POST /api/presets/:id/default': {
    operationId: 'setDefaultPreset',
    tags: ['Presets'],
    summary: 'Make a preset the default',
    params: idParam,
    response: { ...ok, 404: notFound },
  },
  'DELETE /api/presets/:id': {
    operationId: 'deletePreset',
    tags: ['Presets'],
    summary: 'Delete a preset',
    description: 'If it was the default, another preset takes over. Queued jobs keep their own copy.',
    params: idParam,
    response: { ...ok, 404: notFound },
  },
  'GET /api/stats': {
    operationId: 'getStats',
    tags: ['Automation'],
    summary: 'Conversion statistics',
    description: 'Totals, per preset, a time series and the biggest savings, from finished jobs. `days` is the period: 7, 30 (default), 90, 365 or 0 for everything; any whole number 0 to 3650 is accepted.',
    querystring: { type: 'object', properties: { days: { type: 'integer', description: 'Period in days; 0 = everything. Default 30.' } } },
    response: {
      200: {
        type: 'object',
        properties: {
          days: { type: 'integer' },
          since: { type: ['integer', 'null'], description: ms },
          firstAt: { type: ['integer', 'null'], description: 'When the first job finished (ms).' },
          totals: {
            type: 'object',
            description: 'Figures of the finished jobs. speed is x real time; reduction is 0 to 1.',
            properties: {
              done: { type: 'integer' },
              failed: { type: 'integer' },
              cancelled: { type: 'integer' },
              sourceBytes: { type: 'number' },
              outputBytes: { type: 'number' },
              savedBytes: { type: 'number' },
              mediaSeconds: { type: 'number' },
              encodeSeconds: { type: 'number' },
              avgFps: { type: ['number', 'null'] },
              speed: { type: ['number', 'null'] },
              reduction: { type: ['number', 'null'] },
            },
          },
          checks: { type: 'object', description: 'Finished jobs per verification result (e.g. ok, off).', additionalProperties: { type: 'integer' } },
          watched: { type: 'integer', description: 'Jobs that came from a watch folder.' },
          presets: { type: 'array', description: 'Per preset: name and the same figures as totals.', items: { type: 'object', properties: { name: { type: 'string' } } } },
          bucket: { type: 'string', enum: ['day', 'month'], description: 'Size of the series steps.' },
          series: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, done: { type: 'integer' }, failed: { type: 'integer' }, savedBytes: { type: 'number' }, encodeSeconds: { type: 'number' } } } },
          top: { type: 'array', description: 'The five biggest savings.', items: { type: 'object', properties: { path: { type: 'string' }, output: { type: ['string', 'null'] }, sourceSize: { type: 'number' }, outputSize: { type: 'number' }, saved: { type: 'number' } } } },
        },
      },
      400: { description: 'days is not a whole number from 0 to 3650.', $ref: 'Error#' },
    },
  },
  'GET /api/watch': {
    operationId: 'getWatchStatus',
    tags: ['Automation'],
    summary: 'Watch folder status',
    response: {
      200: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          scanning: { type: 'boolean' },
          lastScanAt: { type: ['integer', 'null'], description: ms },
          nextScanAt: { type: ['integer', 'null'], description: ms },
          errors: { type: 'array', description: 'Problems of the last scan (e.g. a folder that cannot be read).', items: {} },
          pending: {
            type: 'array',
            description: 'New files waiting to settle before they are added.',
            items: { type: 'object', properties: { path: { type: 'string' }, folder: { type: 'string' }, size: { type: 'number' }, firstSeen: { type: 'integer' }, readyAt: { type: 'integer', description: ms } } },
          },
          recent: {
            type: 'array',
            description: 'The last 20 decisions.',
            items: { type: 'object', properties: { path: { type: 'string' }, folder: { type: 'string' }, at: { type: 'integer' }, action: { type: 'string' }, jobId: { type: ['integer', 'null'] }, note: { type: ['string', 'null'] } } },
          },
        },
      },
    },
  },
  'POST /api/watch/scan': {
    operationId: 'scanWatchFolders',
    tags: ['Automation'],
    summary: 'Scan the watch folders now',
    description: 'Runs a scan without waiting for the interval and answers when it is done.',
    response: { 200: { type: 'object', properties: { added: { type: 'integer', description: 'Jobs added by this scan.' }, status: { type: 'object', description: 'As GET /api/watch.' } } } },
  },
  'GET /api/notifications/recent': {
    operationId: 'listRecentNotifications',
    tags: ['Automation'],
    summary: 'Recent notifications',
    description: 'The last 30 deliveries (kept in memory until the server restarts), newest first.',
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            at: { type: 'integer', description: ms },
            channel: { type: 'string', enum: ['webhook', 'email'] },
            target: { type: ['string', 'null'], description: 'The webhook’s name.' },
            event: { type: 'string' },
            title: { type: 'string' },
            ok: { type: 'boolean' },
            error: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
  'POST /api/notifications/test': {
    operationId: 'testNotification',
    tags: ['Automation'],
    summary: 'Send a test notification',
    description: 'Sends a test message through one channel using the `notifications` settings in the body, which need not be saved (a left-out e-mail password uses the saved one). Answers 400 with the reason when delivery fails.',
    body: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'webhook or email.' },
        notifications: { type: ['object', 'null'], description: 'The notifications settings to test (see Settings).' },
        webhookId: { type: ['string', 'null'], description: 'For a webhook: its id, or its position as "#0", "#1"…' },
      },
    },
    response: {
      200: { type: 'object', description: 'The delivery, as in /api/notifications/recent.', properties: { at: { type: 'integer' }, channel: { type: 'string' }, ok: { type: 'boolean', const: true } } },
      400: { description: 'Unknown channel or webhook, or delivery failed.', $ref: 'Error#' },
    },
  },
};

const preset = { PresetName: 'Mine', VideoEncoder: 'x265' };
const version = { VersionMajor: 61, VersionMinor: 0, VersionMicro: 0 };

export const examples = [
  { method: 'GET', url: '/api/info' },
  { method: 'GET', url: '/api/about' },
  { method: 'GET', url: '/api/health' },
  { method: 'GET', url: '/api/settings' },
  { method: 'PUT', url: '/api/settings', body: { outputLayout: 'season', niceLevel: 10, recursive: true, defaultPresetId: null } },
  { method: 'PUT', url: '/api/settings', body: { watch: { enabled: true, folders: [{ path: '/mnt/downloads/tv', presetId: null, recursive: true }], settleMinutes: 10, intervalMinutes: 2, autoStart: true } } },
  { method: 'PUT', url: '/api/settings', body: { queueSubtitles: { embed: null, copy: 'always' } } },
  { method: 'GET', url: '/api/browse?root=source' },
  { method: 'GET', url: '/api/browse?root=any&path=%2Fmnt%2Fdownloads' },
  { method: 'GET', url: '/api/browse?root=target&path=%2Fmnt%2Foutput%2FFilms' },
  { method: 'GET', url: '/api/presets' },
  { method: 'GET', url: '/api/presets/options' },
  { method: 'GET', url: '/api/presets/builtin' },
  { method: 'GET', url: '/api/presets/4' },
  { method: 'GET', url: '/api/presets/4/editable' },
  { method: 'POST', url: '/api/presets/new', body: { name: 'Custom Fast 1080p30', category: '', description: '', builtin: 'Fast 1080p30' } },
  { method: 'POST', url: '/api/presets/new', body: { name: 'Copy of Mine', category: 'Mine', description: 'A copy', fromId: 4 } },
  { method: 'POST', url: '/api/presets/new', body: { preset, version, name: 'Mine 2', category: null, description: null } },
  { method: 'PUT', url: '/api/presets/4', body: { preset, version, name: 'Mine', category: null, description: 'Better' } },
  { method: 'POST', url: '/api/presets', body: { fileName: 'mine.json', content: JSON.stringify({ PresetList: [preset], ...version }) } },
  { method: 'GET', url: '/api/presets/4/export' },
  { method: 'POST', url: '/api/presets/4/default', body: {} },
  { method: 'DELETE', url: '/api/presets/4' },
  { method: 'GET', url: '/api/stats?days=30' },
  { method: 'GET', url: '/api/stats?days=0' },
  { method: 'GET', url: '/api/watch' },
  { method: 'POST', url: '/api/watch/scan', body: {} },
  { method: 'GET', url: '/api/notifications/recent' },
  { method: 'POST', url: '/api/notifications/test', body: { channel: 'email', notifications: { events: { jobFailed: true }, appUrl: '', webhooks: [], email: { enabled: true, host: 'smtp.example.com', port: 587, security: 'starttls', user: '', from: '', to: 'me@example.com' } } } },
  { method: 'POST', url: '/api/notifications/test', body: { channel: 'webhook', notifications: { webhooks: [{ id: 'webhook-1', name: 'Hook', enabled: true, url: 'https://example.com/hook', headers: '', events: null }] }, webhookId: '#0' } },
];
