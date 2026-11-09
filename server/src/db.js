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
  format       TEXT NOT NULL,    -- av_mkv | av_mp4 | av_webm
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
`;

/** Columns added after the first release. */
const MIGRATIONS = [
  ['jobs', 'rename_note', 'TEXT'],
  ['jobs', 'verify', 'TEXT'], // JSON result of the check after conversion
  ['jobs', 'verify_status', 'TEXT'], // ok | warning | error | skipped | running
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, column, type] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
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
