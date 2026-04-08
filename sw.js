const CACHE_NAME = 'tezkorish-real-pilot-v31';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/data.js',
  './js/router.js',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/sysone-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/js/pilot-config.js') || url.pathname.endsWith('pilot-config.js')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isAppShellRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async cached => {
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
        return response;
      } catch {
        return caches.match('./index.html');
      }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
