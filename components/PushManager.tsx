'use client'

import { useEffect, useState } from 'react'
import { BellRing, Check, Loader2, Send, AlertCircle, Share, Bell, X } from 'lucide-react'
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

interface PushManagerProps {
  variant?: 'banner' | 'inline';
  ownerId?: string;
}

export default function PushManager({ variant = 'inline', ownerId }: PushManagerProps) {
  const [isSupported, setIsSupported] = useState(false)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [loading, setLoading] = useState(false)
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default')
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      // Explicitly register your custom worker
      registerServiceWorker()
      
      if ('Notification' in window) {
          setPermissionState(Notification.permission)
      }
    }

    const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIosDevice)
    
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                             (window.navigator as any).standalone === true
    setIsStandalone(isStandaloneMode)

    if (variant === 'banner') {
      const dismissed = localStorage.getItem('pushBannerDismissed') === 'true'
      setIsDismissed(dismissed)
    }
  }, [variant])

  // This function manually registers custom-sw.js
  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      
      await navigator.serviceWorker.ready
      
      const sub = await registration.pushManager.getSubscription()
      if (sub) setSubscription(sub)
    } catch (error) {
      console.error('Service Worker registration failed:', error)
    }
  }

  async function subscribeToPush() {
    setLoading(true)
    try {
      // THE iOS SAFARI FIX:
      // Request permission explicitly FIRST before doing any async service worker tasks.
      // This ensures the native OS prompt appears instantly linked to the tap event.
      if (window.Notification && Notification.permission !== 'granted') {
          const permission = await window.Notification.requestPermission()
          setPermissionState(permission)
          
          if (permission !== 'granted') {
              toast.error("Permission Denied")
              setLoading(false)
              return
          }
      }

      // 2. Force a fresh registration to ensure we have a clean, active worker
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      
      // Ensure the service worker is active before trying to subscribe
      if (!registration.active) {
        await new Promise<void>((resolve) => {
          const worker = registration.installing || registration.waiting;
          if (worker) {
            const stateChangeHandler = () => {
              if (worker.state === 'activated') {
                worker.removeEventListener('statechange', stateChangeHandler);
                resolve();
              }
            };
            worker.addEventListener('statechange', stateChangeHandler);
          } else {
            resolve();
          }
        });
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        toast.error("Configuration Error: Missing VAPID Key")
        setLoading(false)
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
        body: JSON.stringify({ subscription: sub, ownerId }),
      })

      if (res.ok) {
          toast.success("Notifications Enabled!", {
            description: "You are now subscribed to real-time updates."
          })
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
        description: "Close this app/tab NOW! Notification comes instantly." 
      })

      try {
          await fetch('/api/test-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
          })
      } catch (e) {
          toast.error("Test failed")
      } finally {
          setLoading(false)
      }
  }

  const handleDismiss = () => {
    localStorage.setItem('pushBannerDismissed', 'true')
    setIsDismissed(true)
  }

  if (!isSupported) return null

  // -------------------------------------------------------------
  // BANNER VARIANT (Bottom floating, dismissible, auto-hides if enabled)
  // -------------------------------------------------------------
  if (variant === 'banner') {
    if (isDismissed || subscription || permissionState === 'denied') return null

    return (
      <div className="fixed bottom-[85px] left-4 right-4 z-[60] bg-white p-4 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 animate-in slide-in-from-bottom-5 fade-in duration-300">
        <button onClick={handleDismiss} className="absolute top-2 right-2 text-slate-400 p-2 hover:text-slate-600 transition-colors rounded-full">
            <X size={16} />
        </button>
        
        <div className="flex items-center gap-3 pr-6 mb-1">
           <div className="bg-blue-100 text-blue-600 p-2.5 rounded-full shrink-0">
             <BellRing size={20} />
           </div>
           <div>
              <p className="text-sm font-bold text-slate-900">Stay Updated</p>
              <p className="text-xs text-slate-500 leading-tight">Get notified about new products & offers.</p>
           </div>
        </div>

        {isIOS && !isStandalone ? (
           <div className="mt-3 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 leading-relaxed">
              Tap <Share size={12} className="inline text-blue-500 mb-0.5"/> then <b>Add to Home Screen</b> to enable alerts.
           </div>
        ) : (
           <button 
              onClick={subscribeToPush} 
              disabled={loading} 
              className="w-full mt-3 bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"
           >
              {loading ? <Loader2 size={14} className="animate-spin"/> : "Enable Now"}
           </button>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------
  // INLINE VARIANT (Used on the Profile Page permanently)
  // -------------------------------------------------------------
  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Bell size={18}/> Push Notifications
      </h3>
      
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
        
        {/* IOS INSTRUCTION CARD */}
        {isIOS && !isStandalone && (
           <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg flex items-start gap-3 mb-4">
              <Share size={20} className="shrink-0 mt-0.5 text-blue-400" />
              <div>
                  <p className="text-sm font-bold mb-1">Install App Required</p>
                  <p className="text-xs opacity-80 leading-relaxed">
                      To receive notifications on iOS, you must install this app to your home screen.
                      <br/><br/>
                      Tap <span className="font-bold text-blue-300">Share Icon</span> → <span className="font-bold text-blue-300">Add to Home Screen</span>.
                  </p>
              </div>
           </div>
        )}

        {/* PERMISSION DENIED CARD */}
        {permissionState === 'denied' && !subscription && (
           <div className="bg-red-50 text-red-800 p-4 rounded-xl border border-red-100 flex items-start gap-3 mb-2">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                  <p className="text-xs font-bold mb-1">Notifications Blocked</p>
                  <p className="text-[10px] leading-relaxed opacity-80">
                      You have blocked notifications. Please reset permissions for this site in your browser settings (Lock Icon in URL bar).
                  </p>
              </div>
           </div>
        )}

        {/* MAIN ACTION AREA */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${subscription ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                    {subscription ? <Check size={20} strokeWidth={3} /> : <BellRing size={20} />}
                </div>
                <div>
                    <p className="text-sm font-bold text-slate-900">
                        {subscription ? 'Active' : 'Updates & Alerts'}
                    </p>
                    <p className="text-[10px] text-slate-500">
                        {subscription 
                            ? 'You are receiving real-time alerts.' 
                            : 'Get notified about leads and campaign updates.'}
                    </p>
                </div>
            </div>

            {!subscription && permissionState !== 'denied' && (
                <button
                    onClick={subscribeToPush}
                    disabled={loading}
                    className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors"
                >
                    {loading ? <Loader2 size={14} className="animate-spin"/> : <Bell size={14} />}
                    Enable
                </button>
            )}

            {subscription && (
                 <button 
                    onClick={triggerBackgroundTest}
                    disabled={loading}
                    className="bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-lg text-[10px] font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors"
                >
                    {loading ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>}
                    Test
                </button>
            )}
        </div>

      </div>
    </div>
  )
}