'use client'

import { useEffect, useState } from 'react'
import { BellRing, Check, Loader2, Send, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export default function PushManager() {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [loading, setLoading] = useState(false)
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default')

  useEffect(() => {
    // 1. Check Browser Support
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      
      // RESTORED: Manually register your custom SW immediately
      registerCustomSW()
      
      if ('Notification' in window) {
          setPermissionState(Notification.permission)
      }
    }
  }, [])

  // This function ensures YOUR file is the one controlling the PWA
  async function registerCustomSW() {
    try {
      // Force registration of custom-sw.js
      const registration = await navigator.serviceWorker.register('/custom-sw.js', {
        scope: '/',
        updateViaCache: 'none', // Ensure we always get the latest version
      })

      // Wait for it to be ready
      await navigator.serviceWorker.ready
      
      const sub = await registration.pushManager.getSubscription()
      setSubscription(sub)
      console.log("Custom SW Registered ✅")
    } catch (error) {
      console.error('Service Worker registration failed:', error)
    }
  }

  async function subscribeToPush() {
    setLoading(true)
    try {
      // We wait for the registration we just triggered above
      const registration = await navigator.serviceWorker.ready
      
      // Double check if the active worker is ours
      if (registration.active?.scriptURL.includes('custom-sw.js')) {
          console.log("Confirmed: Using Custom SW")
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      
      if (!vapidKey) {
        toast.error("Configuration Error: Missing VAPID Key")
        return
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      })

      setSubscription(sub)
      setPermissionState('granted')

      // Send to backend
      await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      })

      toast.success("Notifications Enabled!", {
        description: "You will now receive high-value alerts."
      })

    } catch (error: any) {
      console.error('Failed to subscribe:', error)
      if (Notification.permission === 'denied') {
          setPermissionState('denied')
          toast.error("Permission Denied")
      } else {
          toast.error("Failed to enable notifications.")
      }
    } finally {
        setLoading(false)
    }
  }

  async function triggerBackgroundTest() {
      setLoading(true)
      toast.info("Testing...", { 
        description: "Exit the app (Home Screen) NOW to receive the push!" 
      })

      try {
          // Use the test API
          await fetch('/api/test-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ delay: 5 }), 
          })
      } catch (e) {
          toast.error("Test failed")
      } finally {
          setLoading(false)
      }
  }

  if (!isSupported) return null

  return (
    <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-2">
      
      {/* CASE 1: BLOCKED */}
      {permissionState === 'denied' && !subscription && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl shadow-xl flex items-start gap-3 max-w-[250px] animate-in slide-in-from-right">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                  <p className="text-xs font-bold mb-1">Notifications Blocked</p>
                  <p className="text-[10px] leading-relaxed opacity-80">
                      Please go to Settings and Reset Permissions for this app.
                  </p>
              </div>
          </div>
      )}

      {/* CASE 2: NOT SUBSCRIBED */}
      {!subscription && permissionState !== 'denied' && (
          <button
            onClick={subscribeToPush}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-full shadow-xl shadow-blue-600/30 hover:bg-blue-700 transition-all font-bold text-xs animate-in slide-in-from-right"
          >
            {loading ? <Loader2 size={16} className="animate-spin"/> : <BellRing size={16} />}
            Enable Alerts
          </button>
      )}

      {/* CASE 3: SUBSCRIBED */}
      {subscription && (
          <div className="flex flex-col items-end gap-1 animate-in slide-in-from-right">
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold flex items-center gap-1 shadow-sm mb-1">
                  <Check size={10} strokeWidth={4} /> Push Active
              </span>
              <button 
                  onClick={triggerBackgroundTest}
                  disabled={loading}
                  className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full shadow-lg hover:bg-slate-800 transition-all font-bold text-xs"
              >
                  {loading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                  Test Background Push
              </button>
          </div>
      )}
    </div>
  )
}