import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username_key TEXT NOT NULL UNIQUE,
  username_display TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS lists (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_seq INTEGER,
  PRIMARY KEY (user_id, list_id)
);

CREATE TABLE IF NOT EXISTS list_vocab (
  user_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  vocab_id TEXT NOT NULL,
  present INTEGER NOT NULL CHECK (present IN (0,1)),
  changed_seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, list_id, vocab_id),
  FOREIGN KEY (user_id, list_id) REFERENCES lists(user_id, list_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS list_vocab_present_idx ON list_vocab(user_id, list_id, present);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vocab_id TEXT NOT NULL,
  present INTEGER NOT NULL CHECK (present IN (0,1)),
  source_list_id TEXT,
  created_at INTEGER,
  changed_seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, vocab_id)
);

CREATE TABLE IF NOT EXISTS operations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  op_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  result_status TEXT NOT NULL DEFAULT 'applied',
  result_code TEXT,
  client_time INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, op_id)
);
CREATE INDEX IF NOT EXISTS operations_user_seq_idx ON operations(user_id, seq);

CREATE TABLE IF NOT EXISTS user_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  min_cursor INTEGER NOT NULL DEFAULT 0
);
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', '1');
`;

export function openDatabase(path) {
  const directory = dirname(path);
  const directoryExisted = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Never chmod an arbitrary existing parent supplied through KET_SYNC_DB (for example /tmp).
  if (!directoryExisted || directory === '/var/lib/ket-sync') {
    try { chmodSync(directory, 0o700); } catch { /* startup may run without ownership */ }
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(SCHEMA);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
}

export function currentCursor(db, userId) {
  return Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS cursor FROM operations WHERE user_id = ?').get(userId).cursor);
}
