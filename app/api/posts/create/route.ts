import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin' // Import Admin Client
import { broadcastNotificationToOrg } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient() // Initialize Admin Client
  
  try {
    // 1. Auth Check (Verify it's a real user)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get User Profile & Org details
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role, business_name')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Only Admins/Super Users can post
    if (profile.role !== 'admin' && profile.role !== 'super_user') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { title, content, mediaUrl, mediaType } = body

    if (!title || !content) {
        return NextResponse.json({ error: 'Title and Content are required' }, { status: 400 })
    }

    // 3. Insert Post (Using Standard Client - safe because user inserts their own post)
    // Note: Ensure your 'posts' table has 'media_url' and 'media_type' columns
    const { data: post, error: insertError } = await supabase.from('posts').insert({
        user_id: user.id,
        title,
        content,
        media_url: mediaUrl || null,
        media_type: mediaType || null,
        status: 'published',
        tags: []
    }).select().single()

    if (insertError) throw insertError

    // 4. Broadcast Notification (USING ADMIN CLIENT TO BYPASS RLS)
    if (profile.organization_id) {
        const notificationTitle = mediaUrl ? "New Update with Media 📸" : "New Announcement 📢"
        await broadcastNotificationToOrg(
            supabaseAdmin, 
            profile.organization_id,
            notificationTitle,
            `${profile.business_name}: ${title}`,
            '/dashboard?tab=feed',
            user.id // Exclude the admin from receiving their own push notification
        )
    }

    return NextResponse.json({ success: true, post })

  } catch (error: any) {
    console.error('Create Post Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}