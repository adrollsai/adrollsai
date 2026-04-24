self.addEventListener('push', function (event) {
  if (!event.data) return;
  
  let data = {};
  try {
      data = event.data.json();
  } catch (e) {
      data = { title: 'New Alert', body: 'You have a new notification.', url: '/dashboard' };
  }

  // Stripped out 'vibrate' and 'requireInteraction' which cause silent crashes on iOS
  const options = {
      body: data.body,
      icon: '/icon-192x192.png',
      data: { url: data.url || '/dashboard' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Find any open window/tab
      if (clientList.length > 0) {
          let client = clientList[0];
          for (let i = 0; i < clientList.length; i++) {
              if (clientList[i].focused) client = clientList[i];
          }
          if ('navigate' in client) {
              client.navigate(event.notification.data.url);
          }
          return client.focus();
      }
      // If app is fully closed, open it
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});