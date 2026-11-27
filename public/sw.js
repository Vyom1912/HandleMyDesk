/*
 * HandleMyDesk service worker: shows notifications sent by the server while the app is closed,
 * and opens the right page when one is tapped. It does not cache anything.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'HandleMyDesk', {
      body: data.body || '',
      icon: '/icons/icon-192.png?v=2',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      // A newer notification about the same thing still buzzes the phone
      renotify: !!data.tag,
      vibrate: [120, 60, 120],
      data: { url: data.url || '/' },
    })
  );
  // Show that something is waiting on the app icon (the app sets the exact count when opened)
  if (self.navigator && 'setAppBadge' in self.navigator) self.navigator.setAppBadge().catch(() => {});
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open HandleMyDesk window if there is one
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) return client.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
