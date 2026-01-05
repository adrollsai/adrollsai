import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { broadcastNotificationToOrg } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  try {
    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get User Profile (to identify Org)
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role, business_name')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Check permissions (Admin/Super User only)
    if (profile.role !== 'admin' && profile.role !== 'super_user') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 3. Parse Body
    const body = await request.json()
    const { propertyId, url, type, caption } = body

    if (!propertyId || !url || !type) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 4. Insert Creative into DB
    const { data: creative, error: insertError } = await supabase
        .from('master_creatives')
        .insert({
            property_id: propertyId,
            url,
            type,
            caption_template: caption
        })
        .select()
        .single()

    if (insertError) throw insertError

    // 5. Fetch Property Details (for a better notification message)
    const { data: property } = await supabase
        .from('properties')
        .select('title')
        .eq('id', propertyId)
        .single()
    
    const propertyTitle = property?.title || 'a project'

    // 6. Trigger Notification Broadcast
    if (profile.organization_id) {
        await broadcastNotificationToOrg(
            supabase,
            profile.organization_id,
            "New Creative Available 🎨",
            `New marketing assets added for ${propertyTitle}. Claim them now!`,
            '/dashboard?tab=feed',
            user.id
        )
    }

    return NextResponse.json({ success: true, creative })

  } catch (error: any) {
    console.error('Create Creative Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}