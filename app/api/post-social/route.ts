import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Get Current User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Extract Data from Request
  const body = await request.json()
  const { imageUrl, caption } = body

  // 3. Get Facebook Token from Supabase Identities
  // Supabase stores the provider token inside the user object's 'identities' array
  const facebookIdentity = user.identities?.find(id => id.provider === 'facebook')
  
  // Note: The 'provider_token' is usually only available immediately after login in the session.
  // If this fails, we might need to re-authenticate or use a specific Supabase setting to expose tokens.
  // For this tutorial, we assume the session is fresh enough to have it.
  const accessToken = user.user_metadata?.provider_token || facebookIdentity?.identity_data?.provider_access_token // Try multiple paths

  // Check Supabase session for the token (Safest bet)
  const { data: sessionData } = await supabase.auth.getSession()
  const providerToken = sessionData.session?.provider_token

  if (!providerToken) {
    return NextResponse.json({ error: 'Facebook token not found. Please reconnect Facebook in Profile.' }, { status: 400 })
  }

  // 4. Send to n8n
  try {
    const n8nResponse = await fetch(process.env.N8N_SOCIAL_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: providerToken,
        imageUrl,
        caption
      }),
    })

    if (!n8nResponse.ok) throw new Error('Failed to reach n8n')
    
    const result = await n8nResponse.json()
    return NextResponse.json(result)

  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Posting failed' }, { status: 500 })
  }
}