self.addEventListener('push', function (event) {
  if (!event.data) return;
  
  let data = {};
  try {
      data = event.data.json();
  } catch (e) {
      data = { title: 'Adrolls CRM', body: 'New update received.', url: '/dashboard' };
  }

  // Absolute bare-minimum options. No tags, no renotify, no vibrates.
  // Apple cannot reject this format.
  const options = {
      body: data.body || '',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: { url: data.url || '/dashboard/crm' }
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Adrolls', options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      if (clientList.length > 0) {
          let client = clientList[0];
          for (let i = 0; i < clientList.length; i++) {
              if (clientList[i].focused) client = clientList[i];
          }
          if ('navigate' in client) {
              return client.navigate(event.notification.data.url).then(c => c ? c.focus() : null);
          }
          return client.focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});