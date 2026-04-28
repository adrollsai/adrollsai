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
  const [permission, setPermission] = useState<NotificationPermission | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      setPermission(Notification.permission)
      
      if (Notification.permission === 'default') {
          setTimeout(() => setShowPrompt(true), 2000) 
      }

      // Register the hardened SW
      navigator.serviceWorker.register('/custom-sw.js').then((reg) => {
          console.log('SW Registered:', reg.scope)
          // If already granted in the past, sync the token silently
          if (Notification.permission === 'granted') {
             syncTokenToDatabase(reg)
          }
      }).catch(err => console.error('SW Registration failed:', err))
    }
  }, [])

  const syncTokenToDatabase = async (registration: ServiceWorkerRegistration) => {
    try {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) throw new Error("Missing VAPID Key")

        // Wait for the SW to be fully active (now instant due to skipWaiting)
        await navigator.serviceWorker.ready;

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
        
        if (!res.ok) {
            const errorData = await res.json()
            console.error("Supabase Sync Failed:", errorData)
        } else {
            console.log("Token secured and saved to DB.")
        }
    } catch (error) {
        console.error('Subscription error:', error)
    }
  }

  const handleAllowClick = async () => {
    setIsSubscribing(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      setShowPrompt(false)

      if (perm === 'granted') {
        const registration = await navigator.serviceWorker.ready
        await syncTokenToDatabase(registration)
      }
    } catch (error) {
      console.error('User denied or failed:', error)
    } finally {
      setIsSubscribing(false)
    }
  }

  if (!isSupported || permission !== 'default' || !showPrompt) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-white p-4 rounded-2xl shadow-xl border border-slate-100 z-[100] animate-in slide-in-from-bottom-10">
      <button onClick={() => setShowPrompt(false)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 transition-colors">
        <X size={16}/>
      </button>
      <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
              <Bell size={20} />
          </div>
          <div>
              <h3 className="font-bold text-slate-800 text-sm">Enable Notifications</h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Get instant push alerts for new leads and daily follow-ups.</p>
              <button 
                onClick={handleAllowClick} 
                disabled={isSubscribing}
                className="mt-3 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform w-full disabled:opacity-50"
              >
                {isSubscribing ? 'Securing...' : 'Allow Notifications'}
              </button>
          </div>
      </div>
    </div>
  )
}