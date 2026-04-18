// Service Worker — Meetime Push Notifications

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'Meetime', body: event.data.text() }; }

  const { title = 'Meetime', body = '', icon, badge, url = '/', tag, data: extra } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  icon  || '/icon-192.png',
      badge: badge || '/icon-192.png',
      tag:   tag   || 'meetime-notif',
      data:  { url, ...extra },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Foca aba já aberta se existir
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});
