'use client'

import { Capacitor } from '@capacitor/core'

export interface CallLogEntry {
  phoneNumber: string
  callType: 'OUTGOING' | 'INCOMING' | 'MISSED' | 'REJECTED'
  duration: number // in seconds
  status: 'CONNECTED' | 'NOT_CONNECTED' | 'MISSED' | 'DNP' | 'BUSY'
  startedAt: string
  recordingUrl?: string
  recordingBase64?: string
  hasRecording?: boolean
  recordingFilePath?: string
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

function getCallLogPlugin(): any {
  return (window as any).Capacitor?.Plugins?.CallLog || (window as any).CallLog || null
}

/**
 * Get the Supabase access token from cookies for native HTTP uploads.
 */
function getAccessToken(): string {
  if (typeof document === 'undefined') return ''
  try {
    // Try localStorage first (Supabase client stores here)
    const storageKeys = Object.keys(localStorage)
    for (const key of storageKeys) {
      if (key.includes('supabase') && key.includes('auth')) {
        try {
          const val = JSON.parse(localStorage.getItem(key) || '{}')
          if (val?.access_token) return val.access_token
        } catch {}
      }
    }
  } catch {}
  return ''
}

/**
 * Sync call logs captured on Android device to the Nobogent CRM backend.
 * Two-step process:
 * 1. Read call logs from Android & sync metadata to server
 * 2. For calls that have recording files, upload them natively via HTTP
 */
export async function syncAndroidCallLogs(manualLogs?: CallLogEntry[]): Promise<{
  success: boolean
  syncedCount: number
  matchedLeadsCount: number
  totalLogsInDb?: number
  recordingsUploaded?: number
  error?: string
}> {
  try {
    let logsToSync: CallLogEntry[] = manualLogs || []
    let callsWithRecordings: Array<{ phoneNumber: string; callDate: number }> = []

    // On Native Android, attempt reading call logs if available
    if (isAndroidCallTrackingAvailable() && !manualLogs) {
      try {
        const CallLogPlugin = getCallLogPlugin()
        if (CallLogPlugin) {
          if (typeof CallLogPlugin.hasPermission === 'function') {
            const perm = await CallLogPlugin.hasPermission().catch(() => ({}))
            if (!perm?.hasPermission && typeof CallLogPlugin.requestPermission === 'function') {
              await CallLogPlugin.requestPermission().catch(() => {})
            }
          const settings = getCallTrackingSettings()
          const folderPath = settings.recordingFolderPath || '/MIUI/sound_recorder/call_rec'
          const result = await CallLogPlugin.getCallLog({ limit: 50, recordingFolderPath: folderPath }).catch(() => null)
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

              // Track calls that have recordings for step 2
              if (log.hasRecording && log.number) {
                callsWithRecordings.push({
                  phoneNumber: log.number,
                  callDate: parseInt(log.date || '0', 10)
                })
              }

              return {
                phoneNumber: log.number || log.phoneNumber || '',
                callType,
                duration: dur,
                status: isConnected ? 'CONNECTED' : (callType === 'MISSED' ? 'MISSED' : 'NOT_CONNECTED'),
                startedAt: new Date(parseInt(log.date || Date.now().toString(), 10)).toISOString(),
                hasRecording: !!log.hasRecording
              }
            })

            console.log(`[CallTracking] Found ${logsToSync.length} call logs, ${callsWithRecordings.length} with recordings`)
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

    // Step 1: Sync call log metadata to server
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

    // Step 2: Upload recordings natively for calls that have them
    let recordingsUploaded = 0
    if (callsWithRecordings.length > 0 && isAndroidCallTrackingAvailable()) {
      const CallLogPlugin = getCallLogPlugin()
      if (CallLogPlugin && typeof CallLogPlugin.uploadCallRecording === 'function') {
        const origin = window.location.origin
        const uploadUrl = `${origin}/api/crm/call-recordings`

        const settings = getCallTrackingSettings()
        const folderPath = settings.recordingFolderPath || '/MIUI/sound_recorder/call_rec'
        for (const call of callsWithRecordings) {
          try {
            const uploadResult = await CallLogPlugin.uploadCallRecording({
              phoneNumber: call.phoneNumber,
              callDate: call.callDate,
              uploadUrl: uploadUrl,
              authToken: getAccessToken(),
              recordingFolderPath: folderPath
            })
            if (uploadResult?.found && uploadResult?.recordingUrl) {
              recordingsUploaded++
              console.log(`[CallTracking] Uploaded recording for ${call.phoneNumber}`)
            }
          } catch (uploadErr) {
            console.warn(`[CallTracking] Recording upload failed for ${call.phoneNumber}:`, uploadErr)
          }
        }
      }
    }

    return {
      success: true,
      syncedCount: data.syncedCount || 0,
      matchedLeadsCount: data.matchedLeadsCount || 0,
      totalLogsInDb: data.totalLogsInDb || 0,
      recordingsUploaded
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
