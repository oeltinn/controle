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

