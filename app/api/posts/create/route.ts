import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { broadcastNotificationToOrg } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  try {
    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get User Profile & Org
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role, business_name')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Optional: Ensure only Admin can post to feed
    if (profile.role !== 'admin' && profile.role !== 'super_user') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { title, content } = body

    if (!title || !content) {
        return NextResponse.json({ error: 'Title and Content are required' }, { status: 400 })
    }

    // 3. Insert Post into DB
    const { data: post, error: insertError } = await supabase.from('posts').insert({
        user_id: user.id,
        title,
        content,
        status: 'published',
        tags: []
    }).select().single()

    if (insertError) throw insertError

    // 4. Trigger Notification Broadcast
    if (profile.organization_id) {
        // We do not await this if we want a faster response, 
        // but awaiting ensures logs appear in server console.
        await broadcastNotificationToOrg(
            supabase,
            profile.organization_id,
            "New Announcement",
            `${profile.business_name}: ${title}`,
            '/dashboard?tab=feed', // Link to the feed tab
            user.id // Exclude the sender
        )
    }

    return NextResponse.json({ success: true, post })

  } catch (error: any) {
    console.error('Create Post Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}