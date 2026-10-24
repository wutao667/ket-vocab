#!/usr/bin/env node
/**
 * KET 背单词应用 — TTS 代理（方案 A）
 *
 * 为什么需要它：上游 tx.huaguo.site 的 /api/tts-* 没有任何 CORS 响应头，
 * 也没处理 OPTIONS 预检（实测预检 405），浏览器跨域调用会被直接拦截。
 * 本服务在主机上以服务端身份转发请求——服务端之间不受 CORS 限制——
 * 再由我们补上可控的 CORS 头给 ket 前端使用。
 *
 * 额外收益：按 (engine, voice, speed, text) 做磁盘缓存。同一个单词第二次
 * 朗读不再打上游，省时且能扛住上游抖动。
 *
 * 环境变量：
 *   PORT            监听端口，默认 3115（仅 127.0.0.1）
 *   TTS_UPSTREAM    上游地址，默认 https://tx.huaguo.site
 *   ALLOWED_ORIGINS 允许的来源，逗号分隔，
 *                   默认 https://ket.huaguo.site,http://localhost:5173
 *   CACHE_DIR       缓存目录，默认 ./tts-cache
 *   CACHE_MAX_MB    缓存上限，默认 200
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 3115);
const HOST = '127.0.0.1';
const UPSTREAM = (process.env.TTS_UPSTREAM || 'https://tx.huaguo.site').replace(/\/+$/, '');
const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  'https://ket.huaguo.site,http://localhost:5173,http://127.0.0.1:5173,'
  + 'http://localhost:4173,http://127.0.0.1:4173')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CACHE_DIR = process.env.CACHE_DIR || join(process.cwd(), 'tts-cache');
const CACHE_MAX_MB = Number(process.env.CACHE_MAX_MB || 200);
const MAX_TEXT = 500;

const ENGINES = new Set(['edge', 'tencent', 'minimax', 'glm']);

mkdirSync(CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers
function corsHeaders(origin) {
  const allow = ALLOWED.includes(origin) ? origin : '';
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allow) h['Access-Control-Allow-Origin'] = allow;
  return h;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, origin, payload) {
  send(res, status, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, JSON.stringify(payload));
}

async function readJson(req, limitBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function cachePath(engine, voice, speed, text) {
  const key = createHash('sha256')
    .update(`${engine}\u0000${voice}\u0000${speed}\u0000${text}`)
    .digest('hex');
  return join(CACHE_DIR, `${key}.mp3`);
}

/** 简单 LRU 兜底：超限时按 mtime 删除最老的一批，避免磁盘被撑爆。 */
function pruneCache() {
  try {
    const files = readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => {
        const p = join(CACHE_DIR, f);
        const s = statSync(p);
        return { p, size: s.size, mtime: s.mtimeMs };
      });
    let total = files.reduce((n, f) => n + f.size, 0);
    const limit = CACHE_MAX_MB * 1024 * 1024;
    if (total <= limit) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= limit * 0.8) break;
      try { unlinkSync(f.p); total -= f.size; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- upstream
async function fetchWithRetry(url, init, attempts = 2, timeoutMs = 20000) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const ctl = AbortSignal.timeout(timeoutMs);
      const r = await fetch(url, { ...init, signal: ctl });
      if (r.ok) return r;
      last = new Error(`上游 ${r.status}`);
      if (r.status < 500 && r.status !== 429) return r;   // 4xx 不重试
    } catch (err) {
      last = err;
    }
    if (i + 1 < attempts) await sleep(400 * (i + 1));
  }
  throw last || new Error('上游不可达');
}

// ---------------------------------------------------------------- routes
async function handleAvailable(req, res, origin) {
  try {
    const r = await fetchWithRetry(`${UPSTREAM}/api/tts-available`, { method: 'GET' }, 2, 8000);
    const data = await r.json();
    return json(res, r.status, origin, data);
  } catch (err) {
    // 上游探测失败时仍返回结构完整的降级结果，前端据此回落到 Web Speech
    return json(res, 200, origin, {
      edge: false, tencent: false, minimax: false, glm: false,
      available: false, preferred: 'local', upstreamError: String(err.message || err),
    });
  }
}

async function handleTts(req, res, origin) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, origin, { error: '请求 JSON 格式错误' });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json(res, 400, origin, { error: 'text 不能为空' });
  if (text.length > MAX_TEXT) {
    return json(res, 400, origin, { error: `text 过长（上限 ${MAX_TEXT} 字符）` });
  }

  const engine = ENGINES.has(body.engine) ? body.engine : 'edge';
  const voice = typeof body.voice === 'string' ? body.voice : '';
  const speed = body.speed ?? 0.85;

  const cached = cachePath(engine, voice, speed, text);
  if (existsSync(cached)) {
    const buf = readFileSync(cached);
    return send(res, 200, {
      ...corsHeaders(origin),
      'Content-Type': 'audio/mpeg',
      'Content-Length': buf.length,
      'X-TTS-Cache': 'HIT',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }, buf);
  }

  try {
    const r = await fetchWithRetry(`${UPSTREAM}/api/tts-${engine}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed }),
    }, 2, 25000);

    const ctype = r.headers.get('content-type') || '';
    if (!r.ok || !ctype.includes('audio')) {
      let detail = '';
      try { detail = await r.text(); } catch { /* ignore */ }
      return json(res, r.ok ? 502 : r.status, origin, {
        error: `上游 ${engine} 失败`,
        status: r.status,
        detail: detail.slice(0, 200),
      });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) {
      return json(res, 502, origin, { error: '上游返回空音频' });
    }
    try {
      writeFileSync(cached, buf);
      pruneCache();
    } catch { /* 缓存失败不影响本次返回 */ }

    return send(res, 200, {
      ...corsHeaders(origin),
      'Content-Type': 'audio/mpeg',
      'Content-Length': buf.length,
      'X-TTS-Cache': 'MISS',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }, buf);
  } catch (err) {
    return json(res, 504, origin, { error: '上游超时或不可达', detail: String(err.message || err) });
  }
}

// ---------------------------------------------------------------- server
const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  // 拒绝未授权的来源（无 Origin 的请求视为同源/服务端调用，放行）
  if (origin && !ALLOWED.includes(origin)) {
    return json(res, 403, origin, { error: '来源未授权' });
  }

  if (url.pathname === '/health') {
    return json(res, 200, origin, { ok: true, upstream: UPSTREAM });
  }
  if (url.pathname === '/api/tts-available') {
    return handleAvailable(req, res, origin);
  }
  if (url.pathname === '/api/tts') {
    if (req.method !== 'POST') return json(res, 405, origin, { error: 'Method Not Allowed' });
    return handleTts(req, res, origin);
  }
  return json(res, 404, origin, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[tts-proxy] listening on http://${HOST}:${PORT}`);
  console.log(`[tts-proxy] upstream   ${UPSTREAM}`);
  console.log(`[tts-proxy] origins    ${ALLOWED.join(', ')}`);
  console.log(`[tts-proxy] cache      ${CACHE_DIR} (max ${CACHE_MAX_MB} MB)`);
});
