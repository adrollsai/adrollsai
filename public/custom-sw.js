// public/custom-sw.js

// 1. Force Immediate Activation (The "Greedy" Fix)
self.addEventListener('install', (event) => {
  // This tells the browser to throw out the old SW and use this one NOW
  self.skipWaiting() 
})

self.addEventListener('activate', (event) => {
  // This tells the SW to control the page immediately, not wait for reload
  event.waitUntil(clients.claim()) 
})

// 2. Handle Push Event
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json()
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192x192.png',
      badge: data.badge || data.icon || '/icon-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: data.url || '/'
      },
      actions: [
        {
          action: 'explore', 
          title: 'View',
        }
      ]
    }
    event.waitUntil(self.registration.showNotification(data.title, options))
  }
})

// 3. Handle Click (iOS Focus Fix)
self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const targetUrl = event.notification.data.url

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // A. Try to find an existing window to focus
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i]
        // Match origin to ensure we own the window
        if (client.url && 'focus' in client) {
           return client.focus().then(c => c.navigate(targetUrl))
        }
      }
      // B. If no window open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})