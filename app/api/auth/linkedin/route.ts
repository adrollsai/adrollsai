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
  
  // Exact scopes granted to this app in LinkedIn Developer Portal:
  // r_basicprofile, w_member_social, w_organization_social, rw_organization_admin, r_organization_social
  const companyScopes = 'r_basicprofile w_member_social w_organization_social rw_organization_admin r_organization_social'
  const personalScopes = 'r_basicprofile w_member_social'
  
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
