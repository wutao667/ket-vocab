import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createSyncServer } from './server.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ket-sync-http-'));
  const { server } = createSyncServer({ dbPath: join(dir, 'test.sqlite3') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
    rmSync(dir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP health and two-step auth flow return unified JSON', async (t) => {
  const base = await fixture(t);
  let response = await fetch(`${base}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  response = await fetch(`${base}/api/v1/auth/lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'HTTP User' }),
  });
  assert.deepEqual(await response.json(), { exists: false, username: 'HTTP User', userId: null });

  response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'HTTP User', create: false, deviceId: 'http-device' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'USERNAME_NOT_FOUND');

  response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'HTTP User', create: true, deviceId: 'http-device' }),
  });
  assert.equal(response.status, 201);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=2592000/);
  const cookie = setCookie.split(';')[0];
  response = await fetch(`${base}/api/v1/auth/session`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).username, 'HTTP User');
});

test('HTTP layer rejects forbidden/missing browser Origin and oversized body', async (t) => {
  const base = await fixture(t);
  let response = await fetch(`${base}/api/v1/auth/lookup`, {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_FORBIDDEN');

  response = await fetch(`${base}/api/v1/auth/lookup`, {
    method: 'POST', headers: { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_REQUIRED');

  response = await fetch(`${base}/api/v1/auth/lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"padding":"${'x'.repeat(256 * 1024)}"}`,
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('HTTP write limiter allows 60 requests per client IP and rejects the next one', async (t) => {
  const base = await fixture(t);
  for (let index = 0; index < 60; index += 1) {
    const response = await fetch(`${base}/api/v1/auth/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
      body: JSON.stringify({ username: 'Rate User' }),
    });
    assert.equal(response.status, 200);
  }
  const response = await fetch(`${base}/api/v1/auth/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.10' },
    body: JSON.stringify({ username: 'Rate User' }),
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
});
