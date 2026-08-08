import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Helper to normalize phone numbers for fuzzy matching
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  // Remove non-digit characters except +
  const cleaned = phone.replace(/[^\d]/g, '')
  // Return last 10 digits for Indian/Standard phone matching
  return cleaned.length >= 10 ? cleaned.slice(-10) : cleaned
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { callLogs } = body // Array of call log objects or single call log

    const logsToProcess = Array.isArray(callLogs) ? callLogs : [body]

    if (!logsToProcess.length || !logsToProcess[0]?.phoneNumber) {
      return NextResponse.json({ error: 'No valid call log entries provided' }, { status: 400 })
    }

    // 1. Fetch user's leads to match by phone number
    const { data: userLeads } = await supabase
      .from('leads')
      .select('id, phone, name, business_name')
      .or(`user_id.eq.${user.id}`)

    const leadPhoneMap = new Map<string, any>()
    if (userLeads) {
      userLeads.forEach(lead => {
        const norm = normalizePhone(lead.phone)
        if (norm) leadPhoneMap.set(norm, lead)
      })
    }

    let syncedCount = 0
    let matchedLeadsCount = 0

    for (const log of logsToProcess) {
      const rawPhone = log.phoneNumber || log.phone
      const norm = normalizePhone(rawPhone)
      const matchedLead = norm ? leadPhoneMap.get(norm) : null

      const durationSec = parseInt(log.duration || 0, 10)
      const callType = (log.callType || 'OUTGOING').toUpperCase()
      
      // Determine connected status: duration > 0 or explicit status
      let status = log.status ? log.status.toUpperCase() : 'CONNECTED'
      if (durationSec === 0 && (status === 'CONNECTED' || !log.status)) {
        status = callType === 'MISSED' || callType === 'REJECTED' ? 'MISSED' : 'NOT_CONNECTED'
      }

      const startedAt = log.startedAt ? new Date(log.startedAt).toISOString() : new Date().toISOString()

      // Avoid duplicates: check existing log with same user, phone, and startedAt within 5s
      const { data: existing } = await supabase
        .from('call_logs')
        .select('id')
        .eq('user_id', user.id)
        .eq('phone_number', rawPhone)
        .gte('started_at', new Date(new Date(startedAt).getTime() - 5000).toISOString())
        .lte('started_at', new Date(new Date(startedAt).getTime() + 5000).toISOString())
        .maybeSingle()

      if (!existing) {
        // Insert into call_logs
        const { data: insertedCall, error: insertErr } = await supabase
          .from('call_logs')
          .insert({
            user_id: user.id,
            lead_id: matchedLead ? matchedLead.id : null,
            phone_number: rawPhone,
            call_type: callType,
            duration: durationSec,
            status: status,
            recording_url: log.recordingUrl || null,
            notes: log.notes || null,
            started_at: startedAt
          })
          .select()
          .single()

        if (!insertErr && insertedCall) {
          syncedCount++

          // If matched lead, update lead's last_call_at & add timeline history
          if (matchedLead) {
            matchedLeadsCount++
            
            await supabase
              .from('leads')
              .update({
                last_call_at: startedAt,
                last_call_status: status,
                last_called_by: user.id
              })
              .eq('id', matchedLead.id)

            const durationText = durationSec > 0 
              ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` 
              : 'No answer'

            await supabase
              .from('lead_history')
              .insert({
                lead_id: matchedLead.id,
                action_type: 'CALL',
                title: `Call (${callType.toLowerCase()}): ${status}`,
                description: `Duration: ${durationText}.${log.notes ? ` Notes: ${log.notes}` : ''}`,
                metadata: {
                  call_log_id: insertedCall.id,
                  duration: durationSec,
                  status: status,
                  call_type: callType,
                  recording_url: log.recordingUrl || null,
                  caller_user_id: user.id
                }
              })
          }
        }
      }
    }

    const { count: totalLogsInDb } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    return NextResponse.json({
      success: true,
      syncedCount,
      matchedLeadsCount,
      totalLogsInDb: totalLogsInDb || 0
    })

  } catch (error: any) {
    console.error('[Call Logs API] Sync Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const filterUserId = searchParams.get('userId')

    // Fetch team members if user is agency or team lead
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, agency_id, role, full_name, business_name')
      .eq('id', user.id)
      .single()

    let allowedUserIds = [user.id]

    if (profile?.agency_id || profile?.role === 'agency' || profile?.role === 'admin') {
      const agencyId = profile.agency_id || profile.id
      const { data: teamMembers } = await supabase
        .from('profiles')
        .select('id, full_name, business_name')
        .or(`agency_id.eq.${agencyId},id.eq.${agencyId}`)

      if (teamMembers) {
        allowedUserIds = teamMembers.map(m => m.id)
      }
    }

    let query = supabase
      .from('call_logs')
      .select(`
        *,
        leads (id, name, phone, business_name),
        profiles:user_id (id, full_name, business_name)
      `)
      .in('user_id', filterUserId ? [filterUserId] : allowedUserIds)

    if (startDate) {
      query = query.gte('started_at', new Date(startDate).toISOString())
    }
    if (endDate) {
      query = query.lte('started_at', new Date(endDate).toISOString())
    }

    const { data: callLogs, error } = await query.order('started_at', { ascending: false })

    if (error) {
      console.error('[Call Logs GET] DB Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const logs = callLogs || []

    // Calculate aggregated stats
    const totalCalls = logs.length
    const connectedCalls = logs.filter(l => l.status === 'CONNECTED' || (l.duration && l.duration > 0)).length
    const notConnectedCalls = totalCalls - connectedCalls
    const totalDuration = logs.reduce((sum, l) => sum + (l.duration || 0), 0)
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0

    // Calculate team member breakdown
    const teamMap = new Map<string, {
      userId: string,
      userName: string,
      totalCalls: number,
      connectedCalls: number,
      notConnectedCalls: number,
      totalDuration: number,
      avgDuration: number,
      connectedRate: number
    }>()

    logs.forEach(log => {
      const uid = log.user_id
      const name = log.profiles?.full_name || log.profiles?.business_name || 'Team Member'
      
      const existing = teamMap.get(uid) || {
        userId: uid,
        userName: name,
        totalCalls: 0,
        connectedCalls: 0,
        notConnectedCalls: 0,
        totalDuration: 0,
        avgDuration: 0,
        connectedRate: 0
      }

      existing.totalCalls += 1
      const isConnected = log.status === 'CONNECTED' || (log.duration && log.duration > 0)
      if (isConnected) {
        existing.connectedCalls += 1
      } else {
        existing.notConnectedCalls += 1
      }
      existing.totalDuration += (log.duration || 0)
      existing.avgDuration = Math.round(existing.totalDuration / existing.totalCalls)
      existing.connectedRate = Math.round((existing.connectedCalls / existing.totalCalls) * 100)

      teamMap.set(uid, existing)
    })

    const teamStats = Array.from(teamMap.values()).sort((a, b) => b.totalCalls - a.totalCalls)

    return NextResponse.json({
      success: true,
      stats: {
        totalCalls,
        connectedCalls,
        notConnectedCalls,
        totalDuration,
        avgDuration,
        connectedRate: totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0
      },
      teamStats,
      logs: logs.slice(0, 100) // Return top 100 recent logs
    })

  } catch (error: any) {
    console.error('[Call Logs GET API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
