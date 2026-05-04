import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export async function POST(request: Request) {
  try {
    const { postId, ownerId } = await request.json()

    if (!postId || !ownerId) {
      return NextResponse.json({ error: 'Missing postId or ownerId' }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Fetch the post details
    const { data: post, error: postError } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('id', postId)
      .single()

    if (postError || !post) throw new Error('Post not found')

    // 2. Fetch the business profile to get branding details
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('business_name, logo_url, custom_domain')
      .eq('id', ownerId)
      .single()

    // 3. Fetch all subscribers for this catalog
    // We notify both the user_id (if they subscribed while logged in) and catalog_owner_id (if they subscribed on the shared page)
    const { data: subscribers, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .or(`user_id.eq.${ownerId},catalog_owner_id.eq.${ownerId}`)

    if (subError) throw subError

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ success: true, sent: 0 })
    }

    // 4. Configure web-push
    webpush.setVapidDetails(
      'mailto:support@adrolls.ai',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )

    // Build the absolute URL
    const baseUrl = profile?.custom_domain 
        ? `https://${profile.custom_domain}` 
        : `https://app.adrolls.in/shared/${ownerId}`;
    
    const payload = JSON.stringify({
      title: `${profile?.business_name || 'Business Update'}`,
      body: post.title || 'New update posted to the feed!',
      icon: profile?.logo_url || post.image_url || 'https://app.adrolls.in/icon-192x192.png',
      badge: profile?.logo_url || 'https://app.adrolls.in/icon-192x192.png',
      url: baseUrl
    })

    // 5. Send notifications
    const notifications = subscribers.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      }

      return webpush.sendNotification(pushSubscription, payload).catch((err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or removed
          return supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
        }
        console.error('Error sending push notification:', err)
      })
    })

    await Promise.all(notifications)

    return NextResponse.json({ success: true, sent: subscribers.length })
  } catch (error: any) {
    console.error('Notification API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
