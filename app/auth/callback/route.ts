import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Capture parameters
  // linkIdentity redirects might pass 'provider' or it might be in the fragment
  const provider = searchParams.get('provider') 
  const next = searchParams.get('next') ?? '/dashboard/profile' // Default to profile for linking
  
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')

  // --- THE FIX: Capture Ngrok/Vercel Forwarding Headers ---
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'

  // Determine the true base URL for the redirect
  let baseUrl = origin
  if (forwardedHost) {
    baseUrl = `${forwardedProto}://${forwardedHost}`
  }

  // Handle OAuth Errors immediately
  if (errorCode || errorDescription) {
    console.error(`[AUTH CALLBACK] OAuth Error: ${errorCode} - ${errorDescription}`)
    return NextResponse.redirect(`${baseUrl}${next}?error=${encodeURIComponent(errorDescription || 'Authentication failed')}`)
  }

  if (code) {
    const supabase = await createClient()
    
    // 2. Exchange code for session
    // This method handles both new logins and linking to existing sessions
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data?.session) {
      const token = data.session.provider_token
      const refreshToken = data.session.provider_refresh_token
      const userId = data.session.user.id

      const updates: any = {}
      
      // 3. Robust Token Capture Logic
      // We check for the provider tag or common token prefixes
      
      // --- FACEBOOK ---
      if (provider === 'facebook' || (token && token.startsWith('EAA'))) {
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
      // --- YOUTUBE ---
      else if (provider === 'youtube') {
          console.log("✅ Saving YouTube Tokens...")
          updates.youtube_token = token
          if (refreshToken) {
              updates.youtube_refresh_token = refreshToken
          } else {
              console.warn("⚠️ No Refresh Token received for YouTube.")
          }
      }

      // 4. Update the profile with new linked identities
      if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId)
          
          if (updateError) console.error("[AUTH CALLBACK] Profile update error:", updateError)
      }
      
      // Success! Redirect back to the requested page
      return NextResponse.redirect(`${baseUrl}${next}`)
    } else if (error) {
      console.error("[AUTH CALLBACK] Exchange error:", error.message)
      return NextResponse.redirect(`${baseUrl}${next}?error=${encodeURIComponent(error.message)}`)
    }
  }

  // Fallback for missing code or session
  return NextResponse.redirect(`${baseUrl}${next}?error=No session could be established`)
}