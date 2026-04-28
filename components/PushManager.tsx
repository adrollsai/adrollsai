'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i) }
  return outputArray
}

export default function PushManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      setPermission(Notification.permission)
      
      if (Notification.permission === 'default') {
          setTimeout(() => setShowPrompt(true), 3000) 
      }

      navigator.serviceWorker.register('/custom-sw.js').then((reg) => {
          console.log('Custom SW registered', reg.scope)
          if (Notification.permission === 'granted') {
             subscribeSilent(reg)
          }
      }).catch(err => console.error('SW registration failed', err))
    }
  }, [])

  const subscribeSilent = async (registration: ServiceWorkerRegistration) => {
    try {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) {
            console.error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY in environment variables.")
            return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        })

        const subData = JSON.parse(JSON.stringify(subscription))
        
        const res = await fetch('/api/web-push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subData.endpoint, keys: subData.keys })
        })
        
        const result = await res.json()

        if (!res.ok) {
            console.error("Database Sync Failed:", result.error)
            alert(`Could not save push token to database: ${result.error}`)
        } else {
            console.log("Push token successfully synced with database!")
        }

    } catch (error: any) {
        console.error('Silent push subscription failed:', error)
        alert(`Subscription API failed: ${error.message}`)
    }
  }

  const subscribe = async () => {
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      setShowPrompt(false)

      if (perm === 'granted') {
        const registration = await navigator.serviceWorker.ready
        await subscribeSilent(registration)
      }
    } catch (error) {
      console.error('Push subscription failed:', error)
    }
  }

  if (!isSupported || permission !== 'default' || !showPrompt) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-white p-4 rounded-2xl shadow-xl border border-slate-100 z-[100] animate-in slide-in-from-bottom-10">
      <button onClick={() => setShowPrompt(false)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600">
        <X size={16}/>
      </button>
      <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
              <Bell size={20} />
          </div>
          <div>
              <h3 className="font-bold text-slate-800 text-sm">Enable Notifications</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Get instant alerts when a new lead comes in from Facebook.</p>
              <button onClick={subscribe} className="mt-3 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform w-full">
                Allow Notifications
              </button>
          </div>
      </div>
    </div>
  )
}