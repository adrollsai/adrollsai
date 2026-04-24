self.addEventListener('push', function (event) {
  if (!event.data) return;
  
  let data = {};
  try {
      data = event.data.json();
  } catch (e) {
      // Fallback just in case the JSON parsing fails
      data = { title: 'New Alert', body: event.data.text(), url: '/dashboard' };
  }

  const options = {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: { url: data.url || '/dashboard' },
      vibrate: [200, 100, 200],
      requireInteraction: true // Forces the notification to stay on screen
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

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