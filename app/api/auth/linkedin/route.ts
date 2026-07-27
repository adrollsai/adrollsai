import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clientId = process.env.LINKEDIN_CLIENT_ID

  const rawHost = req.headers.get('host') || 'app.nobogent.com'
  const cleanHost = rawHost.split(':')[0]
  const protocol = req.headers.get('x-forwarded-proto') || (rawHost.includes('localhost') || rawHost.includes('local.') ? 'https' : 'https')
  
  // Use current browsing origin so redirectUri matches browser domain
  const primaryDomain = `${protocol}://${cleanHost}`
  const redirectUri = encodeURIComponent(`${primaryDomain}/api/auth/linkedin/callback`)
  
  const type = searchParams.get('type') || 'personal'
  const customScope = searchParams.get('scope')
  
  // Valid LinkedIn OAuth Scopes:
  // For Community Management API & Company Pages: w_member_social w_organization_social rw_organization_admin
  // For Personal Profile: openid profile email w_member_social (or w_member_social if legacy)
  const companyScopes = 'w_member_social w_organization_social rw_organization_admin'
  const personalScopes = 'openid profile email w_member_social'
  
  const scopeList = customScope || (type === 'company' ? companyScopes : personalScopes)
  const scope = encodeURIComponent(scopeList)
  
  const impersonate = searchParams.get('impersonate') || ''
  
  // Store actual origin in state for redirect after callback
  const state = encodeURIComponent(JSON.stringify({ 
    origin: `${protocol}://${req.headers.get('host')}`,
    impersonate,
    type
  }))
  
  const linkedinAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`

  return NextResponse.redirect(linkedinAuthUrl)
}
