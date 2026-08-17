'use client'

import { useEffect, useState, useRef } from 'react'
import { BellRing, Check, Loader2, Send, AlertCircle, Share, Bell, X, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications'

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
  const [isNative, setIsNative] = useState(false)
  const [subscription, setSubscription] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [permissionState, setPermissionState] = useState<'default' | 'granted' | 'denied'>('default')
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const isRegisteredRef = useRef(false)

  useEffect(() => {
    const isCapacitor = typeof window !== 'undefined' && Capacitor.isNativePlatform()
    setIsNative(isCapacitor)

    if (isCapacitor) {
      setIsSupported(true)
      initNativePush()
    } else if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      registerServiceWorker()
      if ('Notification' in window) {
        setPermissionState(Notification.permission)
      }
    }

    const isIosDevice = typeof window !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIosDevice)
    
    const isStandaloneMode = typeof window !== 'undefined' && (
      window.matchMedia('(display-mode: standalone)').matches || 
      (window.navigator as any).standalone === true
    )
    setIsStandalone(isStandaloneMode)

    if (variant === 'banner' && typeof window !== 'undefined') {
      const dismissed = localStorage.getItem('pushBannerDismissed') === 'true'
      setIsDismissed(dismissed)
    }
  }, [variant])

  // --- NATIVE CAPACITOR PUSH HANDLERS ---
  async function initNativePush() {
    try {
      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: 'nobogent_notifications',
          name: 'Nobogent Alerts',
          description: 'Real-time alerts for incoming leads, calls, and campaigns',
          importance: 5,
          visibility: 1,
          vibration: true,
          sound: 'default'
        }).catch(() => {})
      }

      const permStatus = await PushNotifications.checkPermissions()
      if (permStatus.receive === 'granted') {
        setPermissionState('granted')
        const savedToken = localStorage.getItem('nobogent_native_fcm_token')
        if (savedToken) {
          setSubscription({ fcmToken: savedToken })
        }
      } else if (permStatus.receive === 'denied') {
        setPermissionState('denied')
      }

      if (!isRegisteredRef.current) {
        isRegisteredRef.current = true

        PushNotifications.addListener('registration', async (token: Token) => {
          console.log('[Native Push] Registered with token:', token.value)
          localStorage.setItem('nobogent_native_fcm_token', token.value)
          setSubscription({ fcmToken: token.value })
          setPermissionState('granted')
          await syncNativeTokenWithBackend(token.value)
        })

        PushNotifications.addListener('registrationError', (error: any) => {
          console.warn('[Native Push] Registration error:', error)
        })

        PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
          console.log('[Native Push] Push received in foreground:', notification)
          toast.info(notification.title || 'Notification', {
            description: notification.body
          })
        })

        PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
          const targetUrl = action.notification.data?.url
          if (targetUrl && typeof window !== 'undefined') {
            window.location.href = targetUrl
          }
        })
      }
    } catch (err) {
      console.warn('[Native Push] Init notice:', err)
    }
  }

  async function syncNativeTokenWithBackend(fcmToken: string) {
    try {
      await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fcmToken,
          platform: Capacitor.getPlatform(),
          ownerId
        })
      })
    } catch (e) {
      console.warn('Failed to sync native push token:', e)
    }
  }

  // --- WEB / PWA PUSH HANDLERS ---
  async function syncSubscriptionWithBackend(sub: PushSubscription) {
    try {
      await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub, ownerId }),
      })
    } catch (e) {
      console.warn('Failed to auto-sync push subscription:', e)
    }
  }

  async function registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      
      await navigator.serviceWorker.ready
      
      const sub = await registration.pushManager.getSubscription()
      if (sub) {
        setSubscription(sub)
        syncSubscriptionWithBackend(sub)
      }
    } catch (error) {
      console.error('Service Worker registration failed:', error)
    }
  }

  async function subscribeToPush() {
    setLoading(true)
    try {
      if (isNative) {
        // Native Capacitor Permission & Registration
        let permStatus = await PushNotifications.checkPermissions()
        if (permStatus.receive !== 'granted') {
          permStatus = await PushNotifications.requestPermissions()
        }

        if (permStatus.receive === 'granted') {
          setPermissionState('granted')
          await PushNotifications.register()
          toast.success("Notifications Enabled!", {
            description: "You will now receive real-time alerts on your device."
          })
        } else {
          setPermissionState('denied')
          toast.error("Permission Denied", {
            description: "Please allow notifications in your device Settings."
          })
        }
        return
      }

      // Web / PWA Flow
      if (window.Notification && Notification.permission !== 'granted') {
        const permission = await window.Notification.requestPermission()
        setPermissionState(permission)
        
        if (permission !== 'granted') {
          toast.error("Permission Denied")
          setLoading(false)
          return
        }
      }

      let registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
      }
      
      await navigator.serviceWorker.ready

      let vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        toast.error("Configuration Error: Missing VAPID Key")
        setLoading(false)
        return
      }
      vapidKey = vapidKey.replace(/^['"]|['"]$/g, '').trim();

      let sub = await registration.pushManager.getSubscription()
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        })
      }

      setSubscription(sub)
      setPermissionState('granted')
      await syncSubscriptionWithBackend(sub)

      toast.success("Notifications Enabled!", {
        description: "You are now subscribed to real-time updates on this device."
      })

    } catch (error: any) {
      console.error('Failed to subscribe:', error)
      if (typeof window !== 'undefined' && window.Notification && Notification.permission === 'denied') {
        setPermissionState('denied')
        toast.error("Permission Denied", { description: "Please enable notifications in your device/browser settings." })
      } else {
        toast.error("Failed to enable notifications.", { description: error.message || "Push service error. Please try again." })
      }
    } finally {
      setLoading(false)
    }
  }


  async function triggerBackgroundTest() {
      setLoading(true)
      toast.info("Testing...", { 
        description: "Sending test alert to all your active devices!" 
      })

      try {
          if (subscription) {
            await syncSubscriptionWithBackend(subscription)
          }

          const res = await fetch('/api/test-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
          })

          if (res.ok) {
            toast.success("Test Sent!", { description: "Notification dispatched to this device." })
          } else {
            const data = await res.json().catch(() => ({}))
            toast.error("Test failed: " + (data.error || "Server error"))
          }
      } catch (e: any) {
          toast.error("Test failed", { description: e.message || "Network error" })
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
              <p className="text-xs text-slate-500 leading-tight">Get notified about new leads & offers.</p>
           </div>
        </div>
 
        {isIOS && !isStandalone ? (
           <div className="mt-3 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 leading-relaxed">
              Tap <Share size={12} className="inline text-blue-500 mb-0.5"/> then <b>Add to Home Screen</b> to enable alerts.
           </div>
        ) : (
           <button 
              onClick={() => {
                subscribeToPush();
              }} 
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