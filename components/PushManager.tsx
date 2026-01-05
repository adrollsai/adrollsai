'use client'

import { useEffect, useState } from 'react'
import { BellRing, Check, Loader2, Send, AlertCircle, Share, Bug } from 'lucide-react'
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
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [showDebug, setShowDebug] = useState(false)

  useEffect(() => {
    // 1. Browser Support & Device Checks
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      
      // CRITICAL: We manually register custom-sw.js to overwrite next-pwa's default
      registerCustomSW()
      
      if ('Notification' in window) {
          setPermissionState(Notification.permission)
      }
    }

    const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIosDevice)
    
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                             (window.navigator as any).standalone === true
    setIsStandalone(isStandaloneMode)

  }, [])

  async function registerCustomSW() {
    try {
      // We explicitly register /custom-sw.js
      // This call will 'win' the race against next-pwa's default registration
      const registration = await navigator.serviceWorker.register('/custom-sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      
      // If it's waiting (iOS sometimes holds it), force it to update
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      }

      // Check if we already have a subscription on THIS worker
      const sub = await registration.pushManager.getSubscription()
      if (sub) setSubscription(sub)

    } catch (error) {
      console.error('Custom SW registration failed:', error)
    }
  }

  async function subscribeToPush() {
    setLoading(true)
    try {
      // We get the registration specifically for custom-sw.js logic
      const registration = await navigator.serviceWorker.ready
      
      // Double check this is OUR worker (optional, but good for debugging)
      if (!registration.active?.scriptURL.includes('custom-sw.js')) {
          console.warn("Active worker is NOT custom-sw.js. Attempting to reregister...")
          await registerCustomSW()
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

      // Sync with backend
      const res = await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      })

      if (res.ok) {
          toast.success("Notifications Enabled!", {
            description: "You will now receive high-value alerts."
          })
      } else {
          throw new Error('Backend failed')
      }

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
        description: "Close this app/tab NOW! Notification comes in 5 seconds." 
      })

      try {
          await fetch('/api/test-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ delay: 5 }), 
              keepalive: true 
          })
      } catch (e) {
          toast.error("Test failed")
      } finally {
          setLoading(false)
      }
  }

  if (!isSupported) return null

  return (
    <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-2 pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
      
      {/* DEBUG TOGGLE - Click to see what's happening on the phone */}
      <button onClick={() => setShowDebug(!showDebug)} className="text-[10px] text-slate-400 bg-slate-100/50 p-1 rounded hover:bg-slate-200 backdrop-blur-md">
         {showDebug ? 'Hide Debug' : 'Debug Info'}
      </button>

      {showDebug && (
          <div className="bg-black/90 text-green-400 p-3 rounded-lg text-[10px] font-mono max-w-[300px] break-all mb-2 shadow-2xl overflow-y-auto max-h-[200px]">
              <p><strong>iOS:</strong> {isIOS ? 'Yes' : 'No'}</p>
              <p><strong>Standalone:</strong> {isStandalone ? 'Yes' : 'No'}</p>
              <p><strong>Permission:</strong> {permissionState}</p>
              <p><strong>Subscribed:</strong> {subscription ? 'YES' : 'NO'}</p>
          </div>
      )}

      {/* iOS Warning */}
      {isIOS && !isStandalone && (
         <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-start gap-3 max-w-[280px] animate-in slide-in-from-right mb-2">
            <Share size={20} className="shrink-0 mt-0.5 text-blue-400" />
            <div>
                <p className="text-xs font-bold mb-1">Install App for Notifications</p>
                <p className="text-[10px] opacity-80 leading-relaxed">
                    iOS requires this app to be installed to receive notifications. Tap <span className="font-bold">Share</span> then <span className="font-bold">"Add to Home Screen"</span>.
                </p>
            </div>
         </div>
      )}

      {permissionState === 'denied' && !subscription && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl shadow-xl flex items-start gap-3 max-w-[250px] animate-in slide-in-from-right">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                  <p className="text-xs font-bold mb-1">Notifications Blocked</p>
                  <p className="text-[10px] leading-relaxed opacity-80">
                      Please check your device settings to allow notifications for AdRolls AI.
                  </p>
              </div>
          </div>
      )}

      {!subscription && permissionState !== 'denied' && (
          <button
            onClick={subscribeToPush}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-full shadow-xl shadow-blue-600/30 hover:bg-blue-700 transition-all font-bold text-xs active:scale-95 animate-in slide-in-from-right"
          >
            {loading ? <Loader2 size={16} className="animate-spin"/> : <BellRing size={16} />}
            Enable Alerts
          </button>
      )}

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
    </div>
  )
}