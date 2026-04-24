self.addEventListener('push', function (event) {
    if (event.data) {
      const data = event.data.json();
      const options = {
        body: data.body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: { url: data.url || '/dashboard' },
        vibrate: [200, 100, 200]
      };
      event.waitUntil(self.registration.showNotification(data.title, options));
    }
});
  
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        // If app is already open, focus it and navigate
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            client.navigate(event.notification.data.url);
            return client.focus();
          }
        }
        // If app is closed, open a new window
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url);
        }
      })
    );
});