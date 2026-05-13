import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const origin = searchParams.get('origin') || req.headers.get('host') || 'app.adrolls.in'
  const protocol = req.headers.get('x-forwarded-proto') || 'https'
  
  const clientId = process.env.LINKEDIN_CLIENT_ID
  
  // Always use the primary domain for the redirect URI to avoid multi-domain registration issues in LinkedIn
  // We will redirect back to the origin domain in the callback
  const primaryDomain = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${req.headers.get('host')}`
  const redirectUri = encodeURIComponent(`${primaryDomain}/api/auth/linkedin/callback`)
  
  const scope = encodeURIComponent('openid profile email w_member_social')
  
  // Store the actual origin in the state so we can redirect back after callback
  const state = encodeURIComponent(JSON.stringify({ origin: `${protocol}://${req.headers.get('host')}` }))
  
  const linkedinAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`

  return NextResponse.redirect(linkedinAuthUrl)
}
