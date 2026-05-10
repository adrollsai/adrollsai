import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId, pageToken } = await request.json()

  if (!pageId || !pageToken) {
      return NextResponse.json({ error: 'Missing Page ID or Token' }, { status: 400 })
  }

  try {
    // Call Meta Graph API to subscribe the page to our app
    // This is required for Webhooks to work!
    const subscribeRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: ['leadgen'],
        access_token: pageToken
      })
    })

    const data = await subscribeRes.json()

    if (data.success) {
      console.log(`✅ Page ${pageId} successfully subscribed to app webhooks.`)
      return NextResponse.json({ success: true })
    } else {
      console.error("❌ Meta Subscription Error:", data)
      return NextResponse.json({ error: data.error?.message || 'Failed to subscribe page' }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Subscription API Crash:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
