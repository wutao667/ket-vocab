import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db.mjs';

test('database initialization creates private directory and database file', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ket-sync-db-'));
  const directory = join(root, 'new-private-directory');
  const path = join(directory, 'database.sqlite3');
  const db = openDatabase(path);
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1);
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
});

test('custom database path does not chmod an existing parent directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ket-sync-db-parent-'));
  const directory = join(root, 'shared');
  mkdirSync(directory, { mode: 0o755 });
  chmodSync(directory, 0o755);
  const db = openDatabase(join(directory, 'database.sqlite3'));
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  assert.equal(statSync(directory).mode & 0o777, 0o755);
});

