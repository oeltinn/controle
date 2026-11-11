// The push worker also provides a safe offline shell for the installed app.
const CACHE = 'kontroll-static-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(
    [OFFLINE, '/kontroll-mark.png', '/manifest.webmanifest'].map(path => cache.add(path))
  )));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kontroll-static-') && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Never serve a stale authenticated dashboard while offline.
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  const staticAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') ||
    ['/kontroll-mark.png', '/fibracenter-footer.png', '/fibracenter-footer-white.png', '/apple-touch-icon.png', '/manifest.webmanifest'].includes(url.pathname);
  if (!staticAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  })());
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = String(data.title || 'kontroll.');
  const body = String(data.body || 'Você recebeu uma nova notificação.');
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/kontroll-mark.png',
    badge: '/kontroll-mark.png',
    tag: data.notificationId || undefined,
    data: { url: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); existing.postMessage({ type: 'open-notifications' }); }
    else await self.clients.openWindow('/');
  })());
});

