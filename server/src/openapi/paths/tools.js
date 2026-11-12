// Docs of rename/routes.js (rename rule sets, renaming, naming checks), mergeRoutes.js and
// qualityRoutes.js. Conventions: ../index.js.

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const ok = { 200: { description: 'Done.', $ref: 'Ok#' } };
const pathsProp = { type: 'array', items: { type: 'string' }, description: 'Absolute paths of files or folders (folders are read, including their subfolders).' };
const pathList = { type: 'array', items: { type: 'string' } };
const startedId = { type: 'object', properties: { id: { type: 'integer', description: 'The id of the check that was started.' } } };

const step = {
  type: 'object',
  description: 'One step of a rule set. `type` is one of smart, cleanTags, replace, removePattern, removeAfter, remove, add, move, trim, case, apostrophes, collapseSpaces; the other fields are that type’s options (missing ones get their defaults). `active: false` skips the step.',
  properties: {
    type: { type: 'string' },
    active: { type: 'boolean' },
    description: { type: 'string' },
  },
};

const mediaInfo = {
  type: 'object',
  description: 'What a media file looks like (ffprobe).',
  properties: {
    container: { type: 'string', description: 'File extension, lower case.' },
    format: { type: ['string', 'null'] },
    duration: { type: ['number', 'null'], description: 'Seconds.' },
    size: { type: ['integer', 'null'], description: 'Bytes.' },
    video: {
      type: ['object', 'null'],
      properties: {
        codec: { type: 'string' },
        profile: { type: ['string', 'null'] },
        width: { type: 'integer' },
        height: { type: 'integer' },
        displayWidth: { type: 'integer', description: 'Width after the pixel aspect ratio.' },
        fps: { type: ['number', 'null'] },
        kbps: { type: ['integer', 'null'] },
        kbpsEstimated: { type: 'boolean', description: 'The bitrate was worked out from the file size.' },
        interlaced: { type: 'boolean' },
        bitDepth: { type: 'integer' },
      },
    },
    audio: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codec: { type: 'string' },
          channels: { type: ['integer', 'null'] },
          kbps: { type: ['integer', 'null'] },
          language: { type: ['string', 'null'] },
        },
      },
    },
    subtitles: { type: 'integer', description: 'Number of subtitle tracks.' },
  },
};

const namingRow = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    dir: { type: 'string' },
    oldName: { type: 'string' },
    expected: { type: ['string', 'null'], description: 'The name the rule set would give; null when only warnings were found.' },
    info: { type: ['object', 'null'], description: 'What the “smart” step recognised (show, season, episode, title, year…).' },
    warnings: pathList,
    gone: { type: 'boolean', description: 'The file no longer exists (renamed, moved or deleted since the check).' },
    blocked: { type: ['string', 'null'], description: 'Why the file cannot be renamed now (protected folder, queued job…), or null.' },
    mtime: { type: ['number', 'null'], description: 'Modified time, ms since 1970.' },
    size: { type: ['integer', 'null'], description: 'Bytes.' },
  },
};

const renamePair = { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, companion: { type: 'boolean', description: 'A subtitle file that followed its video.' } } };
const pathError = { type: 'object', properties: { path: { type: 'string' }, error: { type: 'string' } } };

const qualityResult = {
  ...mediaInfo,
  properties: {
    ...mediaInfo.properties,
    path: { type: 'string' },
    mtime: { type: ['number', 'null'], description: 'Modified time, ms since 1970.' },
    error: { type: 'string', description: 'The file could not be read (only then).' },
    issues: { type: 'array', items: { type: 'object' }, description: 'What is below the quality criteria of the settings, worked out on every read.' },
    inSource: { type: 'boolean', description: 'The file is inside a sources folder, so it can be added as a job.' },
    job: { type: ['object', 'null'], description: 'The job that already handles this file, if any.' },
  },
};

export const schemas = [
  {
    $id: 'RenameRule',
    type: 'object',
    description: 'A rename rule set: a list of steps applied in order to a file name.',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      description: { type: 'string' },
      steps: { type: 'array', items: step },
      builtin: { type: 'boolean', description: 'Built-in rule sets cannot be changed or deleted; duplicate them first.' },
      createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
      updatedAt: { type: 'integer', description: 'Milliseconds since 1970.' },
    },
  },
  {
    $id: 'NamingCheck',
    type: 'object',
    description: 'A naming check: which files do not follow a rule set. The list has no `rows`; one check has.',
    properties: {
      id: { type: 'integer' },
      status: { type: 'string', enum: ['running', 'done', 'cancelled', 'failed'] },
      createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
      finishedAt: { type: ['integer', 'null'] },
      ruleId: { type: 'integer' },
      ruleName: { type: 'string' },
      paths: pathList,
      total: { type: 'integer', description: 'Files compared.' },
      flagged: { type: 'integer', description: 'Files that need a look (in `rows`).' },
      error: { type: ['string', 'null'] },
      phase: { type: 'string', enum: ['listing', 'checking'], description: 'While running: reading folders, or comparing names.' },
      found: { type: 'integer', description: 'While running: files found so far.' },
      checked: { type: 'integer', description: 'While running: names compared so far.' },
      current: { type: ['string', 'null'], description: 'While running: the folder being read.' },
      rows: { type: 'array', items: namingRow, description: 'Only when one check is read (empty while it runs).' },
    },
  },
  {
    $id: 'Merge',
    type: 'object',
    description: 'A merge of several video files (parts) into one MKV.',
    properties: {
      id: { type: 'integer' },
      status: { type: 'string', enum: ['queued', 'running', 'done', 'cancelled', 'failed'] },
      createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
      finishedAt: { type: ['integer', 'null'] },
      parts: { ...pathList, description: 'The files being joined, in order.' },
      output: { type: 'string', description: 'The path of the merged file.' },
      options: {
        type: 'object',
        properties: {
          chapterMode: { type: 'string', enum: ['keep', 'perFile'] },
          removeParts: { type: 'boolean', description: 'The parts are deleted after a successful, verified merge.' },
        },
      },
      progress: { type: 'number', description: '0 to 1.' },
      phase: { type: ['string', 'null'] },
      error: { type: ['string', 'null'] },
      warnings: { ...pathList, description: 'Compatibility warnings found before the merge.' },
      chapters: { type: ['integer', 'null'], description: 'Chapters in the merged file.' },
      duration: { type: ['number', 'null'], description: 'Seconds.' },
      outputSize: { type: ['integer', 'null'], description: 'Bytes.' },
      verifyStatus: { type: ['string', 'null'], description: 'Result of the check of the merged file.' },
      verify: { type: ['object', 'null'] },
      partsRemoved: { type: 'boolean', description: 'The parts have been deleted.' },
    },
  },
  {
    $id: 'QualityScan',
    type: 'object',
    description: 'A quality check of existing video files. The list has no `results`; one scan has.',
    properties: {
      id: { type: 'integer' },
      status: { type: 'string', enum: ['running', 'done', 'cancelled', 'failed'] },
      paths: pathList,
      createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
      finishedAt: { type: ['integer', 'null'] },
      total: { type: ['integer', 'null'], description: 'Files to read (null while the folders are still being listed).' },
      scanned: { type: 'integer', description: 'Files read so far.' },
      error: { type: ['string', 'null'] },
      current: { type: ['string', 'null'], description: 'While running: what is being read.' },
      recheck: { type: 'boolean', description: 'While running: this is a re-check of some files, not a full scan.' },
      flagged: { type: 'integer', description: 'Files with at least one issue (only when one scan is read).' },
      results: { type: 'array', items: qualityResult, description: 'One entry per file (only when one scan is read).' },
    },
  },
];

const ruleBody = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Required to create; not empty.' },
    description: { type: ['string', 'null'] },
    steps: { type: 'array', items: { type: 'object' }, description: 'The steps (see RenameRule). Required to create. Checked by the server: an unknown type or a bad regular expression is a 400.' },
  },
};

const previewBody = {
  type: 'object',
  properties: {
    paths: pathsProp,
    ruleId: { type: ['integer', 'null'], description: 'The rule set to use. Instead of it, `steps` can give steps directly.' },
    steps: { type: ['array', 'null'], items: { type: 'object' }, description: 'Steps to use instead of a saved rule set.' },
    showOverride: { type: ['string', 'null'], description: 'A show name that replaces the one found in the file names. Empty: none.' },
    showOverrideAll: { type: 'boolean', description: 'Use `showOverride` for every file, not only those without a show name. Default false.' },
    edits: { type: ['object', 'null'], description: 'Names typed by the user: path → name wanted for that file.' },
  },
  required: ['paths'],
};

export const paths = {
  'GET /api/naming/checks': {
    operationId: 'listNamingChecks',
    tags: ['Naming'],
    summary: 'Naming checks',
    description: 'The saved checks, newest first (the last 20 are kept), without their rows. A running one carries its progress.',
    response: { 200: { type: 'array', items: { $ref: 'NamingCheck#' } } },
  },
  'POST /api/naming/checks': {
    operationId: 'startNamingCheck',
    tags: ['Naming'],
    summary: 'Start a naming check',
    description: 'Compares the names of the video files in the given folders with what a rule set would name them. Runs in the background, one at a time (409 when one is running): the answer is the id straight away. Follow it with `GET /api/naming/checks/{id}` or the `namingProgress` / `namingCheck` events; the check is done when its status is no longer `running`.',
    body: {
      type: 'object',
      properties: { paths: pathsProp, ruleId: { type: ['integer', 'null'], description: 'The rule set to compare with.' } },
      required: ['paths'],
    },
    response: { 200: startedId, 400: { description: 'No paths, unknown rule set, or a path outside the sources folders.', $ref: 'Error#' }, 409: { description: 'A naming check is already running.', $ref: 'Error#' } },
  },
  'GET /api/naming/checks/:id': {
    operationId: 'getNamingCheck',
    tags: ['Naming'],
    summary: 'A naming check with its rows',
    description: 'The files that need a look. Each row is checked against the disk when read: `gone`, `blocked`, `mtime` and `size` are current. While the check runs, `rows` is empty and the progress fields are set.',
    params: idParam,
    response: { 200: { $ref: 'NamingCheck#' }, 404: { $ref: 'Error#' } },
  },
  'POST /api/naming/checks/:id/cancel': {
    operationId: 'cancelNamingCheck',
    tags: ['Naming'],
    summary: 'Stop a naming check',
    description: 'The check ends with what it has compared so far (status `cancelled`). 409 when it is not running.',
    params: idParam,
    response: { ...ok, 409: { $ref: 'Error#' } },
  },
  'DELETE /api/naming/checks/:id': {
    operationId: 'deleteNamingCheck',
    tags: ['Naming'],
    summary: 'Delete a naming check',
    description: 'Removes the saved result. 409 while it is running.',
    params: idParam,
    response: { ...ok, 409: { $ref: 'Error#' } },
  },

  'GET /api/rename/rules': {
    operationId: 'listRenameRules',
    tags: ['Rename'],
    summary: 'Rename rule sets',
    description: 'Built-in rule sets first, then the user’s own.',
    response: { 200: { type: 'array', items: { $ref: 'RenameRule#' } } },
  },
  'GET /api/rename/rules/:id': {
    operationId: 'getRenameRule',
    tags: ['Rename'],
    summary: 'A rename rule set',
    params: idParam,
    response: { 200: { $ref: 'RenameRule#' }, 404: { $ref: 'Error#' } },
  },
  'POST /api/rename/rules': {
    operationId: 'createRenameRule',
    tags: ['Rename'],
    summary: 'Create a rename rule set',
    description: 'Steps are checked and completed with their defaults. Answers with the new rule set.',
    body: ruleBody,
    response: { 200: { $ref: 'RenameRule#' }, 400: { description: 'No name, or an invalid step.', $ref: 'Error#' } },
  },
  'PUT /api/rename/rules/:id': {
    operationId: 'updateRenameRule',
    tags: ['Rename'],
    summary: 'Change a rename rule set',
    description: 'Fields that are left out (or null) keep their value. Built-in rule sets cannot be changed (409).',
    params: idParam,
    body: ruleBody,
    response: { 200: { $ref: 'RenameRule#' }, 400: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { description: 'The rule set is built in.', $ref: 'Error#' } },
  },
  'DELETE /api/rename/rules/:id': {
    operationId: 'deleteRenameRule',
    tags: ['Rename'],
    summary: 'Delete a rename rule set',
    description: 'Built-in rule sets cannot be deleted (409). If it was the rule set for automatic renaming, that setting is cleared.',
    params: idParam,
    response: { ...ok, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
  },
  'POST /api/rename/rules/import': {
    operationId: 'importRenameRule',
    tags: ['Rename'],
    summary: 'Import a rule set from a file',
    description: 'Takes the text of a file: either a rule set exported by this app (JSON), or an Advanced Renamer preset (`.aren`). The name comes from the file’s name when the file has none. Steps that could not be converted are listed in `skipped`.',
    body: {
      type: 'object',
      properties: { fileName: { type: ['string', 'null'] }, content: { type: 'string', description: 'The file’s text.' } },
      required: ['content'],
    },
    response: {
      200: { type: 'object', properties: { rule: { $ref: 'RenameRule#' }, skipped: { type: 'array', items: {}, description: 'Parts of an Advanced Renamer preset that were not imported.' } } },
      400: { description: 'Empty or unknown file.', $ref: 'Error#' },
    },
  },
  'GET /api/rename/rules/:id/export': {
    operationId: 'exportRenameRule',
    tags: ['Rename'],
    summary: 'Export a rule set (file download)',
    description: 'A JSON file (`<name>.rename.json`, sent as an attachment) that can be imported again, here or on another server: `{ type, version, name, description, steps }`.',
    params: idParam,
    response: {
      200: { description: 'The rule set as a JSON file.', content: { 'application/json': { schema: { type: 'string' } } } },
      404: { $ref: 'Error#' },
    },
  },
  'POST /api/rename/test': {
    operationId: 'testRename',
    tags: ['Rename'],
    summary: 'Try steps on sample names',
    description: 'Runs unsaved steps over plain names (no files are read), at most 200. Answers with one entry per name, in order.',
    body: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'object' } },
        names: { type: 'array', items: { type: 'string' }, description: 'File names, with their extension.' },
        showOverride: { type: ['string', 'null'], description: 'A show name that replaces the one found. Empty: none.' },
        showOverrideAll: { type: 'boolean', description: 'Default false.' },
      },
      required: ['steps'],
    },
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string', description: 'The new name.' },
            info: { type: ['object', 'null'], description: 'What the “smart” step recognised.' },
            warnings: pathList,
          },
        },
      },
      400: { description: 'An invalid step.', $ref: 'Error#' },
    },
  },
  'POST /api/rename/preview': {
    operationId: 'previewRename',
    tags: ['Rename'],
    summary: 'Preview new names',
    description: 'Proposes new names for the files (folders are expanded) with a saved rule set or given steps. Nothing is renamed. Each row has `status`: `rename`, `unchanged` or `blocked` (protected folder or queued job: shown, never renamed). `newName` is `wanted` with `_1`, `_2`… added when the name is taken. Subtitle files that would follow a video are listed in `companions`. A `warnings` entry marks names the rules could not make sense of.',
    body: previewBody,
    response: {
      200: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                dir: { type: 'string' },
                oldName: { type: 'string' },
                proposed: { type: 'string', description: 'What the steps give.' },
                wanted: { type: 'string', description: 'The name asked for: `proposed`, or the user’s edit.' },
                newName: { type: 'string', description: 'The name that would be used, after resolving collisions.' },
                edited: { type: 'boolean' },
                status: { type: 'string', enum: ['rename', 'unchanged', 'blocked'] },
                info: { type: ['object', 'null'] },
                warnings: pathList,
                blocked: { type: ['string', 'null'], description: 'Why the file is not renamed, or null.' },
                companions: { type: 'array', items: { type: 'object', properties: { oldName: { type: 'string' }, newName: { type: 'string' }, error: { type: ['string', 'null'] } } } },
                mtime: { type: ['number', 'null'], description: 'Modified time, ms since 1970.' },
                size: { type: ['integer', 'null'], description: 'Bytes.' },
              },
            },
          },
        },
      },
      400: { $ref: 'Error#' },
    },
  },
  'POST /api/rename/apply': {
    operationId: 'applyRename',
    tags: ['Rename'],
    summary: 'Rename files',
    description: 'Renames the given files for real. Names are checked again on the server (protected files are skipped, taken names get `_1`, `_2`…) and renamed in two steps so names can be swapped. Subtitle files named after a video follow it. The batch is saved to the history, so it can be undone with `POST /api/rename/history/{id}/undo`. Files that could not be renamed are in `errors`; the request still succeeds.',
    body: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { path: { type: 'string' }, newName: { type: 'string', description: 'The new file name (not a path).' } } },
        },
        ruleName: { type: ['string', 'null'], description: 'Name of the rule set, shown in the history.' },
      },
      required: ['items'],
    },
    response: {
      200: { type: 'object', properties: { renamed: { type: 'array', items: renamePair }, errors: { type: 'array', items: pathError } } },
      400: { description: 'Nothing to rename.', $ref: 'Error#' },
    },
  },
  'GET /api/rename/history': {
    operationId: 'listRenameHistory',
    tags: ['Rename'],
    summary: 'Rename history',
    description: 'The last 100 renaming batches, newest first, including the automatic renames after a conversion.',
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            createdAt: { type: 'integer', description: 'Milliseconds since 1970.' },
            ruleName: { type: ['string', 'null'] },
            auto: { type: 'boolean', description: 'Renamed automatically after a conversion.' },
            items: { type: 'array', items: renamePair },
            undoneAt: { type: ['integer', 'null'], description: 'When the batch was undone, if it was.' },
          },
        },
      },
    },
  },
  'POST /api/rename/history/:id/undo': {
    operationId: 'undoRename',
    tags: ['Rename'],
    summary: 'Undo a renaming batch',
    description: 'Renames the files of the batch back. A file is left alone (listed in `errors`) when it no longer exists, when its old name is in use again, or when it is now in a protected folder. A batch can be undone once (409 after that).',
    params: idParam,
    response: {
      200: { type: 'object', properties: { restored: { type: 'integer', description: 'Files renamed back (subtitle files not counted).' }, errors: { type: 'array', items: pathError } } },
      404: { $ref: 'Error#' },
      409: { description: 'Already undone.', $ref: 'Error#' },
    },
  },

  'GET /api/merge': {
    operationId: 'listMerges',
    tags: ['Merge'],
    summary: 'Merges',
    description: 'The 30 newest merges, newest first.',
    response: { 200: { type: 'array', items: { $ref: 'Merge#' } } },
  },
  'POST /api/merge/inspect': {
    operationId: 'inspectMerge',
    tags: ['Merge'],
    summary: 'Inspect files before merging',
    description: 'Reads the parts (folders are expanded: the videos inside, in natural name order) and says whether they can be joined. Nothing is written. Paths are under the target folder.',
    body: {
      type: 'object',
      properties: {
        paths: pathsProp,
        chapterMode: { type: 'string', enum: ['keep', 'perFile'], description: '`keep`: the parts’ own chapters; `perFile`: one chapter per part. Default keep.' },
        outputName: { type: ['string', 'null'], description: 'The name for the merged file, without extension. Left out: one is suggested from the parts’ names.' },
      },
      required: ['paths'],
    },
    response: {
      200: {
        type: 'object',
        properties: {
          parts: { type: 'array', items: { type: 'object', description: 'path, name, duration, size, mtime, chapters (count) and tracks.' } },
          problems: { type: 'array', items: { type: 'object', properties: { level: { type: 'string', enum: ['error', 'warning'] }, code: { type: 'string' }, params: { type: 'object' }, message: { type: 'string' } } } },
          chapters: { type: 'array', items: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, title: { type: 'string' } } } },
          duration: { type: 'number', description: 'Seconds.' },
          size: { type: 'integer', description: 'Bytes.' },
          outputName: { type: 'string' },
          outputDir: { type: ['string', 'null'] },
          outputExists: { type: 'boolean', description: 'A file with that name exists already (the merge would then add a number).' },
          canMerge: { type: 'boolean', description: 'No problem has level `error`.' },
        },
      },
      400: { description: 'Unknown chapter mode, a file that cannot be read, too many files.', $ref: 'Error#' },
    },
  },
  'POST /api/merge': {
    operationId: 'startMerge',
    tags: ['Merge'],
    summary: 'Merge files into one',
    description: 'Queues a merge of the parts into one MKV next to the first part (merges run one at a time). The answer is the new merge, status `queued`; follow it with `GET /api/merge` or the `merge` events. The same checks as `inspect` apply (400 when the parts cannot be joined; 409 when a part is already in another merge). **With `removeParts: true` the part files are deleted after the merged file has been checked successfully**; that cannot be undone. Without it, the parts stay.',
    body: {
      type: 'object',
      properties: {
        paths: pathsProp,
        outputName: { type: ['string', 'null'], description: 'Name of the merged file, without extension.' },
        chapterMode: { type: 'string', enum: ['keep', 'perFile'], description: 'Default keep.' },
        removeParts: { type: ['boolean', 'null'], description: 'Delete the parts after a successful merge. Default false.' },
      },
      required: ['paths'],
    },
    response: { 200: { $ref: 'Merge#' }, 400: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
  },
  'POST /api/merge/:id/cancel': {
    operationId: 'cancelMerge',
    tags: ['Merge'],
    summary: 'Cancel a merge',
    description: 'A queued merge is cancelled; a running one is stopped. 409 when it is neither.',
    params: idParam,
    response: { ...ok, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
  },
  'DELETE /api/merge/:id': {
    operationId: 'deleteMerge',
    tags: ['Merge'],
    summary: 'Remove a merge from the list',
    description: 'Only the entry; the merged file stays. 409 while it is queued or running.',
    params: idParam,
    response: { ...ok, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
  },

  'GET /api/quality/scans': {
    operationId: 'listQualityScans',
    tags: ['Quality'],
    summary: 'Quality checks',
    description: 'The saved checks, newest first (the last 20 are kept), without their results. A running one carries its progress.',
    response: { 200: { type: 'array', items: { $ref: 'QualityScan#' } } },
  },
  'POST /api/quality/scans': {
    operationId: 'startQualityScan',
    tags: ['Quality'],
    summary: 'Start a quality check',
    description: 'Reads the video files in the given folders (ffprobe) and saves what they are like. Runs in the background, one at a time (409 when one is running): the answer is the id straight away. Follow it with `GET /api/quality/scans/{id}` or the `qualityProgress` / `qualityScans` events.',
    body: { type: 'object', properties: { paths: pathsProp }, required: ['paths'] },
    response: { 200: startedId, 400: { $ref: 'Error#' }, 409: { description: 'A quality check is already running.', $ref: 'Error#' } },
  },
  'GET /api/quality/scans/:id': {
    operationId: 'getQualityScan',
    tags: ['Quality'],
    summary: 'A quality check with its results',
    description: 'Every file read, with its `issues` judged by the quality criteria of the settings as they are now (so changing the criteria changes the issues of an old check).',
    params: idParam,
    response: { 200: { $ref: 'QualityScan#' }, 404: { $ref: 'Error#' } },
  },
  'POST /api/quality/scans/:id/recheck': {
    operationId: 'recheckQualityScan',
    tags: ['Quality'],
    summary: 'Read some files again',
    description: 'For files of a finished check that were fixed: reads them again and updates their results in place. A file that is gone, but has a video of the same name with another extension beside it (film.avi converted to film.mkv), is replaced by that video; other gone files leave the results. Runs in the background like a scan. 400 when none of the paths belongs to the check; 409 when a check is running.',
    params: idParam,
    body: { type: 'object', properties: { paths: pathsProp }, required: ['paths'] },
    response: { 200: { type: 'object', properties: { id: { type: 'integer' }, count: { type: 'integer', description: 'Files that will be read again.' } } }, 400: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
  },
  'POST /api/quality/scans/:id/cancel': {
    operationId: 'cancelQualityScan',
    tags: ['Quality'],
    summary: 'Stop a quality check',
    description: 'The check ends with what it has read so far. 409 when it is not running.',
    params: idParam,
    response: { ...ok, 409: { $ref: 'Error#' } },
  },
  'DELETE /api/quality/scans/:id': {
    operationId: 'deleteQualityScan',
    tags: ['Quality'],
    summary: 'Delete a quality check',
    description: 'Removes the saved result. 409 while it is running.',
    params: idParam,
    response: { ...ok, 409: { $ref: 'Error#' } },
  },
};

export const examples = [
  { method: 'GET', url: '/api/naming/checks' },
  { method: 'POST', url: '/api/naming/checks', body: { paths: ['/mnt/media/Shows'], ruleId: 1 } },
  { method: 'GET', url: '/api/naming/checks/4' },
  { method: 'POST', url: '/api/naming/checks/4/cancel', body: {} },
  { method: 'DELETE', url: '/api/naming/checks/4' },

  { method: 'GET', url: '/api/rename/rules' },
  { method: 'GET', url: '/api/rename/rules/2' },
  { method: 'POST', url: '/api/rename/rules', body: { name: 'New rule set', steps: [{ type: 'smart' }] } },
  { method: 'POST', url: '/api/rename/rules', body: { name: 'Copy of TV', description: '', steps: [{ type: 'smart', active: true, description: '', mode: 'auto' }] } },
  { method: 'PUT', url: '/api/rename/rules/5', body: { name: 'TV', description: '', steps: [{ type: 'cleanTags', active: true, description: '', extraTags: [] }] } },
  { method: 'DELETE', url: '/api/rename/rules/5' },
  { method: 'POST', url: '/api/rename/rules/import', body: { fileName: 'tv.aren', content: '{"type":"encforge-rename-rules"}' } },
  { method: 'GET', url: '/api/rename/rules/5/export' },
  { method: 'POST', url: '/api/rename/test', body: { steps: [{ type: 'smart' }], names: ['Some.Show.S01E02.720p.mkv'], showOverride: '' } },
  { method: 'POST', url: '/api/rename/test', body: { steps: [], names: [], showOverride: 'Some Show' } },
  {
    method: 'POST',
    url: '/api/rename/preview',
    body: { paths: ['/mnt/media/Shows/Some.Show.S01E02.mkv'], ruleId: 1, showOverride: '', showOverrideAll: false, edits: {} },
  },
  {
    method: 'POST',
    url: '/api/rename/preview',
    body: { paths: ['/mnt/media/Shows'], ruleId: 1, showOverride: 'Some Show', showOverrideAll: true, edits: { '/mnt/media/Shows/a.mkv': 'A.mkv' } },
  },
  { method: 'POST', url: '/api/rename/apply', body: { items: [{ path: '/mnt/media/Shows/a.mkv', newName: 'A S01e02.mkv' }], ruleName: 'TV' } },
  { method: 'POST', url: '/api/rename/apply', body: { items: [{ path: '/mnt/media/Shows/a.mkv', newName: 'A.mkv' }] } },
  { method: 'GET', url: '/api/rename/history' },
  { method: 'POST', url: '/api/rename/history/7/undo', body: {} },

  { method: 'GET', url: '/api/merge' },
  { method: 'POST', url: '/api/merge/inspect', body: { paths: ['/mnt/target/Film CD1.mkv', '/mnt/target/Film CD2.mkv'], chapterMode: 'keep' } },
  { method: 'POST', url: '/api/merge/inspect', body: { paths: ['/mnt/target/Film'], chapterMode: 'perFile', outputName: 'Film' } },
  { method: 'POST', url: '/api/merge', body: { paths: ['/mnt/target/Film CD1.mkv', '/mnt/target/Film CD2.mkv'], outputName: 'Film', chapterMode: 'keep', removeParts: false } },
  { method: 'POST', url: '/api/merge', body: { paths: ['/mnt/target/Film'], outputName: 'Film', chapterMode: 'perFile', removeParts: true } },
  { method: 'POST', url: '/api/merge/3/cancel', body: {} },
  { method: 'DELETE', url: '/api/merge/3' },

  { method: 'GET', url: '/api/quality/scans' },
  { method: 'POST', url: '/api/quality/scans', body: { paths: ['/mnt/media/Films'] } },
  { method: 'GET', url: '/api/quality/scans/6' },
  { method: 'POST', url: '/api/quality/scans/6/recheck', body: { paths: ['/mnt/media/Films/a.mkv'] } },
  { method: 'POST', url: '/api/quality/scans/6/cancel', body: {} },
  { method: 'DELETE', url: '/api/quality/scans/6' },
];
