import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookPixels } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { adAccountId } = await request.json()

  // 2. Get Token
  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token')
    .eq('id', user.id)
    .single()

  if (!profile?.facebook_token) {
    return NextResponse.json({ error: 'No Facebook token found' }, { status: 400 })
  }

  try {
    // 3. Fetch Pixels
    const pixels = await fetchFacebookPixels(profile.facebook_token, adAccountId)
    return NextResponse.json({ pixels })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}