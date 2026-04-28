// public/custom-sw.js

// 1. FORCIBLY TAKE OVER THE BROWSER INSTANTLY
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 2. HANDLE INCOMING PUSH
self.addEventListener('push', function (event) {
  if (event.data) {
    try {
      const data = event.data.json();
      const options = {
        body: data.body || 'You have a new notification.',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: { url: data.url || '/dashboard/crm' },
        vibrate: [200, 100, 200],
        requireInteraction: true // Keeps the notification on screen until tapped
      };
      event.waitUntil(self.registration.showNotification(data.title || 'AdRolls AI', options));
    } catch (e) {
      console.error('Push payload was not JSON:', e);
    }
  }
});

// 3. HANDLE CLICKS
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.navigate(event.notification.data.url);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});