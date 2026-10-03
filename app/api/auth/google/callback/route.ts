import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateStr = searchParams.get('state')

  if (!code || !stateStr) {
    return new Response("Missing code or state parameters", { status: 400 })
  }

  try {
    const state = JSON.parse(stateStr)
    const { userId, redirectUriOrigin, flow, campaignSlug } = state

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${redirectUriOrigin}/api/auth/google/callback`

    if (!clientId || !clientSecret) {
      return new Response("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured.", { status: 500 })
    }

    // Exchange auth code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error("[Google OAuth Callback] Token exchange failed:", tokenData)
      return new Response(`Token exchange failed: ${tokenData.error_description || tokenData.error}`, { status: 500 })
    }

    const { access_token, refresh_token } = tokenData

    // --- GBP Audit OAuth Flow ---
    if (flow === 'gbp_audit') {
      let userEmail = ''
      let userName = ''
      let businessTitle = ''
      let businessAddress = ''

      // Fetch user profile info
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json()
          userEmail = userInfo.email || ''
          userName = userInfo.name || ''
        }
      } catch (err) {
        console.warn('[Google GBP Callback] Error fetching userinfo:', err)
      }

      // Try fetching GBP accounts & locations
      try {
        const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        if (accountsRes.ok) {
          const accData = await accountsRes.json()
          const primaryAccount = accData.accounts?.[0]
          if (primaryAccount) {
            const locRes = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${primaryAccount.name}/locations?readMask=name,title,storefrontAddress,primaryPhone,categories`, {
              headers: { Authorization: `Bearer ${access_token}` }
            })
            if (locRes.ok) {
              const locData = await locRes.json()
              const primaryLoc = locData.locations?.[0]
              if (primaryLoc) {
                businessTitle = primaryLoc.title || ''
                if (primaryLoc.storefrontAddress?.addressLines) {
                  businessAddress = primaryLoc.storefrontAddress.addressLines.join(', ')
                }
              }
            }
          }
        }
      } catch (locErr) {
        console.warn('[Google GBP Callback] Error reading GBP locations:', locErr)
      }

      const auditParams = new URLSearchParams({
        connected: 'true',
        email: userEmail,
        name: userName,
        business: businessTitle || userName,
        address: businessAddress,
        token: access_token || ''
      })

      const targetSlug = campaignSlug || 'nobogent'
      return NextResponse.redirect(`${redirectUriOrigin}/audit/${targetSlug}?${auditParams.toString()}`)
    }

    // --- Standard Google Calendar Flow ---
    // Save refresh_token to profiles table in Supabase
    // We use service role to bypass RLS since callback is a public route
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const updates: any = {
      google_booking_enabled: true
    }

    if (refresh_token) {
      updates.google_refresh_token = refresh_token
    }

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)

    if (dbError) throw dbError

    console.log(`[Google OAuth Callback] Successfully linked calendar for User ID: ${userId}`)

    // Redirect user back to dashboard profile Connection Settings page
    return NextResponse.redirect(`${redirectUriOrigin}/dashboard/profile`)

  } catch (err: any) {
    console.error("[Google OAuth Callback] Fatal Error:", err)
    return new Response(`Authentication Error: ${err.message}`, { status: 500 })
  }
}
