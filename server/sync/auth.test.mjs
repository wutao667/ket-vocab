import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeUsername, lookupUser, loginUser, authenticate } from './auth.mjs';
import { openDatabase } from './db.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ket-sync-auth-'));
  const db = openDatabase(join(dir, 'test.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}

test('username normalization handles case, NFKC, and whitespace folding', () => {
  assert.deepEqual(normalizeUsername('  ＷｕＴａｏ  '), { display: 'WuTao', key: 'wutao' });
  assert.deepEqual(normalizeUsername('吴　 涛'), { display: '吴 涛', key: '吴 涛' });
  assert.equal(normalizeUsername('ALIce').key, normalizeUsername('alice').key);
});

test('username normalization rejects length and illegal characters', () => {
  for (const value of ['a', 'a'.repeat(33), '-alice', 'alice_', 'a🙂', 'a\n b', 'a\u200bb']) {
    assert.throws(() => normalizeUsername(value), (error) => error.code === 'INVALID_USERNAME');
  }
});

test('lookup reports nonexistent, existing, and invalid usernames', (t) => {
  const db = fixture(t);
  assert.deepEqual(lookupUser(db, { username: '吴涛' }), { exists: false, username: '吴涛', userId: null });
  const loggedIn = loginUser(db, { username: '吴涛', create: true, deviceId: 'device-a' }, 1000);
  assert.equal(loggedIn.status, 201);
  assert.deepEqual(lookupUser(db, { username: '吴涛' }), {
    exists: true, username: '吴涛', userId: loggedIn.body.userId,
  });
  assert.throws(() => lookupUser(db, { username: '🙂🙂' }), (error) => error.status === 400);
});

test('login creates, logs into existing account idempotently, and rejects missing account', (t) => {
  const db = fixture(t);
  assert.throws(
    () => loginUser(db, { username: 'Alice', create: false, deviceId: 'd1' }, 1000),
    (error) => error.status === 409 && error.code === 'USERNAME_NOT_FOUND',
  );
  const first = loginUser(db, { username: 'Alice', create: true, deviceId: 'd1' }, 1000);
  const second = loginUser(db, { username: 'ＡＬＩＣＥ', create: true, deviceId: 'd2' }, 2000);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.userId, first.body.userId);
  assert.notEqual(second.token, first.token);
  const session = authenticate(db, `other=x; ket_session=${first.token}`, 3000);
  assert.equal(session.userId, first.body.userId);
});

