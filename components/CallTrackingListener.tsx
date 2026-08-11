'use client'

import { useEffect } from 'react'
import { isAndroidCallTrackingAvailable, syncAndroidCallLogs } from '@/utils/callTracking'

export function CallTrackingListener() {
  useEffect(() => {
    // Only run on native Android devices
    if (!isAndroidCallTrackingAvailable()) {
      return
    }

    const triggerSync = () => {
      syncAndroidCallLogs().catch(() => {})
    }

    // Trigger initial sync on app mount
    triggerSync()

    // Listen for app focus / return from phone call
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSync()
      }
    }

    window.addEventListener('focus', triggerSync)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Set up periodic sync every 5 minutes when active
    const interval = setInterval(triggerSync, 5 * 60 * 1000)

    return () => {
      window.removeEventListener('focus', triggerSync)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearInterval(interval)
    }
  }, [])

  return null
}
