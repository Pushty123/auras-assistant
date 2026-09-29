// Bump this version every time you upload new files (v2 → v3 → ...)
const CACHE_NAME = 'aura-cache-v2';

const APP_SHELL = [
  './',
  './index.html',
  './aura.js',
  './aura-ui.js',
  './manifest.json',
  './icon/aura-icon.svg',
  './icon/icon-192.png',
  './icon/icon-512.png',
  './icon/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network first: always try the latest version from GitHub,
// fall back to the cache only when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't cache weather API calls

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) =>
          cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
