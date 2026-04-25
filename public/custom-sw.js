self.addEventListener('push', function (event) {
  if (!event.data) return;
  
  let data = {};
  try {
      data = event.data.json();
  } catch (e) {
      data = { title: 'CRM Alert', body: 'You have a new update.', url: '/dashboard' };
  }

  const title = data.title || 'Adrolls CRM';
  
  // CRITICAL iOS FIX: 
  // 'tag' prevents iOS from silently grouping this with older notifications.
  // 'renotify: true' forces the phone to buzz/wake the screen every single time.
  const options = {
      body: data.body || '',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: { url: data.url || '/dashboard' },
      tag: 'reminder-' + Date.now(), 
      renotify: true 
  };

  event.waitUntil(self.registration.showNotification(title, options));
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