/* __BRAND__ Service Worker
 *
 * 目标：首次在线加载成功后，断网也能从桌面图标打开应用。
 *
 * 缓存策略：
 *   /api/*         → 直接放行，绝不缓存（同步数据必须实时）
 *   /tts/*         → 直接放行，不缓存（音频体积大且可回退到系统语音）
 *   导航请求        → 网络优先，失败回退缓存的应用壳
 *   同源静态资源    → stale-while-revalidate（先用缓存，后台更新）
 *
 * 版本升级：CACHE_VERSION 改变 → activate 阶段清理旧缓存。
 */

const CACHE_VERSION = '__CACHE_PREFIX__-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// 应用壳：断网时必须能拿到的资源
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 逐个添加，单个失败不影响其余（避免一个 404 让整个安装失败）
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* 忽略单个资源失败 */
          }
        }),
      );
      // 新版本立即接管，不等旧标签页关闭
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('__CACHE_PREFIX__-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 判断是否是不该走缓存的请求 */
function isPassthrough(url) {
  if (url.origin !== self.location.origin) return true;          // 跨域
  if (url.pathname.startsWith('/api/')) return true;             // 同步接口
  if (url.pathname.startsWith('/tts/')) return true;             // 语音
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isPassthrough(url)) return;   // 交给浏览器原生处理

  // 导航请求（打开页面 / 刷新）：网络优先，失败回退应用壳
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // 成功拿到新页面就顺手更新壳缓存
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', response.clone()).catch(() => {});
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            (await cache.match('./index.html', { ignoreSearch: true }));
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title>' +
              '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
              '<h1>暂时无法打开</h1><p>这台设备还没有缓存应用。请联网后再试一次。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }
      })(),
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate
  //
  // 注意：event.waitUntil 必须在事件派发时同步调用；在 await 之后调用会抛
  // InvalidStateError。所以这里先同步登记后台更新任务，再交给 respondWith。
  const networkUpdate = (async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  })();
  event.waitUntil(networkUpdate);

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      // 有缓存立即返回（后台更新由 networkUpdate 负责）
      if (cached) return cached;

      const response = await networkUpdate;
      if (response) return response;

      return new Response('', { status: 504, statusText: 'Offline' });
    })(),
  );
});

// 允许页面主动要求跳过等待（新版本提示刷新时用）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
