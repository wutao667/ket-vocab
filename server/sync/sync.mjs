import { MAX_CHANGES, MAX_LISTS_PER_USER, MAX_OPERATIONS } from './config.mjs';
import { currentCursor, transaction } from './db.mjs';
import {
  HttpError,
  requirePlainObject,
  requireString,
  validateClientTime,
  validateCursor,
  validateDeviceId,
  validateListName,
  validateOpaqueId,
  validateVocabId,
} from './validate.mjs';

const KINDS = new Set(['list.create', 'list.rename', 'list.delete', 'list.vocab.set', 'favorite.set']);

function validateOperation(raw) {
  requirePlainObject(raw, 'operation');
  const opId = validateOpaqueId(raw.opId, 'opId');
  if (!KINDS.has(raw.kind)) throw new HttpError(400, 'INVALID_OPERATION', 'unsupported operation kind');
  const kind = raw.kind;
  const entityId = kind === 'favorite.set'
    ? validateVocabId(raw.entityId)
    : validateOpaqueId(raw.entityId, 'entityId');
  const payload = requirePlainObject(raw.payload, 'payload');
  const clientTime = validateClientTime(raw.clientTime);
  let cleanPayload;

  if (kind === 'list.create') {
    if (!Array.isArray(payload.vocabIds)) throw new HttpError(400, 'INVALID_REQUEST', 'vocabIds must be an array');
    if (payload.vocabIds.length > 1723) throw new HttpError(400, 'INVALID_REQUEST', 'too many vocabIds');
    cleanPayload = {
      name: validateListName(payload.name),
      vocabIds: [...new Set(payload.vocabIds.map(validateVocabId))],
    };
  } else if (kind === 'list.rename') {
    cleanPayload = { name: validateListName(payload.name) };
  } else if (kind === 'list.delete') {
    cleanPayload = {};
  } else if (kind === 'list.vocab.set') {
    if (typeof payload.present !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'present must be a boolean');
    cleanPayload = { vocabId: validateVocabId(payload.vocabId), present: payload.present };
  } else {
    if (typeof payload.present !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'present must be a boolean');
    cleanPayload = { present: payload.present };
    if (payload.sourceListId !== undefined) {
      cleanPayload.sourceListId = validateOpaqueId(payload.sourceListId, 'sourceListId');
    }
  }
  return { opId, kind, entityId, payload: cleanPayload, clientTime };
}

function reject(db, seq, code) {
  db.prepare("UPDATE operations SET result_status = 'rejected', result_code = ? WHERE seq = ?").run(code, seq);
  return { status: 'rejected', code };
}

function applyOperation(db, userId, operation, seq, now) {
  const { kind, entityId, payload } = operation;
  if (kind === 'list.create') {
    const existing = db.prepare('SELECT deleted_at FROM lists WHERE user_id = ? AND list_id = ?').get(userId, entityId);
    if (existing) return reject(db, seq, existing.deleted_at === null ? 'LIST_EXISTS' : 'LIST_DELETED');
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM lists WHERE user_id = ? AND deleted_at IS NULL').get(userId).count);
    if (count >= MAX_LISTS_PER_USER) return reject(db, seq, 'LIST_LIMIT_REACHED');
    db.prepare(`INSERT INTO lists(user_id, list_id, name, name_seq, created_at, deleted_at, deleted_seq)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run(userId, entityId, payload.name, seq, now);
    const insertVocab = db.prepare(`INSERT INTO list_vocab(user_id, list_id, vocab_id, present, changed_seq)
      VALUES (?, ?, ?, 1, ?)`);
    for (const vocabId of payload.vocabIds) insertVocab.run(userId, entityId, vocabId, seq);
    return { status: 'applied' };
  }

  if (kind === 'favorite.set') {
    const sourceListId = payload.present ? (payload.sourceListId ?? null) : null;
    const createdAt = payload.present ? now : null;
    db.prepare(`INSERT INTO favorites(user_id, vocab_id, present, source_list_id, created_at, changed_seq)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, vocab_id) DO UPDATE SET
        present=excluded.present,
        source_list_id=excluded.source_list_id,
        created_at=CASE WHEN excluded.present=1 AND favorites.present=1
          THEN favorites.created_at ELSE excluded.created_at END,
        changed_seq=excluded.changed_seq`)
      .run(userId, entityId, payload.present ? 1 : 0, sourceListId, createdAt, seq);
    return { status: 'applied' };
  }

  const list = db.prepare('SELECT deleted_at FROM lists WHERE user_id = ? AND list_id = ?').get(userId, entityId);
  if (!list) return reject(db, seq, 'LIST_NOT_FOUND');
  if (list.deleted_at !== null && kind !== 'list.delete') return reject(db, seq, 'LIST_DELETED');

  if (kind === 'list.rename') {
    db.prepare('UPDATE lists SET name = ?, name_seq = ? WHERE user_id = ? AND list_id = ?')
      .run(payload.name, seq, userId, entityId);
  } else if (kind === 'list.delete') {
    if (list.deleted_at === null) {
      db.prepare('UPDATE lists SET deleted_at = ?, deleted_seq = ? WHERE user_id = ? AND list_id = ?')
        .run(now, seq, userId, entityId);
    }
  } else {
    db.prepare(`INSERT INTO list_vocab(user_id, list_id, vocab_id, present, changed_seq)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, list_id, vocab_id) DO UPDATE SET
        present=excluded.present, changed_seq=excluded.changed_seq`)
      .run(userId, entityId, payload.vocabId, payload.present ? 1 : 0, seq);
  }
  return { status: 'applied' };
}

function getChanges(db, userId, cursor) {
  const rows = db.prepare(`SELECT seq, kind, entity_id, payload_json, received_at
    FROM operations WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`)
    .all(userId, cursor, MAX_CHANGES + 1);
  const hasMore = rows.length > MAX_CHANGES;
  const page = hasMore ? rows.slice(0, MAX_CHANGES) : rows;
  const changes = page.map((row) => ({
    seq: Number(row.seq),
    kind: row.kind,
    entityId: row.entity_id,
    payload: JSON.parse(row.payload_json),
    serverTime: Number(row.received_at),
  }));
  const nextCursor = changes.length ? changes.at(-1).seq : currentCursor(db, userId);
  return { changes, cursor: nextCursor, hasMore };
}

export function synchronize(db, userId, body, nowFn = Date.now) {
  requirePlainObject(body);
  if (body.protocolVersion !== 1) throw new HttpError(400, 'UNSUPPORTED_PROTOCOL', 'protocolVersion must be 1');
  const deviceId = validateDeviceId(body.deviceId);
  const cursor = validateCursor(body.cursor);
  if (!Array.isArray(body.operations)) throw new HttpError(400, 'INVALID_REQUEST', 'operations must be an array');
  if (body.operations.length > MAX_OPERATIONS) throw new HttpError(400, 'TOO_MANY_OPERATIONS', 'at most 100 operations are allowed');
  const operations = body.operations.map(validateOperation);
  const state = db.prepare('SELECT min_cursor FROM user_sync_state WHERE user_id = ?').get(userId);
  const minCursor = Number(state?.min_cursor ?? 0);
  if (cursor < minCursor) throw new HttpError(409, 'CURSOR_EXPIRED', 'cursor is older than retained changes');
  if (cursor > currentCursor(db, userId)) throw new HttpError(400, 'INVALID_CURSOR', 'cursor is ahead of the server');

  return transaction(db, () => {
    const results = [];
    for (const operation of operations) {
      const previous = db.prepare('SELECT seq, result_code FROM operations WHERE user_id = ? AND op_id = ?')
        .get(userId, operation.opId);
      if (previous) {
        const result = { opId: operation.opId, status: 'duplicate', seq: Number(previous.seq) };
        if (previous.result_code) result.code = previous.result_code;
        results.push(result);
        continue;
      }
      const now = nowFn();
      const inserted = db.prepare(`INSERT INTO operations
        (user_id, op_id, device_id, kind, entity_id, payload_json, received_at, result_status, result_code, client_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', NULL, ?)`)
        .run(userId, operation.opId, deviceId, operation.kind, operation.entityId,
          JSON.stringify(operation.payload), now, operation.clientTime);
      const seq = Number(inserted.lastInsertRowid);
      const outcome = applyOperation(db, userId, operation, seq, now);
      const result = { opId: operation.opId, status: outcome.status, seq };
      if (outcome.code) result.code = outcome.code;
      results.push(result);
    }
    return { results, ...getChanges(db, userId, cursor) };
  });
}

export function getSnapshot(db, userId) {
  const listRows = db.prepare(`SELECT list_id, name, created_at, deleted_at
    FROM lists WHERE user_id = ? ORDER BY created_at, list_id`).all(userId);
  const vocabStatement = db.prepare(`SELECT vocab_id, present FROM list_vocab
    WHERE user_id = ? AND list_id = ? AND present = 1 ORDER BY vocab_id`);
  const lists = listRows.map((row) => ({
    listId: row.list_id,
    name: row.name,
    createdAt: Number(row.created_at),
    deletedAt: row.deleted_at === null ? null : Number(row.deleted_at),
    vocab: vocabStatement.all(userId, row.list_id).map((item) => ({
      vocabId: item.vocab_id,
      present: Boolean(item.present),
    })),
  }));
  const favorites = db.prepare(`SELECT vocab_id, source_list_id, created_at FROM favorites
    WHERE user_id = ? AND present = 1 ORDER BY vocab_id`).all(userId).map((row) => {
    const favorite = { vocabId: row.vocab_id, present: true };
    if (row.source_list_id !== null) favorite.sourceListId = row.source_list_id;
    favorite.createdAt = Number(row.created_at);
    return favorite;
  });
  return { protocolVersion: 1, cursor: currentCursor(db, userId), lists, favorites };
}
