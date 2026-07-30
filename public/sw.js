/* Minimal shell service worker — no authenticated / invite data caching */
const CACHE = 'heypelo-shell-v2';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.searchParams.has('token') || url.searchParams.has('code') || url.searchParams.has('invite')) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() =>
          caches.match('/offline.html').then((r) => r || caches.match('/index.html')),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg'))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Notification', body: '', url: '/' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: String(parsed.title || payload.title),
          body: String(parsed.body || ''),
          url: String(parsed.url || '/'),
        };
      }
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch {
      // ignore
    }
  }

  const options = {
    body: payload.body,
    data: { url: payload.url || '/' },
    vibrate: [100, 50, 100],
    // silent unset/false — OS may still suppress under Focus/DND
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/';
  const absolute =
    typeof targetUrl === 'string' && targetUrl.startsWith('http')
      ? targetUrl
      : new URL(targetUrl || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && client.url !== absolute) {
            try {
              client.navigate(absolute);
            } catch {
              // ignore navigate failures
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute);
      }
      return undefined;
    }),
  );
});
