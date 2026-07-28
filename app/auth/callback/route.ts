import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { type EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash') || searchParams.get('token')
  const type = searchParams.get('type') as EmailOtpType | null
  
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
  if (errorCode === 'identity_already_exists') {
    return NextResponse.redirect(`${baseUrl}${next}?error=This Facebook account is already linked to another user.`);
  }

  if (errorCode || errorDescription) {
    console.error(`[AUTH CALLBACK] OAuth Error: ${errorCode} - ${errorDescription}`)
    return NextResponse.redirect(`${baseUrl}${next}?error=${encodeURIComponent(errorDescription || 'Authentication failed')}`)
  }

  if (code || (tokenHash && type)) {
    const supabase = await createClient()
    
    let error: any = null
    let data: any = null

    // 2. Exchange code or verify OTP token_hash for session
    if (code) {
      const res = await supabase.auth.exchangeCodeForSession(code)
      error = res.error
      data = res.data
    } else if (tokenHash && type) {
      const res = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type
      })
      error = res.error
      data = res.data
    }
    
    if (!error && data?.session) {
      const token = data.session.provider_token
      const refreshToken = data.session.provider_refresh_token
      const userId = data.session.user.id

      const updates: any = {}
      
      // 3. Robust Token Capture Logic
      if ((provider === 'facebook' || (token && token.startsWith('EAA'))) && token) {
          console.log("✅ Saving Facebook Token...")
          updates.facebook_token = token
      } 
      else if (provider === 'linkedin_oidc' && token) {
          console.log("✅ Saving LinkedIn Token...")
          updates.linkedin_token = token
      }
      else if (provider === 'google_business' && token) {
          console.log("✅ Saving Google Business Tokens...")
          updates.google_business_token = token
          if (refreshToken) {
              updates.google_business_refresh_token = refreshToken
          }
      }
      else if (provider === 'youtube' && token) {
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
            .upsert({ id: userId, ...updates }, { onConflict: 'id' })
          
          if (updateError) console.error("[AUTH CALLBACK] Profile update error:", updateError)
      }

      // Success! Redirect back to the requested page
      const targetPath = next.includes('/auth/reset-password')
        ? (next.includes('?') ? `${next}&verified=true` : `${next}?verified=true`)
        : next
      return NextResponse.redirect(`${baseUrl}${targetPath}`)
    } else if (error) {
      console.error("[AUTH CALLBACK] Verification error:", error.message)
      return NextResponse.redirect(`${baseUrl}${next}?error=${encodeURIComponent(error.message)}`)
    }
  }

  // Fallback for missing code or session (e.g. hash fragment redirects like #access_token=...)
  if (next.includes('/auth/reset-password')) {
    return NextResponse.redirect(`${baseUrl}${next}`)
  }

  return NextResponse.redirect(`${baseUrl}${next}?error=No session could be established`)
}