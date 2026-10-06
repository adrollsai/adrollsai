import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const campaignSlug = searchParams.get('campaign') || 'nobogent'
  const origin = new URL(request.url).origin

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return new Response('GOOGLE_CLIENT_ID environment variable is not configured.', { status: 500 })
  }

  // Use the standard authorized redirect URI
  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1')
  const redirectUri = isLocal
    ? `${origin}/api/auth/google/callback`
    : (process.env.GOOGLE_REDIRECT_URI || 'https://app.nobogent.com/api/auth/google/callback')

  const scopes = [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ')

  const state = JSON.stringify({
    flow: 'gbp_audit',
    campaignSlug,
    redirectUriOrigin: origin
  })

  const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state
  }).toString()

  return NextResponse.redirect(googleUrl)
}
