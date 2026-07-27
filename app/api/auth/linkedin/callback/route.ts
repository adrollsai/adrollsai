import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateStr = searchParams.get('state')
  
  let targetOrigin = ''
  let impersonateId = ''
  let connectionType = 'personal'
  try {
    if (stateStr) {
      const state = JSON.parse(decodeURIComponent(stateStr))
      targetOrigin = state.origin
      impersonateId = state.impersonate || ''
      connectionType = state.type || 'personal'
    }
  } catch (e) {
    console.error("Failed to parse state:", e)
  }

  const baseRedirectUrl = targetOrigin || new URL(req.url).origin

  if (!code) {
    const redirectUrl = new URL('/dashboard/profile?error=no_code', baseRedirectUrl)
    if (impersonateId) redirectUrl.searchParams.set('impersonate', impersonateId)
    return NextResponse.redirect(redirectUrl)
  }

  try {
    const rawHost = req.headers.get('host') || 'app.nobogent.com'
    const cleanHost = rawHost.split(':')[0]
    const protocol = req.headers.get('x-forwarded-proto') || (rawHost.includes('localhost') || rawHost.includes('local.') ? 'https' : 'https')
    
    const primaryDomain = `${protocol}://${cleanHost}`
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

    // 2. Fetch User Profile from LinkedIn (supports both OIDC and v2/me r_basicprofile)
    let linkedinSub = ''
    let linkedinName = 'LinkedIn Account'

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profileData = await profileResponse.json()

    if (profileResponse.ok && profileData.sub) {
      linkedinSub = profileData.sub
      linkedinName = profileData.name || `${profileData.given_name || ''} ${profileData.family_name || ''}`.trim() || 'LinkedIn Account'
    } else {
      // Fallback to legacy v2/me endpoint for r_basicprofile
      const meResponse = await fetch('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const meData = await meResponse.json()
      if (meResponse.ok && meData.id) {
        linkedinSub = meData.id
        linkedinName = `${meData.localizedFirstName || ''} ${meData.localizedLastName || ''}`.trim() || 'LinkedIn Account'
      }
    }
    
    // 3. Save to Supabase Profile
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      let targetUserId = user.id
      if (impersonateId) {
        const { data: ownProfile } = await supabase.from('profiles').select('role, agency_id').eq('id', user.id).single()
        if (['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
          if (ownProfile?.role !== 'super_admin') {
            const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single()
            if (subAccount) targetUserId = impersonateId
          } else {
            targetUserId = impersonateId
          }
        }
      }

      const updates: any = {
        linkedin_token: accessToken,
        linkedin_id: linkedinSub,
        linkedin_name: linkedinName
      }
      if (connectionType === 'personal') {
        updates.linkedin_urn = null
      }

      await supabase.from('profiles').update(updates).eq('id', targetUserId)
    }

    const redirectUrl = new URL('/dashboard/profile?success=linkedin_linked', baseRedirectUrl)
    if (impersonateId) redirectUrl.searchParams.set('impersonate', impersonateId)
    return NextResponse.redirect(redirectUrl)

  } catch (error: any) {
    console.error('LinkedIn Auth Error:', error)
    return NextResponse.redirect(new URL(`/dashboard/profile?error=${encodeURIComponent(error.message)}`, baseRedirectUrl))
  }
}
