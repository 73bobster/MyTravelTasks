// Service worker: keeps the app shell available offline. Network first, so updates arrive as soon as you are online.
// Bump CACHE when you change the SHELL list.
const CACHE = 'mtt-shell-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/tokens.css', '/css/app.css',
  '/js/core.js', '/js/store.js', '/js/app.js',
  '/icons/icon.svg', '/icons/icon-192.png',
  '/assets/fonts/sora-400.woff2', '/assets/fonts/sora-600.woff2', '/assets/fonts/sora-700.woff2', '/assets/fonts/sora-800.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())),
      ),
  );
});
