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
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
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
