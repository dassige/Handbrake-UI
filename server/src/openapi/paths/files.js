// Docs of uploadRoutes.js, downloadRoutes.js and backupRoutes.js. Conventions: ../index.js.

const countsSchema = {
  type: 'object',
  description: 'How many records of each kind a database holds.',
  properties: {
    presets: { type: 'integer' },
    renameRules: { type: 'integer', description: 'Your own rename rule sets (built-in ones are not counted).' },
    jobs: { type: 'integer' },
    renameHistory: { type: 'integer' },
    merges: { type: 'integer' },
    qualityScans: { type: 'integer' },
    namingChecks: { type: 'integer' },
  },
};

export const schemas = [
  {
    $id: 'Backup',
    type: 'object',
    description: 'A backup file kept on the server.',
    properties: {
      name: { type: 'string', description: 'File name, e.g. `manual-2026-11-12-101010.zip`. Use it in the `/api/backup/snapshots/{name}` or `/api/backup/scheduled/{name}` routes.' },
      size: { type: 'integer', description: 'Bytes.' },
      createdAt: { type: 'number', description: 'Milliseconds since 1970 (the file’s modification time).' },
      reason: { type: 'string', enum: ['manual', 'before-restore', 'scheduled'], description: 'manual: made with “Save on server”; before-restore: made automatically before a restore, as an undo point; scheduled: made by the schedule.' },
    },
  },
  {
    $id: 'BackupInspection',
    type: 'object',
    description: 'What a backup holds, compared with the current data, and what to know before restoring it.',
    properties: {
      source: { type: 'string', description: 'The backup’s id, to pass to `POST /api/backup/restore`: `upload:<uuid>` for an uploaded file, `snapshot:<name>` or `scheduled:<name>`.' },
      manifest: {
        type: 'object',
        description: 'The backup’s manifest.json.',
        properties: {
          app: { type: 'string', description: '`encforge` (or `handbrake-ui` for backups from before the rename).' },
          format: { type: 'integer' },
          createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
          versions: { type: 'object', description: 'Versions of the app and tools that made it.' },
          logs: { type: ['integer', 'null'], description: 'How many job logs it holds; null when logs were left out.' },
          counts: countsSchema,
        },
      },
      counts: { ...countsSchema, description: 'What the backup holds.' },
      logs: { type: 'integer', description: 'Job logs in the backup.' },
      current: { ...countsSchema, description: 'What the server holds now.' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Things to know before restoring, in English (e.g. a folder of the backup that does not exist here).' },
      missingFolders: { type: 'array', items: { type: 'string' }, description: 'The sources or target folders of the backup that do not exist on this server.' },
      busy: { type: ['string', 'null'], description: 'Why a full restore (scope `all`) cannot run now, in English; null when it can.' },
      busyCode: { type: ['string', 'null'], enum: ['conversion', 'merge', 'quality', 'naming', 'upload', null], description: 'The same reason, as a code.' },
    },
  },
  {
    $id: 'ScheduledBackupRun',
    type: 'object',
    description: 'The outcome of the latest scheduled backup (since the server started).',
    properties: {
      at: { type: 'integer', description: 'Milliseconds since 1970.' },
      ok: { type: 'boolean' },
      error: { type: ['string', 'null'] },
      name: { type: ['string', 'null'], description: 'File name of the backup made.' },
      size: { type: ['integer', 'null'] },
      folder: { type: 'string' },
    },
  },
  {
    $id: 'ScheduledBackupStatus',
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'The schedule is turned on (Settings → Backup).' },
      folder: { type: 'string', description: 'The folder scheduled backups go to (on the server).' },
      running: { type: 'boolean', description: 'A backup is being made now.' },
      nextAt: { type: ['integer', 'null'], description: 'When the next backup is due, ms since 1970; null when the schedule is off.' },
      last: { anyOf: [{ $ref: 'ScheduledBackupRun#' }, { type: 'null' }] },
      retryAt: { type: ['integer', 'null'], description: 'After a failure: when it will be tried again.' },
      backups: { type: 'array', items: { $ref: 'Backup#' }, description: 'The scheduled backups in the folder, newest first.' },
    },
  },
  {
    $id: 'DeleteBlocked',
    type: 'object',
    description: 'Something that cannot be deleted.',
    properties: {
      path: { type: 'string' },
      reason: { type: 'string', description: 'Why, in English.' },
      code: { type: 'string', description: 'protected, sourcesFolder, pendingFile or pendingFiles; absent when the path is outside the sources folders or does not exist.' },
      params: { type: 'object', description: 'Values for wording the reason (root, name, count).' },
    },
  },
];

const zipFile = (description) => ({ description, content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } });
const ok = { 200: { description: 'Done.', $ref: 'Ok#' } };
const backupName = 'The file name from the list (letters, digits, `.`, `_`, `-`, ending in `.zip`).';
const scheduledName = 'The file name from the list; scheduled backups start with `scheduled-`.';

export const paths = {
  // ---------------------------------------------------------------- uploads
  'POST /api/upload/check': {
    operationId: 'checkUpload',
    tags: ['Uploads'],
    summary: 'Check files before uploading',
    description: [
      'Step 1 of an upload. Tells, for each file, whether a file with that name is already in the folder and how many bytes of an earlier, interrupted upload of the same file are kept.',
      '',
      '**The upload protocol.** Only video files and subtitle files (the extensions in Settings) are accepted. A file goes into a folder inside the sources folders, in chunks of at most 64 MiB:',
      '1. `POST /api/upload/check` with the folder and the files’ names and sizes. `partial` is the resume point.',
      '2. `PUT /api/upload?dir=…&name=…&size=…&offset=…` with the next chunk as the raw body, starting with `offset` = `partial` (0 for a new file). The answer has the new `offset`; send the next chunk from there. Chunks of one file must be sent one after the other, in order: a chunk whose `offset` is not what the server holds is refused (409).',
      '3. The answer to the chunk that ends the file has `done: true` and the final `path`. The file is never replaced: if the name is taken, it is saved as `name (1).mkv`.',
      '',
      'A file is identified by folder, name and total size, so repeating the check after a failure gives the resume point. Partial uploads are kept for a week; `POST /api/upload/discard` throws one away.',
    ].join('\n'),
    body: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Absolute path of the destination folder, inside a sources folder.' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'File name only (no slashes, not starting with a dot).' },
              size: { type: 'integer', description: 'Total size of the file in bytes.' },
            },
          },
        },
      },
      required: ['dir', 'files'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'The folder, as the server resolved it.' },
          freeBytes: { type: ['integer', 'null'], description: 'Free space in that folder; null when unknown.' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                size: { type: 'integer' },
                exists: { type: 'boolean', description: 'A file of that name is already in the folder (the upload would be saved under another name).' },
                partial: { type: 'integer', description: 'Bytes of an interrupted upload kept on the server: the `offset` to resume from; 0 when none.' },
                error: { type: 'string', description: 'Present instead of exists/partial when this file cannot be uploaded (not a video or subtitle file, bad name).' },
              },
            },
          },
        },
      },
      400: { description: 'No files, a folder outside the sources folders, or an invalid size.', $ref: 'Error#' },
    },
  },
  'PUT /api/upload': {
    operationId: 'uploadChunk',
    tags: ['Uploads'],
    summary: 'Upload one chunk of a file',
    description: 'Step 2 of an upload (see `POST /api/upload/check` for the whole protocol). The body is the raw bytes of the chunk, at most 64 MiB, and no more than `size - offset`. `offset` must be the number of bytes the server already holds for this file (0 for a new file), or the chunk is refused with 409 and the message tells where the upload is. Only one chunk of a file can be in flight at a time.',
    querystring: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Absolute path of the destination folder.' },
        name: { type: 'string', description: 'File name.' },
        size: { type: 'integer', description: 'Total size of the file in bytes (not of the chunk).' },
        offset: { type: 'integer', description: 'Where this chunk starts, in bytes.' },
      },
      required: ['dir', 'name', 'size', 'offset'],
    },
    docBody: { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
    response: {
      200: {
        description: 'While the file is incomplete: `{ offset }`, the bytes held now. After the last byte: `{ done: true, path, offset }`.',
        type: 'object',
        properties: {
          offset: { type: 'integer', description: 'Bytes of the file on the server; the next chunk starts here.' },
          done: { type: 'boolean', description: 'Present (true) when the file is complete.' },
          path: { type: 'string', description: 'The final path of the file (present when done).' },
        },
      },
      400: { description: 'Bad folder or name, not a video or subtitle file, bad offset, chunk too large, or more data than the file size.', $ref: 'Error#' },
      409: { description: 'The offset is not where the upload is, or this file already has a chunk in flight.', $ref: 'Error#' },
    },
  },
  'POST /api/upload/discard': {
    operationId: 'discardUpload',
    tags: ['Uploads'],
    summary: 'Throw away a partial upload',
    description: 'Deletes the bytes kept for an interrupted upload of this file (same folder, name and size as in the upload). Does nothing if there are none. Refused (409) while a chunk is being written.',
    body: {
      type: 'object',
      properties: {
        dir: { type: 'string' },
        name: { type: 'string' },
        size: { type: 'integer', description: 'Total size of the file in bytes.' },
      },
      required: ['dir', 'name', 'size'],
    },
    response: { 200: { description: 'Done.', $ref: 'Ok#' }, 409: { $ref: 'Error#' } },
  },

  // ---------------------------------------------------------------- folders, deleting
  'POST /api/folders': {
    operationId: 'createFolder',
    tags: ['Folders'],
    summary: 'Make a folder',
    description: 'Creates a folder inside a sources folder. The name is a plain name: no slashes, not starting with a dot. 409 when it already exists.',
    body: {
      type: 'object',
      properties: {
        parent: { type: 'string', description: 'Absolute path of the folder to make it in.' },
        name: { type: 'string', description: 'Name of the new folder.' },
      },
      required: ['parent', 'name'],
    },
    response: {
      200: { type: 'object', properties: { path: { type: 'string', description: 'The new folder.' } } },
      400: { $ref: 'Error#' },
      409: { description: 'It already exists.', $ref: 'Error#' },
    },
  },
  'POST /api/files/delete/preview': {
    operationId: 'previewDeleteFiles',
    tags: ['Folders'],
    summary: 'What deleting would remove',
    description: [
      'Changes nothing. Checks the chosen files and folders and says what `POST /api/files/delete` would remove and what it would refuse. At most 1000 paths.',
      '',
      'Never deleted (listed in `blocked`): anything outside the sources folders (so never the target folder), a sources folder itself, anything in a protected sources folder (Settings → Folders), and files that are queued or converting (or folders holding some).',
      'Deleting a video also removes its subtitle files next to it (listed as items with `sidecarOf`). A folder is removed with everything in it; items inside a chosen folder are not listed separately.',
    ].join('\n'),
    body: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files and folders.' } },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'What would be deleted.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                type: { type: 'string', enum: ['file', 'dir'] },
                files: { type: 'integer', description: 'Files in it (1 for a file).' },
                bytes: { type: 'integer' },
                sidecarOf: { type: 'string', description: 'For a subtitle file that goes with a chosen video: that video.' },
              },
            },
          },
          blocked: { type: 'array', items: { $ref: 'DeleteBlocked#' }, description: 'What would be left alone, with the reason.' },
          files: { type: 'integer', description: 'Total files in items.' },
          bytes: { type: 'integer', description: 'Total bytes in items.' },
        },
      },
      400: { description: 'No paths, or more than 1000.', $ref: 'Error#' },
    },
  },
  'POST /api/files/delete': {
    operationId: 'deleteFiles',
    tags: ['Folders'],
    summary: 'Delete files and folders',
    description: 'Deletes for good (no recycle bin) what `POST /api/files/delete/preview` says can go, checking everything again first. What is refused comes back in `blocked`; a failure on one item (e.g. permissions) is in `errors` and does not stop the others. See the preview for what is protected and what goes along with a video.',
    body: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files and folders.' } },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          deleted: { type: 'array', items: { type: 'string' }, description: 'Paths removed.' },
          blocked: { type: 'array', items: { $ref: 'DeleteBlocked#' } },
          errors: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, reason: { type: 'string' } } } },
        },
      },
      400: { description: 'No paths, or more than 1000.', $ref: 'Error#' },
    },
  },

  // ---------------------------------------------------------------- downloads
  'GET /api/download': {
    operationId: 'downloadFile',
    tags: ['Downloads'],
    summary: 'Download one file',
    description: 'Sends one file from a sources folder or the target folder as `application/octet-stream` (as an attachment). Supports `Range` and `If-Range` (answers 206 with `Content-Range`, 416 for a range outside the file), so an interrupted download can resume; `ETag` and `Last-Modified` are sent. A folder is refused: use the ZIP routes.',
    querystring: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path of the file.' } },
      required: ['path'],
    },
    response: {
      200: { description: 'The file’s bytes.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
      206: { description: 'The requested range of the file.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
      400: { description: 'Not a file, or outside the allowed folders.', $ref: 'Error#' },
      416: { description: 'Range not satisfiable.' },
    },
  },
  'POST /api/download/subtitles': {
    operationId: 'findDownloadSubtitles',
    tags: ['Downloads'],
    summary: 'Subtitle files that go with videos',
    description: 'For the chosen video files, lists the subtitle files that would be downloaded along with them: in a sources folder every sidecar found (the Subs folder included), in the target folder the files named after the video. Folders in the list are skipped (everything in them is downloaded anyway). Empty when subtitle handling is off.',
    body: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files and folders.' } },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          files: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } }, description: 'Video path to the paths of its subtitle files; videos without any are left out.' },
          count: { type: 'integer', description: 'Subtitle files in total.' },
        },
      },
      400: { $ref: 'Error#' },
    },
  },
  'POST /api/download/zip': {
    operationId: 'prepareZipDownload',
    tags: ['Downloads'],
    summary: 'Prepare a ZIP download',
    description: 'Step 1 of downloading several files or folders as one ZIP: lists everything in the chosen paths (hidden files and `.part` files left out; at most 10 000 files) and keeps the plan under an `id`. Then `GET /api/download/zip/{id}` streams it. The ZIP is built on the fly, not compressed (the size is known in advance), and uses ZIP64 for large content. The id is valid for 6 hours and can be fetched again; at most 50 are kept.',
    body: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files and folders.' },
        name: { type: ['string', 'null'], description: 'Name of the ZIP, without `.zip`. When omitted: the name of the one chosen item, or of the folder that holds them all.' },
        withSubtitles: { type: ['boolean', 'null'], description: 'Also add the chosen videos’ subtitle files (see `POST /api/download/subtitles`). False when omitted.' },
      },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'For `GET /api/download/zip/{id}`.' },
          name: { type: 'string', description: 'File name of the ZIP.' },
          files: { type: 'integer', description: 'Files in the ZIP.' },
          size: { type: 'integer', description: 'Exact size of the ZIP in bytes.' },
          contentSize: { type: 'integer', description: 'Bytes of the files inside.' },
          subtitles: { type: 'integer', description: 'Subtitle files added.' },
          subtitlePaths: { type: 'array', items: { type: 'string' } },
        },
      },
      400: { description: 'Nothing chosen, nothing in it, or too many files.', $ref: 'Error#' },
    },
  },
  'GET /api/download/zip/:id': {
    operationId: 'downloadZip',
    tags: ['Downloads'],
    summary: 'Download a prepared ZIP',
    description: 'Streams the ZIP prepared by `POST /api/download/zip`, as `application/zip` with the exact `Content-Length`. Ranges are not supported; start again if it fails.',
    params: { type: 'object', properties: { id: { type: 'string', description: 'The `id` from the prepare call.' } }, required: ['id'] },
    response: {
      200: zipFile('The ZIP.'),
      404: { description: 'Unknown or expired id (after 6 hours); prepare it again.', $ref: 'Error#' },
    },
  },

  // ---------------------------------------------------------------- backup
  'GET /api/backup': {
    operationId: 'downloadBackup',
    tags: ['Backup'],
    summary: 'Download a fresh backup',
    description: 'Makes a backup now and streams it as a ZIP: `manifest.json`, `encforge.db` (settings, presets, rename rules, jobs and history) and `logs/` with the job logs. The login password, sessions and API keys are not in it. The settings in it do include the SMTP password, if one is set, so keep the file private.',
    querystring: {
      type: 'object',
      properties: { logs: { type: 'string', description: '`0` leaves the job logs out; anything else, or nothing, includes them.' } },
    },
    response: { 200: zipFile('The backup ZIP (`encforge-backup-<date>.zip`).') },
  },
  'GET /api/backup/snapshots': {
    operationId: 'listBackupSnapshots',
    tags: ['Backup'],
    summary: 'Backups kept on the server',
    description: 'The backups in the app’s own data folder, newest first: those saved by hand and the “before restore” ones. Scheduled backups are listed by `GET /api/backup/scheduled`.',
    response: { 200: { type: 'array', items: { $ref: 'Backup#' } } },
  },
  'POST /api/backup/snapshots': {
    operationId: 'saveBackupSnapshot',
    tags: ['Backup'],
    summary: 'Save a backup on the server',
    description: 'Makes a backup and keeps it on the server (same content as `GET /api/backup`, including the SMTP password). Only the newest 10 manual and the newest 10 before-restore backups are kept.',
    body: { type: 'object', properties: { logs: { type: ['boolean', 'null'], description: 'false leaves the job logs out; true, null or omitted includes them.' } } },
    response: {
      200: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          size: { type: 'integer' },
          dir: { type: 'string', description: 'The folder it was saved in, on the server.' },
        },
      },
    },
  },
  'GET /api/backup/snapshots/:name': {
    operationId: 'downloadBackupSnapshot',
    tags: ['Backup'],
    summary: 'Download a kept backup',
    params: { type: 'object', properties: { name: { type: 'string', description: backupName } }, required: ['name'] },
    response: { 200: zipFile('The backup ZIP.'), 400: { description: 'Invalid name.', $ref: 'Error#' }, 404: { $ref: 'Error#' } },
  },
  'DELETE /api/backup/snapshots/:name': {
    operationId: 'deleteBackupSnapshot',
    tags: ['Backup'],
    summary: 'Delete a kept backup',
    description: 'Succeeds also when the file is already gone.',
    params: { type: 'object', properties: { name: { type: 'string', description: backupName } }, required: ['name'] },
    response: { ...ok, 400: { description: 'Invalid name.', $ref: 'Error#' } },
  },
  'GET /api/backup/scheduled': {
    operationId: 'getScheduledBackups',
    tags: ['Backup'],
    summary: 'Scheduled backups',
    description: 'The state of the backup schedule (set in Settings → Backup) and the scheduled backups in its folder, newest first.',
    response: { 200: { $ref: 'ScheduledBackupStatus#' } },
  },
  'POST /api/backup/scheduled/run': {
    operationId: 'runScheduledBackup',
    tags: ['Backup'],
    summary: 'Make a scheduled backup now',
    description: 'Makes a backup into the schedule’s folder right away (also when the schedule is off), then trims the folder to the number to keep. Answers when it is done; 400 when it failed (e.g. the folder is not mounted).',
    response: {
      200: { type: 'object', properties: { last: { $ref: 'ScheduledBackupRun#' }, status: { $ref: 'ScheduledBackupStatus#' } } },
      400: { $ref: 'Error#' },
    },
  },
  'GET /api/backup/scheduled/:name': {
    operationId: 'downloadScheduledBackup',
    tags: ['Backup'],
    summary: 'Download a scheduled backup',
    params: { type: 'object', properties: { name: { type: 'string', description: scheduledName } }, required: ['name'] },
    response: { 200: zipFile('The backup ZIP.'), 400: { description: 'Invalid name.', $ref: 'Error#' }, 404: { $ref: 'Error#' } },
  },
  'DELETE /api/backup/scheduled/:name': {
    operationId: 'deleteScheduledBackup',
    tags: ['Backup'],
    summary: 'Delete a scheduled backup',
    description: 'Succeeds also when the file is already gone.',
    params: { type: 'object', properties: { name: { type: 'string', description: scheduledName } }, required: ['name'] },
    response: { ...ok, 400: { description: 'Invalid name.', $ref: 'Error#' } },
  },
  'POST /api/backup/inspect': {
    operationId: 'inspectBackup',
    tags: ['Backup'],
    summary: 'Look into a backup before restoring',
    description: [
      'Step 1 of a restore. Reads a backup, checks it, and says what it holds compared with the current data. Changes nothing.',
      '',
      'Send either the backup file itself (a ZIP, up to 1 GiB, as the raw body with `Content-Type: application/octet-stream`; it is kept on the server for a day and the answer’s `source` is `upload:<uuid>`), or JSON `{ "source": "snapshot:<name>" }` / `{ "source": "scheduled:<name>" }` for a backup kept on the server.',
      'Then pass the answer’s `source` to `POST /api/backup/restore`.',
    ].join('\n'),
    docBody: {
      content: {
        'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
        'application/json': {
          schema: {
            type: 'object',
            properties: { source: { type: 'string', description: '`snapshot:<name>` or `scheduled:<name>`.' } },
            required: ['source'],
          },
        },
      },
    },
    response: {
      200: { $ref: 'BackupInspection#' },
      400: { description: 'Not an EncForge backup, damaged, made by a newer version, or an invalid source.', $ref: 'Error#' },
      404: { description: 'The file is gone.', $ref: 'Error#' },
    },
  },
  'POST /api/backup/restore': {
    operationId: 'restoreBackup',
    tags: ['Backup'],
    summary: 'Restore a backup',
    description: [
      'Step 2 of a restore: copies the data of the backup (from `POST /api/backup/inspect`) into the running app, with no restart. Before it, the current data is saved as a “before-restore” backup, so it can be undone by restoring that one.',
      '',
      '- `config`: settings, presets and rename rules. Jobs, history and logs stay as they are. The queue keeps running or stopped as it was.',
      '- `all`: everything, including jobs, history and job logs. Refused (409) while a conversion, merge, quality check, naming check or upload is running (`busy` in the inspection says so). The queue is stopped afterwards.',
      '',
      'The login password, sessions and API keys are never restored. The restored settings include the SMTP password the backup held.',
    ].join('\n'),
    body: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The `source` from the inspection.' },
        scope: { type: 'string', enum: ['config', 'all'] },
      },
      required: ['source', 'scope'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['config', 'all'] },
          tables: { type: 'array', items: { type: 'string' }, description: 'The database tables that were replaced.' },
          logs: { type: 'integer', description: 'Job logs restored (scope `all` only).' },
          savedAs: { type: 'string', description: 'Name of the before-restore backup of the previous data.' },
        },
      },
      400: { description: 'Bad scope or source, or a damaged backup.', $ref: 'Error#' },
      409: { description: 'Another restore is running, or (scope `all`) something is running.', $ref: 'Error#' },
    },
  },
};

export const examples = [
  { method: 'POST', url: '/api/upload/check', body: { dir: '/mnt/downloads/Films', files: [{ name: 'Film.mkv', size: 1500000000 }] } },
  { method: 'PUT', url: '/api/upload?dir=%2Fmnt%2Fdownloads%2FFilms&name=Film.mkv&size=1500000000&offset=0', body: 'chunk-bytes-here', contentType: 'application/octet-stream' },
  { method: 'POST', url: '/api/upload/discard', body: { dir: '/mnt/downloads/Films', name: 'Film.mkv', size: 1500000000 } },
  { method: 'POST', url: '/api/folders', body: { parent: '/mnt/downloads', name: 'New folder' } },
  { method: 'POST', url: '/api/files/delete/preview', body: { paths: ['/mnt/downloads/Film.mkv'] } },
  { method: 'POST', url: '/api/files/delete', body: { paths: ['/mnt/downloads/Film.mkv'] } },

  { method: 'GET', url: '/api/download?path=%2Fmnt%2Fdownloads%2FFilm.mkv' },
  { method: 'POST', url: '/api/download/subtitles', body: { paths: ['/mnt/downloads/Film.mkv'] } },
  { method: 'POST', url: '/api/download/zip', body: { paths: ['/mnt/downloads/Film.mkv', '/mnt/downloads/Series'], withSubtitles: true } },
  { method: 'GET', url: '/api/download/zip/0b0c5f6a-3d6e-4b87-9b52-7f1f0f0c9a11' },

  { method: 'GET', url: '/api/backup' },
  { method: 'GET', url: '/api/backup?logs=0' },
  { method: 'GET', url: '/api/backup/snapshots' },
  { method: 'POST', url: '/api/backup/snapshots', body: { logs: true } },
  { method: 'POST', url: '/api/backup/snapshots', body: { logs: false } },
  { method: 'GET', url: '/api/backup/snapshots/manual-2026-11-12-101010.zip' },
  { method: 'DELETE', url: '/api/backup/snapshots/manual-2026-11-12-101010.zip' },
  { method: 'GET', url: '/api/backup/scheduled' },
  { method: 'POST', url: '/api/backup/scheduled/run', body: {} },
  { method: 'GET', url: '/api/backup/scheduled/scheduled-2026-11-12-030000.zip' },
  { method: 'DELETE', url: '/api/backup/scheduled/scheduled-2026-11-12-030000.zip' },
  { method: 'POST', url: '/api/backup/inspect', body: { source: 'snapshot:manual-2026-11-12-101010.zip' } },
  { method: 'POST', url: '/api/backup/inspect', body: { source: 'scheduled:scheduled-2026-11-12-030000.zip' } },
  { method: 'POST', url: '/api/backup/inspect', body: 'PK-backup-bytes', contentType: 'application/octet-stream' },
  { method: 'POST', url: '/api/backup/restore', body: { source: 'upload:0b0c5f6a-3d6e-4b87-9b52-7f1f0f0c9a11', scope: 'config' } },
  { method: 'POST', url: '/api/backup/restore', body: { source: 'snapshot:manual-2026-11-12-101010.zip', scope: 'all' } },
];
