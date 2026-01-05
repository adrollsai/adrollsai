// 1. Force immediate activation (Critical for iOS updates)
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

// 2. Handle Incoming Push
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json()
    const options = {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png', // Kept from your working version
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: data.url || '/'
      },
      actions: [
        {
          action: 'explore', 
          title: 'View Details',
          icon: '/check.png'
        }
      ]
    }
    event.waitUntil(self.registration.showNotification(data.title, options))
  }
})

// 3. Handle Notification Click (Improved for iOS PWA)
self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const targetUrl = event.notification.data.url

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Check if there is already a window/tab open with the target URL
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i]
        
        // RELIABLE MATCHING: Check if the client matches the origin, not just exact URL
        // This fixes issues where 'dashboard/' vs 'dashboard' caused failures
        if (client.url && 'focus' in client) {
           // If we are already on the site, focus it and navigate
           return client.focus().then(c => c.navigate(targetUrl))
        }
      }
      
      // If not, then open the target URL in a new window/tab.
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})