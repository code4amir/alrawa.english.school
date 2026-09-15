// The build-stamp placeholder below is replaced with the build timestamp by
// the vite plugin in vite.config.ts. Because the SW file's bytes change on
// every deploy, the browser always detects a new service worker, which (via
// skipWaiting + clients.claim below) takes control and triggers the
// controllerchange reload in main.tsx — so devices never keep executing a
// stale cached bundle.
const CACHE = 'alrawa-__BUILD_STAMP__';
const PARENT_CACHE = 'parent-cache-v1';
// Reference data: global (same for every role), changes rarely. Served
// stale-while-revalidate so sections open instantly on repeat visits.
// NEVER add per-user data here (students, attendance, results, finance
// transactions/balances) — it would leak across accounts on shared devices.
const REF_CACHE = 'alrawa-ref-v1';
const REF_PATHS = [
  '/api/classes/', '/api/subjects', '/api/academic-years/',
  '/api/service-types/', '/api/settings/', '/api/finance/fee-schedules/',
  '/api/books/', '/api/categories/',
  '/api/bootstrap/', '/api/dashboard-summary/',
];
const isRefRequest = (url) => REF_PATHS.some((p) => url.includes(p));
const PRECACHE_URLS = ['manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PARENT_CACHE && k !== REF_CACHE).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method === 'GET' && isRefRequest(e.request.url)) {
    e.respondWith((async () => {
      const cache = await caches.open(REF_CACHE);
      const cached = await cache.match(e.request);
      const update = (response) => {
        if (response && response.status === 200) {
          cache.put(e.request, response.clone()).catch(() => {});
        }
        return response;
      };
      if (cached) {
        // Fast networks get fresh data (also right after an admin edit);
        // slow networks fall back to cache after 300ms while the network
        // copy updates the cache in the background. Offline serves cache.
        const network = fetch(e.request).then(update).catch(() => null);
        const fallback = new Promise((resolve) => setTimeout(() => resolve(cached), 300));
        return Promise.race([network.then((res) => res || cached), fallback]);
      }
      const fresh = await fetch(e.request).catch(() => null);
      if (fresh) update(fresh);
      return fresh || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    if (e.request.method === 'GET' && e.request.url.includes('/api/parents/')) {
      e.respondWith(
        caches.open(PARENT_CACHE).then((cache) =>
          fetch(e.request).then((response) => {
            if (response.status === 200) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(() => cache.match(e.request))
        )
      );
    }
    return;
  }
  if (!e.request.url.startsWith('http')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(e.request);
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((response) => {
      if (response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'AL RAWA', body: '' };
  try {
    if (e.data) data = e.data.json();
  } catch {}
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: data.data || {},
    vibrate: [200, 100, 200],
  };
  e.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(url.split('#')[0]) && 'focus' in client) {
          client.focus();
          if (url) client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) clients.openWindow(url);
    })
  );
});
