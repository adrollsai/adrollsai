'use client'

import { Capacitor } from '@capacitor/core'

export interface CallLogEntry {
  phoneNumber: string
  callType: 'OUTGOING' | 'INCOMING' | 'MISSED' | 'REJECTED'
  duration: number // in seconds
  status: 'CONNECTED' | 'NOT_CONNECTED' | 'MISSED' | 'DNP' | 'BUSY'
  startedAt: string
  recordingUrl?: string
  notes?: string
}

export interface CallTrackingSettings {
  autoSync: boolean
  recordingFolderPath: string
  syncFrequency: 'realtime' | '15m' | '30m' | 'manual'
  lastSyncedAt?: string
}

const DEFAULT_SETTINGS: CallTrackingSettings = {
  autoSync: true,
  recordingFolderPath: '/Recordings/Call',
  syncFrequency: '15m'
}

export function getCallTrackingSettings(): CallTrackingSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const saved = localStorage.getItem('nobogent_call_settings')
    if (saved) return JSON.parse(saved)
  } catch (e) {}
  return DEFAULT_SETTINGS
}

export function saveCallTrackingSettings(settings: CallTrackingSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('nobogent_call_settings', JSON.stringify(settings))
  } catch (e) {}
}

/**
 * Check if call tracking is available on the current device.
 * True ONLY on native Android devices.
 */
export function isAndroidCallTrackingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/**
 * Sync call logs captured on Android device to the Nobogent CRM backend.
 */
export async function syncAndroidCallLogs(manualLogs?: CallLogEntry[]): Promise<{
  success: boolean
  syncedCount: number
  matchedLeadsCount: number
  totalLogsInDb?: number
  error?: string
}> {
  try {
    let logsToSync: CallLogEntry[] = manualLogs || []

    // On Native Android, attempt reading call logs if available
    if (isAndroidCallTrackingAvailable() && !manualLogs) {
      try {
        const CallLogPlugin = (window as any).Capacitor?.Plugins?.CallLog || (window as any).CallLog
        if (CallLogPlugin) {
          if (typeof CallLogPlugin.hasPermission === 'function') {
            const perm = await CallLogPlugin.hasPermission().catch(() => ({}))
            if (!perm?.hasPermission && typeof CallLogPlugin.requestPermission === 'function') {
              await CallLogPlugin.requestPermission().catch(() => {})
            }
          }
          const result = await CallLogPlugin.getCallLog({ limit: 50 }).catch(() => null)
          if (result && Array.isArray(result.callLog)) {
            logsToSync = result.callLog.map((log: any) => {
              const dur = parseInt(log.duration || '0', 10)
              const typeMap: Record<number | string, 'OUTGOING' | 'INCOMING' | 'MISSED' | 'REJECTED'> = {
                1: 'INCOMING',
                2: 'OUTGOING',
                3: 'MISSED',
                5: 'REJECTED',
                'INCOMING': 'INCOMING',
                'OUTGOING': 'OUTGOING',
                'MISSED': 'MISSED',
                'REJECTED': 'REJECTED'
              }
              const callType = typeMap[log.type] || 'OUTGOING'
              const isConnected = dur > 0
              return {
                phoneNumber: log.number || log.phoneNumber || '',
                callType,
                duration: dur,
                status: isConnected ? 'CONNECTED' : (callType === 'MISSED' ? 'MISSED' : 'NOT_CONNECTED'),
                startedAt: new Date(parseInt(log.date || Date.now().toString(), 10)).toISOString()
              }
            })
          }
        }
      } catch (nativeErr) {
        console.warn('[CallTracking] Android native CallLog plugin notice:', nativeErr)
      }
    }

    if (!logsToSync.length) {
      const current = getCallTrackingSettings()
      saveCallTrackingSettings({ ...current, lastSyncedAt: new Date().toISOString() })
      return { success: true, syncedCount: 0, matchedLeadsCount: 0 }
    }

    const res = await fetch('/api/crm/call-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callLogs: logsToSync })
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || 'Failed to sync call logs')
    }

    const data = await res.json()
    const current = getCallTrackingSettings()
    saveCallTrackingSettings({ ...current, lastSyncedAt: new Date().toISOString() })

    return {
      success: true,
      syncedCount: data.syncedCount || 0,
      matchedLeadsCount: data.matchedLeadsCount || 0,
      totalLogsInDb: data.totalLogsInDb || 0
    }
  } catch (err: any) {
    console.error('[CallTracking] Sync error:', err)
    return {
      success: false,
      syncedCount: 0,
      matchedLeadsCount: 0,
      error: err.message
    }
  }
}
