// adrollsai/adrollsai/adrollsai-builder-app-reward-system/app/api/crm/update-stage/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendCAPIEvent } from '@/utils/external-apis'
import { broadcastNotificationToOrg } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // 1. Get User Role
    const { data: profile } = await supabase.from('profiles').select('role, organization_id, business_name').eq('id', user.id).single()
    if (!profile) throw new Error("Profile not found")

    // 2. Logic: If Agent moves to restricted stage -> Pending Approval
    const restrictedStages = ['Site Visit Done', 'Closed']
    const isRestricted = restrictedStages.includes(newStage)
    const isAgent = profile.role === 'agent'

    let status = 'Active' // Default status
    if (isRestricted && isAgent) {
        status = 'Pending Approval'
    }

    // 3. Update DB
    const { data: lead, error } = await supabase
        .from('leads')
        .update({ 
            pipeline_stage: newStage, 
            status: status, // Update status
            notes: notes || undefined 
        })
        .eq('id', leadId)
        .select()
        .single()

    if (error) throw error;

    // 4. If Pending Approval -> Notify Admin
    if (status === 'Pending Approval') {
        await broadcastNotificationToOrg(
            supabase,
            profile.organization_id!,
            "⏳ Approval Needed",
            `${profile.business_name} requests to move lead '${lead.name}' to ${newStage}.`,
            '/dashboard?tab=agents', // Link to Agents tab where approvals are
            user.id // Exclude sender
        )
        // Also notify admins specifically (broadcastToOrg might target agents, so let's target admins manually if needed, 
        // but assuming admins check the dashboard or we can add a specific helper for admins. 
        // For now, the prompt implies "Admin should get the push notification".
        
        // Let's ensure Admins get it.
        const { data: admins } = await supabase
            .from('profiles')
            .select('id')
            .eq('organization_id', profile.organization_id)
            .eq('role', 'admin')
            
        if (admins) {
             const { sendNotification } = require('@/utils/notification-helper') // Dynamic import to avoid cycles if any
             for (const admin of admins) {
                 await sendNotification(supabase, admin.id, "⏳ Approval Needed", `${profile.business_name} moved lead '${lead.name}' to ${newStage}. Please review.`, 'system', '/dashboard?tab=agents')
             }
        }

        return NextResponse.json({ success: true, status: 'pending' })
    }

    // 5. If Regular Update -> Trigger CAPI if needed
    if (profile.organization_id) {
         const { data: orgAdmin } = await supabase
            .from('profiles')
            .select('facebook_token, pixel_id')
            .eq('organization_id', profile.organization_id)
            .eq('role', 'admin')
            .single()
         
         if (orgAdmin?.facebook_token && orgAdmin?.pixel_id) {
            let eventName = '';
            if (newStage === 'Site Visit Done') eventName = 'Schedule';
            if (newStage === 'Qualified') eventName = 'Lead';
            if (newStage === 'Closed') eventName = 'Purchase';

            if (eventName) {
                await sendCAPIEvent(
                    orgAdmin.facebook_token, 
                    orgAdmin.pixel_id, 
                    eventName, 
                    { email: lead.email, phone: lead.phone },
                    newStage === 'Closed' ? 10000 : 0 
                );
            }
         }
    }

    return NextResponse.json({ success: true, status: 'updated' })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}