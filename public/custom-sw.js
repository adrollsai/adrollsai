self.addEventListener('install', (event) => {
  // Forces this SW to become active immediately
  self.skipWaiting() 
})

self.addEventListener('activate', (event) => {
  // Allows the SW to control the page immediately
  event.waitUntil(clients.claim()) 
})

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json()
    
    const options = {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png', // Android only
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: data.url || '/dashboard' // Default to dashboard if missing
      },
      actions: [
        {
          action: 'view', 
          title: 'View',
        }
      ]
    }

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    )
  }
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()

  const targetUrl = event.notification.data.url

  // iOS/PWA: Properly focus existing window or open new one
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 1. Try to find an existing tab/window
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i]
        // Check if client is usable and matches origin
        if (client.url && 'focus' in client) {
          // If we want to navigate:
          return client.navigate(targetUrl).then(c => c.focus())
        }
      }
      
      // 2. If no window open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})