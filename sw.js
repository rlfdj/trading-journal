// sw.js — offline cache. Bump VERSION on every deploy so phones pick up the update.
const VERSION = '1.0.1';
const CACHE = `tj-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './fonts/InterTight-latin.woff2',
  './fonts/JetBrainsMono-latin.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32.png',
  './js/app.js',
  './js/backup.js',
  './js/calc.js',
  './js/csv.js',
  './js/defaults.js',
  './js/format.js',
  './js/image.js',
  './js/pwa.js',
  './js/sample.js',
  './js/store.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/journal.js',
  './js/views/settings.js',
  './js/views/stats.js',
  './js/views/trade.js',
  './tests.html',
  './js/tests/calc.test.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so a new version never mixes in old files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: the page shows "Update available" and the user decides.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tj-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const page = await cache.match(req, { ignoreSearch: true });
      if (page) return page;
      try { return await fetch(req); } catch { return (await cache.match('./index.html')) || Response.error(); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
