const CACHE_NAME = 'sidur-v1';

const SHELL = [
  '/sidur/',
  '/sidur/index.html',
  '/sidur/css/style.css',
  '/sidur/js/api.js',
  '/sidur/js/storage.js',
  '/sidur/js/ui.js',
  '/sidur/js/app.js',
  '/sidur/favicon.svg',
  '/sidur/manifest.json',
  '/sidur/icons/icon-192.png',
  '/sidur/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' bypasses the HTTP cache so we always get fresh files
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Sefaria API — cache-first, update in background
  if (url.hostname === 'www.sefaria.org') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          const network = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => null);
          return cached || network;
        })
      )
    );
    return;
  }

  // App shell — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }))
    );
    return;
  }
});
