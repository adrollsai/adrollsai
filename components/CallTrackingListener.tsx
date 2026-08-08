'use client'

import { useEffect } from 'react'
import { isAndroidCallTrackingAvailable, syncAndroidCallLogs } from '@/utils/callTracking'

export function CallTrackingListener() {
  useEffect(() => {
    // Only run on native Android devices
    if (!isAndroidCallTrackingAvailable()) {
      return
    }

    // Trigger initial sync on app mount / focus
    syncAndroidCallLogs().catch(() => {})

    // Set up periodic sync every 5 minutes when active
    const interval = setInterval(() => {
      syncAndroidCallLogs().catch(() => {})
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  return null
}
