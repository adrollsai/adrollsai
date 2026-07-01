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
      image: data.image,
      tag: data.tag || 'general',
      renotify: data.renotify || false,
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
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

// 3. Handle Click (PWA Focus Fix)
self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const targetUrl = event.notification.data.url

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 1. Try to find an existing window already open to this URL
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i]
        if (client.url === targetUrl && 'focus' in client) {
           return client.focus()
        }
      }
      // 2. If any window is open for this origin (PWA context), focus and navigate it
      if (windowClients.length > 0) {
        const firstClient = windowClients[0]
        if ('focus' in firstClient) {
            return firstClient.focus().then(c => c.navigate(targetUrl))
        }
      }
      // 3. Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})

// 4. Intercept and cache org-icon requests to support offline startup and avoid black splash screen
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/api/org-icon') {
    event.respondWith(
      caches.open('org-icons-cache').then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone())
            }
            return networkResponse
          }).catch((err) => {
            console.warn('Network fetch failed for org-icon:', err)
          })
          return cachedResponse || fetchPromise
        })
      })
    )
  }
})