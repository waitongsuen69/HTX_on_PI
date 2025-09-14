self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // Dev-friendly: network-first; on failure, return a minimal 503 response
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch (_) {
      // Avoid returning undefined (must return a Response)
      return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
    }
  })());
});
