import { createHash, randomBytes } from 'node:crypto';
import { currentCursor, transaction } from './db.mjs';
import { SESSION_TTL_MS } from './config.mjs';
import { HttpError, codePointLength, requirePlainObject, validateDeviceId } from './validate.mjs';

const FORBIDDEN_FORMAT = /[\p{Cc}\p{Cf}]/u;
const ALLOWED_USERNAME = /^[\p{L}\p{N}_\- ]+$/u;
const ALNUM = /[\p{L}\p{N}]/u;

export function normalizeUsername(input) {
  if (typeof input !== 'string') {
    throw new HttpError(400, 'INVALID_USERNAME', 'username must be a string');
  }
  const nfkc = input.normalize('NFKC');
  if (FORBIDDEN_FORMAT.test(nfkc)) {
    throw new HttpError(400, 'INVALID_USERNAME', 'username contains a control or zero-width character');
  }
  const display = nfkc.trim().replace(/\s+/gu, ' ');
  const length = codePointLength(display);
  if (length < 2 || length > 32) {
    throw new HttpError(400, 'INVALID_USERNAME', 'username must be 2-32 characters');
  }
  const codePoints = [...display];
  if (!ALLOWED_USERNAME.test(display) || !ALNUM.test(codePoints[0]) || !ALNUM.test(codePoints.at(-1))) {
    throw new HttpError(400, 'INVALID_USERNAME', 'username contains invalid characters or edge punctuation');
  }
  return { display, key: display.toLowerCase() };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function newUserId(db) {
  for (;;) {
    const id = `usr_${randomBytes(12).toString('base64url')}`;
    if (!db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(id)) return id;
  }
}

export function lookupUser(db, body) {
  requirePlainObject(body);
  const username = normalizeUsername(body.username);
  const row = db.prepare('SELECT user_id, username_display FROM users WHERE username_key = ?').get(username.key);
  return row
    ? { exists: true, username: row.username_display, userId: row.user_id }
    : { exists: false, username: username.display, userId: null };
}

export function loginUser(db, body, now = Date.now()) {
  requirePlainObject(body);
  const username = normalizeUsername(body.username);
  if (typeof body.create !== 'boolean') {
    throw new HttpError(400, 'INVALID_REQUEST', 'create must be a boolean');
  }
  const deviceId = validateDeviceId(body.deviceId);

  return transaction(db, () => {
    let row = db.prepare('SELECT user_id, username_display FROM users WHERE username_key = ?').get(username.key);
    let created = false;
    if (!row) {
      if (!body.create) throw new HttpError(409, 'USERNAME_NOT_FOUND', 'username does not exist');
      const userId = newUserId(db);
      db.prepare(`INSERT INTO users(user_id, username_key, username_display, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)`).run(userId, username.key, username.display, now, now);
      db.prepare('INSERT INTO user_sync_state(user_id, min_cursor) VALUES (?, 0)').run(userId);
      row = { user_id: userId, username_display: username.display };
      created = true;
    } else {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE user_id = ?').run(now, row.user_id);
    }

    const token = randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions(token_hash, user_id, device_id, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(sha256(token), row.user_id, deviceId, now, now, now + SESSION_TTL_MS);
    return {
      status: created ? 201 : 200,
      token,
      body: {
        userId: row.user_id,
        username: row.username_display,
        cursor: currentCursor(db, row.user_id),
        created,
      },
    };
  });
}

export function parseSessionToken(cookieHeader = '') {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'ket_session') return rest.join('=') || null;
  }
  return null;
}

export function authenticate(db, cookieHeader, now = Date.now()) {
  const token = parseSessionToken(cookieHeader);
  if (!token) throw new HttpError(401, 'AUTH_REQUIRED', 'authentication required');
  const tokenHash = sha256(token);
  const row = db.prepare(`SELECT s.user_id, s.device_id, s.expires_at, u.username_display
    FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ?`).get(tokenHash);
  if (!row || Number(row.expires_at) <= now) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    throw new HttpError(401, 'AUTH_REQUIRED', 'session expired or invalid');
  }
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
    .run(now, now + SESSION_TTL_MS, tokenHash);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE user_id = ?').run(now, row.user_id);
  return {
    userId: row.user_id,
    username: row.username_display,
    deviceId: row.device_id,
    cursor: currentCursor(db, row.user_id),
    tokenHash,
  };
}

export function logoutUser(db, cookieHeader) {
  const token = parseSessionToken(cookieHeader);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token) {
  return `ket_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000`;
}

export const clearSessionCookie = 'ket_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0';
