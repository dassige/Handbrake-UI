import fs from 'node:fs';
import path from 'node:path';
import { backfillHistory } from './history.js';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  file_name   TEXT,              -- name of the uploaded file
  json        TEXT NOT NULL,     -- importable file holding only this preset
  summary     TEXT NOT NULL,     -- JSON: encoder, format, size, bitrate...
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  status       TEXT NOT NULL,    -- queued | running | paused | done | failed | cancelled
  phase        TEXT,             -- scanning | encoding | muxing (while running)
  position     REAL NOT NULL,    -- queue order
  source_path  TEXT NOT NULL,
  output_path  TEXT NOT NULL,    -- planned path; the real one once started
  preset_id    INTEGER,
  preset_name  TEXT NOT NULL,
  preset_json  TEXT NOT NULL,    -- snapshot taken when the job was added
  format       TEXT NOT NULL,    -- the preset's FileFormat: av_mkv | av_mp4 | av_webm | av_mov
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  paused_ms    INTEGER NOT NULL DEFAULT 0,
  progress     REAL NOT NULL DEFAULT 0,
  fps          REAL,
  avg_fps      REAL,
  eta          INTEGER,
  pass         INTEGER,
  pass_count   INTEGER,
  source_size  INTEGER,
  output_size  INTEGER,
  source_info  TEXT,             -- JSON from HandBrake scan
  scan_error   TEXT,
  exit_code    INTEGER,
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS jobs_status_position ON jobs(status, position);
CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source_path);

CREATE TABLE IF NOT EXISTS rename_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  steps       TEXT NOT NULL,     -- JSON list of steps
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rename_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  rule_name  TEXT,
  auto       INTEGER NOT NULL DEFAULT 0,
  items      TEXT NOT NULL,      -- JSON [{ from, to }]
  undone_at  INTEGER
);

CREATE TABLE IF NOT EXISTS merges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL,     -- queued | running | done | failed | cancelled
  phase         TEXT,              -- reading | merging | verifying
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  parts         TEXT NOT NULL,     -- JSON list of input paths, in order
  output        TEXT NOT NULL,
  options       TEXT NOT NULL,     -- JSON { chapterMode, removeParts }
  progress      REAL NOT NULL DEFAULT 0,
  warnings      TEXT,              -- JSON list
  error         TEXT,
  chapters      INTEGER,
  duration      REAL,
  output_size   INTEGER,
  verify        TEXT,
  verify_status TEXT,
  parts_removed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  part_path  TEXT PRIMARY KEY,   -- hidden partial file next to the final one
  dir        TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL,     -- running | done | cancelled | failed
  paths       TEXT NOT NULL,     -- JSON list of the folders/files checked
  created_at  INTEGER NOT NULL,
  finished_at INTEGER,
  total       INTEGER NOT NULL DEFAULT 0,
  scanned     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  results     TEXT               -- JSON list of file descriptions (quality.js describeMedia)
);

-- Naming check results (rename/naming.js); only the files that needed a look are stored.
CREATE TABLE IF NOT EXISTS naming_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  rule_id     INTEGER,
  rule_name   TEXT NOT NULL,
  paths       TEXT NOT NULL,     -- JSON list of the folders/files checked
  total       INTEGER NOT NULL,  -- videos checked
  flagged     INTEGER NOT NULL,  -- rows stored
  rows        TEXT NOT NULL,     -- JSON list: { path, dir, oldName, expected, info, warnings }
  status      TEXT NOT NULL DEFAULT 'done', -- running | done | cancelled | failed
  finished_at INTEGER,
  error       TEXT
);

-- One row per finished conversion attempt; kept when jobs are cleared (history.js).
CREATE TABLE IF NOT EXISTS job_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER,
  status         TEXT NOT NULL,    -- done | failed | cancelled
  finished_at    INTEGER NOT NULL,
  preset_name    TEXT,
  source_path    TEXT,
  output_path    TEXT,
  source_size    INTEGER,
  output_size    INTEGER,
  media_seconds  REAL,             -- length of the source
  encode_seconds REAL,             -- time spent, pauses left out, check included
  avg_fps        REAL,
  verify_status  TEXT,
  origin         TEXT              -- 'watch' when a watch folder added the job
);
CREATE INDEX IF NOT EXISTS job_history_finished ON job_history(finished_at);

-- Files a watch folder has dealt with, so each is added at most once (watch.js).
CREATE TABLE IF NOT EXISTS watch_seen (
  path    TEXT PRIMARY KEY,
  folder  TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  action  TEXT NOT NULL,           -- existing | added | skipped
  job_id  INTEGER,
  note    TEXT
);

-- Watch folders whose existing files have been recorded as "existing".
CREATE TABLE IF NOT EXISTS watch_folders (
  path          TEXT PRIMARY KEY,
  baselined_at  INTEGER NOT NULL
);

-- Login and API keys (auth.js). Credentials: left out of backups (AUTH_TABLES), never restored.
CREATE TABLE IF NOT EXISTS auth (
  key   TEXT PRIMARY KEY,          -- enabled | passwordHash
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash      TEXT PRIMARY KEY,   -- SHA-256 of the cookie value
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  scope        TEXT NOT NULL,      -- read | queue | admin
  hash         TEXT NOT NULL UNIQUE, -- SHA-256 of the key
  prefix       TEXT NOT NULL,      -- first characters, to tell keys apart
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  last_used_ip TEXT
);
`;

/** Columns added after the first release. */
const MIGRATIONS = [
  ['jobs', 'rename_note', 'TEXT'],
  ['jobs', 'verify', 'TEXT'], // JSON result of the check after conversion
  ['jobs', 'verify_status', 'TEXT'], // ok | warning | error | skipped | running
  ['jobs', 'origin', 'TEXT'], // 'watch' when a watch folder added the job
  ['presets', 'updated_at', 'INTEGER'], // last saved in the preset editor (NULL: as imported)
  ['jobs', 'subtitles', 'TEXT'], // JSON: sidecar subtitle files and the choices made for them (NULL: not looked for yet)
  ['jobs', 'sub_embed', 'TEXT'], // this job's embed mode (NULL: the queue's or Settings')
  ['jobs', 'sub_copy', 'TEXT'], // this job's copy mode (NULL: the queue's or Settings')
  ['jobs', 'subtitle_result', 'TEXT'], // JSON: what was embedded and copied
  ['naming_checks', 'status', "TEXT NOT NULL DEFAULT 'done'"], // naming checks run in the background since 4.0
  ['naming_checks', 'finished_at', 'INTEGER'],
  ['naming_checks', 'error', 'TEXT'],
  ['jobs', 'tag', 'TEXT'], // free text set by whoever added the job (an API client's reference), for filtering
];

/**
 * The database file in dataDir: encforge.db. Before the rename to EncForge it was
 * handbrake-ui.db; that file, with the SQLite -wal/-shm files that belong to it, is moved
 * to the new name once. The main file goes last, so an interrupted move ends on the next start.
 * Returns { file, renamedFrom } (renamedFrom: the old path, when it was just moved).
 */
export function adoptDbFile(dataDir) {
  const file = path.join(dataDir, 'encforge.db');
  const legacy = path.join(dataDir, 'handbrake-ui.db');
  if (fs.existsSync(file) || !fs.existsSync(legacy)) return { file, renamedFrom: null };
  for (const ext of ['-wal', '-shm', '']) {
    if (fs.existsSync(legacy + ext)) fs.renameSync(legacy + ext, file + ext);
  }
  return { file, renamedFrom: legacy };
}

export function openDb(file) {
  const db = new DatabaseSync(file);
  const hadHistory = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'job_history'`).get();
  db.exec(SCHEMA);
  for (const [table, column, type] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS jobs_tag ON jobs(tag)');
  // Before 1.4 there was no history: start it from the finished jobs still listed.
  if (!hadHistory) backfillHistory(db);
  return db;
}

/** Runs fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
