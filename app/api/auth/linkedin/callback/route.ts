import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateStr = searchParams.get('state')
  
  let targetOrigin = ''
  try {
    if (stateStr) {
      const state = JSON.parse(decodeURIComponent(stateStr))
      targetOrigin = state.origin
    }
  } catch (e) {
    console.error("Failed to parse state:", e)
  }

  const baseRedirectUrl = targetOrigin || new URL(req.url).origin

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/profile?error=no_code', baseRedirectUrl))
  }

  try {
    const protocol = req.headers.get('x-forwarded-proto') || 'https'
    const host = req.headers.get('host') || 'app.adrolls.in'
    const currentOrigin = `${protocol}://${host}`
    const primaryDomain = (host.includes('adrolls.in') || host.includes('localhost') || host.includes('vercel.app'))
      ? currentOrigin
      : (process.env.NEXT_PUBLIC_APP_URL || currentOrigin)
    const redirectUri = `${primaryDomain}/api/auth/linkedin/callback`

    // 1. Exchange code for access token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
      }),
    })

    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Failed to exchange token')

    const accessToken = tokenData.access_token

    // 2. Fetch User Profile from LinkedIn (OpenID Connect)
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profileData = await profileResponse.json()
    
    // 3. Save to Supabase Profile
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      await supabase.from('profiles').update({
        linkedin_token: accessToken,
        linkedin_id: profileData.sub, // sub is the unique ID in OIDC
        linkedin_name: profileData.name
      }).eq('id', user.id)
    }

    return NextResponse.redirect(new URL('/dashboard/profile?success=linkedin_linked', baseRedirectUrl))

  } catch (error: any) {
    console.error('LinkedIn Auth Error:', error)
    return NextResponse.redirect(new URL(`/dashboard/profile?error=${encodeURIComponent(error.message)}`, baseRedirectUrl))
  }
}
