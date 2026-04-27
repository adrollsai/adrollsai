import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Capture Provider Tag (custom param we pass during login)
  const provider = searchParams.get('provider') 
  const next = searchParams.get('next') ?? '/dashboard'
  
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')

  // --- THE FIX: Capture Ngrok/Vercel Forwarding Headers ---
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'http'

  // Determine the true base URL (prioritize ngrok/forwarded host over localhost)
  let baseUrl = origin
  if (forwardedHost) {
    baseUrl = `${forwardedProto}://${forwardedHost}`
  }

  if (errorCode) {
    return NextResponse.redirect(`${baseUrl}${next}?error=${encodeURIComponent(errorDescription || 'Unknown Error')}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data?.session) {
      const token = data.session.provider_token
      // 🟢 CAPTURE REFRESH TOKEN (Vital for Google/YouTube)
      const refreshToken = data.session.provider_refresh_token
      const userId = data.session.user.id

      if (token) {
        const updates: any = {}
        
        // --- FACEBOOK ---
        if (provider === 'facebook' && token.startsWith('EAA')) {
            console.log("✅ Saving Facebook Token...")
            updates.facebook_token = token
        } 
        // --- LINKEDIN ---
        else if (provider === 'linkedin_oidc') {
            console.log("✅ Saving LinkedIn Token...")
            updates.linkedin_token = token
        }
        // --- GOOGLE BUSINESS ---
        else if (provider === 'google_business') {
            console.log("✅ Saving Google Business Tokens...")
            updates.google_business_token = token
            if (refreshToken) {
                updates.google_business_refresh_token = refreshToken
            }
        }
        // --- YOUTUBE (NEW) ---
        else if (provider === 'youtube') {
            console.log("✅ Saving YouTube Tokens...")
            updates.youtube_token = token
            if (refreshToken) {
                updates.youtube_refresh_token = refreshToken
            } else {
                console.warn("⚠️ No Refresh Token received for YouTube! Automation may expire.")
            }
        }

        if (Object.keys(updates).length > 0) {
            await supabase.from('profiles').update(updates).eq('id', userId)
        }
      }
      
      // Successfully authenticated! Redirect to the proper URL.
      return NextResponse.redirect(`${baseUrl}${next}`)
    }
  }

  return NextResponse.redirect(`${baseUrl}${next}?error=Authentication failed`)
}