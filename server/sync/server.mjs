#!/usr/bin/env node
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { ALLOWED_ORIGINS, DB_PATH, HOST, MAX_BODY_BYTES, PORT } from './config.mjs';
import { openDatabase } from './db.mjs';
import {
  authenticate,
  clearSessionCookie,
  loginUser,
  logoutUser,
  lookupUser,
  sessionCookie,
} from './auth.mjs';
import { getSnapshot, synchronize } from './sync.mjs';
import { HttpError } from './validate.mjs';

function errorBody(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = status === 204 ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...(status === 204 ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...extraHeaders,
  });
  res.end(body);
}

async function readJson(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 256 KiB');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 256 KiB');
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'request body is not valid JSON');
  }
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isBrowserRequest(req) {
  return Boolean(req.headers['sec-fetch-site']) || /Mozilla\//i.test(req.headers['user-agent'] || '');
}

function makeRateLimiter(nowFn = Date.now) {
  const buckets = new Map();
  return (ip) => {
    const minute = Math.floor(nowFn() / 60000);
    const current = buckets.get(ip);
    if (!current || current.minute !== minute) {
      buckets.set(ip, { minute, count: 1 });
      if (buckets.size > 10000) {
        for (const [key, value] of buckets) if (value.minute < minute) buckets.delete(key);
      }
      return true;
    }
    current.count += 1;
    return current.count <= 60;
  };
}

function checkWriteRequest(req, rateLimit) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'request origin is not allowed');
  }
  if (!origin && isBrowserRequest(req)) {
    throw new HttpError(403, 'ORIGIN_REQUIRED', 'browser write requests must include Origin');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 256 KiB');
  }
  if (!rateLimit(requestIp(req))) {
    throw new HttpError(429, 'RATE_LIMITED', 'write request rate limit exceeded', true);
  }
}

export function createSyncServer({ dbPath = DB_PATH, db: suppliedDb, now = Date.now } = {}) {
  const db = suppliedDb || openDatabase(dbPath);
  const ownsDb = !suppliedDb;
  const rateLimit = makeRateLimiter(now);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = url.pathname;

      if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
          throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'request origin is not allowed');
        }
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
          'Cache-Control': 'no-store',
          Vary: 'Origin',
        });
        return res.end();
      }

      if (req.method === 'POST') checkWriteRequest(req, rateLimit);

      if (path === '/api/v1/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true });
      }
      if (path === '/api/v1/auth/lookup' && req.method === 'POST') {
        return sendJson(res, 200, lookupUser(db, await readJson(req)));
      }
      if (path === '/api/v1/auth/login' && req.method === 'POST') {
        const result = loginUser(db, await readJson(req), now());
        return sendJson(res, result.status, result.body, { 'Set-Cookie': sessionCookie(result.token) });
      }
      if (path === '/api/v1/auth/logout' && req.method === 'POST') {
        await readJson(req);
        logoutUser(db, req.headers.cookie || '');
        return sendJson(res, 204, null, { 'Set-Cookie': clearSessionCookie });
      }
      if (path === '/api/v1/auth/session' && req.method === 'GET') {
        const auth = authenticate(db, req.headers.cookie || '', now());
        return sendJson(res, 200, { userId: auth.userId, username: auth.username, cursor: auth.cursor });
      }
      if (path === '/api/v1/sync/snapshot' && req.method === 'GET') {
        const auth = authenticate(db, req.headers.cookie || '', now());
        return sendJson(res, 200, getSnapshot(db, auth.userId));
      }
      if (path === '/api/v1/sync' && req.method === 'POST') {
        const body = await readJson(req);
        const auth = authenticate(db, req.headers.cookie || '', now());
        return sendJson(res, 200, synchronize(db, auth.userId, body, now));
      }

      const knownPath = new Set([
        '/api/v1/health', '/api/v1/auth/lookup', '/api/v1/auth/login',
        '/api/v1/auth/logout', '/api/v1/auth/session', '/api/v1/sync/snapshot', '/api/v1/sync',
      ]).has(path);
      if (knownPath) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'method not allowed');
      throw new HttpError(404, 'NOT_FOUND', 'route not found');
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(res, error.status, errorBody(error.code, error.message, error.retryable));
      }
      console.error('[ket-sync] request failed:', error?.stack || error?.message || String(error));
      return sendJson(res, 500, errorBody('INTERNAL_ERROR', 'internal server error', true));
    }
  });
  server.on('close', () => { if (ownsDb) db.close(); });
  return { server, db };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { server } = createSyncServer();
  server.listen(PORT, HOST, () => {
    console.log(`[ket-sync] listening on http://${HOST}:${PORT}`);
    console.log(`[ket-sync] database ${DB_PATH}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
