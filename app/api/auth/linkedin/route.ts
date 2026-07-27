import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const origin = searchParams.get('origin') || req.headers.get('host') || 'app.nobogent.com'
  const protocol = req.headers.get('x-forwarded-proto') || 'https'
  
  const clientId = process.env.LINKEDIN_CLIENT_ID
  
  // Always use the primary domain for the redirect URI to avoid multi-domain registration issues in LinkedIn
  // We will redirect back to the origin domain in the callback
  const host = req.headers.get('host') || 'app.nobogent.com'
  const currentOrigin = `${protocol}://${host}`
  const primaryDomain = (host.includes('nobogent.com') || host.includes('adrolls.in') || host.includes('localhost') || host.includes('vercel.app'))
    ? currentOrigin
    : (process.env.NEXT_PUBLIC_APP_URL || currentOrigin)
  const redirectUri = encodeURIComponent(`${primaryDomain}/api/auth/linkedin/callback`)
  
  const type = searchParams.get('type') || 'personal'
  const scopeList = type === 'company'
    ? 'openid profile email w_member_social w_organization_social rw_organization_admin r_organization_social'
    : 'openid profile email w_member_social'
  const scope = encodeURIComponent(scopeList)
  
  const impersonate = searchParams.get('impersonate') || ''
  
  // Store the actual origin in the state so we can redirect back after callback
  const state = encodeURIComponent(JSON.stringify({ 
    origin: `${protocol}://${req.headers.get('host')}`,
    impersonate,
    type
  }))
  
  const linkedinAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`

  return NextResponse.redirect(linkedinAuthUrl)
}
