import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginUser } from './auth.mjs';
import { openDatabase } from './db.mjs';
import { getSnapshot, synchronize } from './sync.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ket-sync-core-'));
  const db = openDatabase(join(dir, 'test.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const user = (name, device = 'device-a') => loginUser(db, {
    username: name, create: true, deviceId: device,
  }, 1000).body.userId;
  return { db, user };
}

let opCounter = 0;
function op(kind, entityId, payload, extra = {}) {
  opCounter += 1;
  return { opId: `op-${opCounter}`, kind, entityId, payload, clientTime: 1000 + opCounter, ...extra };
}
function sync(db, userId, operations, cursor = 0, deviceId = 'device-a') {
  let clock = 2000;
  return synchronize(db, userId, { protocolVersion: 1, deviceId, cursor, operations }, () => ++clock);
}

test('snapshot supports empty state, data, favorites, and list tombstones', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Snapshot User');
  assert.deepEqual(getSnapshot(db, userId), { protocolVersion: 1, cursor: 0, lists: [], favorites: [] });
  sync(db, userId, [
    op('list.create', 'list-1', { name: 'Unit 3', vocabIds: ['ket-0042'] }),
    op('favorite.set', 'ket-0042', { present: true, sourceListId: 'list-1' }),
  ]);
  let snapshot = getSnapshot(db, userId);
  assert.equal(snapshot.lists[0].vocab[0].vocabId, 'ket-0042');
  assert.equal(snapshot.favorites[0].sourceListId, 'list-1');
  sync(db, userId, [op('list.delete', 'list-1', {})], snapshot.cursor);
  snapshot = getSnapshot(db, userId);
  assert.equal(typeof snapshot.lists[0].deletedAt, 'number');
});

test('later rename wins within the list-name conflict domain', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Rename User');
  sync(db, userId, [op('list.create', 'list-1', { name: 'Original', vocabIds: [] })]);
  sync(db, userId, [op('list.rename', 'list-1', { name: 'Device A' })], 0, 'device-a');
  sync(db, userId, [op('list.rename', 'list-1', { name: 'Device B' })], 0, 'device-b');
  assert.equal(getSnapshot(db, userId).lists[0].name, 'Device B');
});

test('different list vocab conflict domains preserve concurrent additions', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Vocab User');
  sync(db, userId, [op('list.create', 'list-1', { name: 'Words', vocabIds: [] })]);
  sync(db, userId, [op('list.vocab.set', 'list-1', { vocabId: 'ket-0001', present: true })], 0, 'a');
  sync(db, userId, [op('list.vocab.set', 'list-1', { vocabId: 'ket-0002', present: true })], 0, 'b');
  assert.deepEqual(getSnapshot(db, userId).lists[0].vocab.map((v) => v.vocabId), ['ket-0001', 'ket-0002']);
});

test('delete wins and a later vocab operation is rejected but appears in changes', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Delete User');
  const create = sync(db, userId, [op('list.create', 'list-1', { name: 'Words', vocabIds: [] })]);
  const deletion = sync(db, userId, [op('list.delete', 'list-1', {})], create.cursor);
  const attempted = op('list.vocab.set', 'list-1', { vocabId: 'ket-0001', present: true });
  const result = sync(db, userId, [attempted], deletion.cursor);
  assert.deepEqual(result.results[0], {
    opId: attempted.opId, status: 'rejected', seq: result.results[0].seq, code: 'LIST_DELETED',
  });
  assert.equal(result.changes[0].kind, 'list.vocab.set');
  assert.deepEqual(getSnapshot(db, userId).lists[0].vocab, []);
});

test('same name with different IDs remains two lists', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Same Name');
  sync(db, userId, [
    op('list.create', 'list-a', { name: 'Same', vocabIds: [] }),
    op('list.create', 'list-b', { name: 'Same', vocabIds: [] }),
  ]);
  assert.deepEqual(getSnapshot(db, userId).lists.map((list) => list.listId), ['list-a', 'list-b']);
});

test('duplicate opId returns duplicate with original seq and has no second effect', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Idempotent User');
  const operation = op('favorite.set', 'ket-0007', { present: true });
  const first = sync(db, userId, [operation]);
  const second = sync(db, userId, [operation], first.cursor);
  assert.equal(second.results[0].status, 'duplicate');
  assert.equal(second.results[0].seq, first.results[0].seq);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operations').get().count, 1);
});

test('incremental changes honor cursor and paginate at 500', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Paging User');
  const operations = Array.from({ length: 501 }, (_, index) =>
    op('favorite.set', `ket-${String(index + 1).padStart(4, '0')}`, { present: true }));
  for (let start = 0; start < operations.length; start += 100) {
    sync(db, userId, operations.slice(start, start + 100));
  }
  const firstPage = sync(db, userId, [], 0);
  assert.equal(firstPage.changes.length, 500);
  assert.equal(firstPage.hasMore, true);
  const secondPage = sync(db, userId, [], firstPage.cursor);
  assert.equal(secondPage.changes.length, 1);
  assert.equal(secondPage.hasMore, false);
  assert.ok(secondPage.changes[0].seq > firstPage.cursor);
});

test('users are isolated in snapshots and change feeds', (t) => {
  const { db, user } = fixture(t);
  const alice = user('Alice User');
  const bob = user('Bob User');
  sync(db, alice, [op('list.create', 'alice-list', { name: 'Alice only', vocabIds: ['ket-0001'] })]);
  sync(db, bob, [op('favorite.set', 'ket-0002', { present: true })]);
  assert.deepEqual(getSnapshot(db, alice).favorites, []);
  assert.deepEqual(getSnapshot(db, bob).lists, []);
  assert.equal(sync(db, alice, [], 0).changes.length, 1);
  assert.equal(sync(db, bob, [], 0).changes.length, 1);
});

test('validation rejects invalid vocab IDs and overlong list names', (t) => {
  const { db, user } = fixture(t);
  const userId = user('Validate User');
  assert.throws(
    () => sync(db, userId, [op('favorite.set', 'ket-1724', { present: true })]),
    (error) => error.code === 'INVALID_VOCAB_ID',
  );
  assert.throws(
    () => sync(db, userId, [op('list.create', 'list-1', { name: 'x'.repeat(81), vocabIds: [] })]),
    (error) => error.code === 'INVALID_LIST_NAME',
  );
});

