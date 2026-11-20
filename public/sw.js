// Service worker: makes the app installable and lets open issues load offline.
// App files and API answers are network-first, falling back to the last saved copy.
const SHELL_CACHE = 'jira-tabs-shell-v1';
const API_CACHE = 'jira-tabs-api-v1';
const SHELL = ['/', '/app.css', '/app.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL_CACHE && key !== API_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/jira/') || url.pathname === '/api/config') return; // straight to the network
  if (url.pathname.startsWith('/api/')) return event.respondWith(networkFirst(request, API_CACHE, true));
  event.respondWith(networkFirst(request, SHELL_CACHE, false));
});

async function networkFirst(request, cacheName, isApi) {
  const cache = await caches.open(cacheName);
  const cacheKey = request.mode === 'navigate' ? '/' : request;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (!hit) {
      if (!isApi) throw err;
      return new Response(JSON.stringify({ error: 'You are offline and this has not been loaded before.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!isApi) return hit;
    const headers = new Headers(hit.headers);
    headers.set('X-Offline-Copy', '1');
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }
}
