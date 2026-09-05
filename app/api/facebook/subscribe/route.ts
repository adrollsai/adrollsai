import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { ensureMetaPageSubscribed } from '@/utils/meta-subscription'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId, pageToken } = await request.json()

  if (!pageId) {
    return NextResponse.json({ error: 'Missing Page ID' }, { status: 400 })
  }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, selected_page_id, selected_page_token, facebook_token')
      .eq('id', user.id)
      .single()

    const result = await ensureMetaPageSubscribed(supabase, {
      id: user.id,
      selected_page_id: pageId,
      selected_page_token: pageToken || profile?.selected_page_token,
      facebook_token: profile?.facebook_token,
      email: profile?.email || user.email
    })

    if (result.success) {
      console.log(`✅ Page ${pageId} successfully subscribed to app webhooks.`)
      return NextResponse.json({ success: true, refreshedToken: !!result.refreshedToken })
    } else {
      console.error("❌ Meta Subscription Error:", result.error)
      return NextResponse.json({ error: result.error || 'Failed to subscribe page' }, { status: 500 })
    }
  } catch (error: any) {
    console.error("Subscription API Crash:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
