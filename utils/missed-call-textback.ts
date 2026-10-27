import { SupabaseClient } from '@supabase/supabase-js'

interface MissedCallParams {
  supabaseAdmin: SupabaseClient
  leadId?: string | null
  profileId: string
  callerPhone: string
  callerName?: string | null
  reason?: string
}

// Missed Call Text Back feature has been removed
export async function triggerMissedCallTextBack(_params: MissedCallParams): Promise<{ success: boolean; channel?: string; error?: string }> {
  return { success: false, error: 'Feature removed' }
}
