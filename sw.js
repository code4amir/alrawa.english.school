const CACHE = 'alrawa-v7';
const PARENT_CACHE = 'parent-cache-v1';
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
      caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PARENT_CACHE).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (e) => {
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
