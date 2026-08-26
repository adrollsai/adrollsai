import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch } 
  }
)

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

    console.log('[Reminders Dispatcher] Running reminders check...')

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[Reminders Dispatcher] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const nowUtcString = new Date().toISOString()
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const now = new Date()
    const targetTime = new Date(now.getTime() + 35 * 60 * 1000) // 35 minutes from now

    // 1. Fetch leads due for CRM follow-up alert (within recent 2-hour window)
    const { data: leadsToRemind, error: followupErr } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, assigned_to, name, phone, next_followup')
      .not('next_followup', 'is', null)
      .gte('next_followup', twoHoursAgo)
      .lte('next_followup', nowUtcString)

    if (followupErr) throw followupErr

    // 2. Fetch leads due for 30-minute booking email
    const { data: bookingsToRemind, error: bookingErr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .not('booked_time', 'is', null)
      .eq('booking_reminder_sent', false)
      .gte('booked_time', now.toISOString())
      .lte('booked_time', targetTime.toISOString())

    if (bookingErr) throw bookingErr

    if ((!leadsToRemind || leadsToRemind.length === 0) && (!bookingsToRemind || bookingsToRemind.length === 0)) {
      return NextResponse.json({ success: true, message: 'No reminders due at this time.' })
    }

    // Process due followup push notifications directly
    const processedIds: string[] = []
    if (leadsToRemind && leadsToRemind.length > 0) {
      // Gather all user IDs to resolve profiles (agent names and parent/agency admin IDs)
      const userIdsToFetch = new Set<string>()
      leadsToRemind.forEach(l => {
        if (l.assigned_to) userIdsToFetch.add(l.assigned_to)
        if (l.user_id) userIdsToFetch.add(l.user_id)
      })

      const profileMap = new Map<string, any>()
      if (userIdsToFetch.size > 0) {
        const { data: profs } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, business_name, email, parent_id, agency_id')
          .in('id', Array.from(userIdsToFetch))
        
        profs?.forEach(p => profileMap.set(p.id, p))
      }

      for (const lead of leadsToRemind) {
        if (lead.next_followup) {
          const directTargetId = lead.assigned_to || lead.user_id
          const directProfile = directTargetId ? profileMap.get(directTargetId) : null
          const agentName = directProfile?.full_name || directProfile?.business_name || (directProfile?.email ? directProfile.email.split('@')[0] : 'Agent')
          
          // 1. Notify direct assignee/owner
          if (directTargetId) {
            await sendPushNotification(
              directTargetId,
              "Follow-Up Reminder ⏰",
              `Time to follow up with ${lead.name || 'Lead'} ${lead.phone ? `(${lead.phone})` : ''}`,
              `/dashboard/crm/${lead.id}`,
              "reminder"
            ).catch((err: any) => console.error('[Reminders Dispatcher Push Error (Agent)]:', err))
          }

          // 2. Notify workspace admin / parent if direct assignee is an agent
          const adminId = directProfile?.parent_id || directProfile?.agency_id || (lead.user_id !== directTargetId ? lead.user_id : null)
          if (adminId && adminId !== directTargetId) {
            await sendPushNotification(
              adminId,
              `Agent Follow-Up Reminder ⏰ (${agentName})`,
              `Follow-up scheduled for ${agentName} with ${lead.name || 'Lead'} ${lead.phone ? `(${lead.phone})` : ''}`,
              `/dashboard/crm/${lead.id}`,
              "reminder"
            ).catch((err: any) => console.error('[Reminders Dispatcher Push Error (Admin)]:', err))
          }

          processedIds.push(lead.id)
        }
      }

      if (processedIds.length > 0) {
        await supabaseAdmin.from('leads').update({ next_followup: null }).in('id', processedIds)
      }
    }

    return NextResponse.json({ success: true, processedCount: processedIds.length })
  } catch (error: any) {
    console.error('[Reminders Dispatcher] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}