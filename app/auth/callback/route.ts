import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Capture Provider Tag
  const provider = searchParams.get('provider') 
  const next = searchParams.get('next') ?? '/dashboard'
  
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')
  if (errorCode) {
    return NextResponse.redirect(`${origin}${next}?error=${encodeURIComponent(errorDescription || 'Unknown Error')}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data?.session) {
      const token = data.session.provider_token
      // 🟢 CAPTURE REFRESH TOKEN (Vital for Google)
      const refreshToken = data.session.provider_refresh_token
      const userId = data.session.user.id

      if (token) {
        const updates: any = {}
        
        if (provider === 'facebook' && token.startsWith('EAA')) {
            console.log("✅ Saving Facebook Token...")
            updates.facebook_token = token
        } 
        else if (provider === 'linkedin_oidc') {
            console.log("✅ Saving LinkedIn Token...")
            updates.linkedin_token = token
        }
        // 👇 NEW: Google Business Logic
        else if (provider === 'google_business') {
            console.log("✅ Saving Google Business Tokens...")
            updates.google_business_token = token
            if (refreshToken) {
                updates.google_business_refresh_token = refreshToken
            } else {
                console.warn("⚠️ No Refresh Token received from Google! n8n automation will fail after 1 hour.")
            }
        }

        if (Object.keys(updates).length > 0) {
            await supabase.from('profiles').update(updates).eq('id', userId)
        }
      }
      
      const forwardedHost = request.headers.get('x-forwarded-host') 
      const isLocalEnv = origin.includes('localhost')
      
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}?error=Authentication failed`)
}