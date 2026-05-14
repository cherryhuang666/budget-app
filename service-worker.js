// 张婷要省钱 - Service Worker (离线可用)
const CACHE_VERSION = 'zt-budget-v25';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/defaults.js',
  './js/utils.js',
  './js/db.js',
  './js/charts.js',
  './js/export.js',
  './js/cloud.js',
  './js/app.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // 第三方库（用 CDN 加载，离线时优先用缓存）
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(APP_SHELL).catch(err => {
        // 即使部分外部资源失败，也不要阻断 SW 安装
        console.warn('[SW] precache 部分失败：', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 同步 API 走网络，不进缓存
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 网络优先，失败回退缓存；缓存到就异步刷新
  event.respondWith(
    caches.open(CACHE_VERSION).then(async cache => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && (url.origin === location.origin || url.hostname.includes('jsdelivr.net'))) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return cache.match('./index.html');
        throw e;
      }
    })
  );
});
