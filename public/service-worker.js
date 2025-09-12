self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  // In dev: always go to network
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

