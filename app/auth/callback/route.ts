import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Helper function to determine the base URL for redirection (Custom Domain or Default)
async function getRedirectBaseUrl(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  
  const supabase = await createClient()

  // The host as seen by the request. Vercel sets 'x-forwarded-host' to the custom domain.
  const forwardedHost = request.headers.get('x-forwarded-host') 
  const currentHost = forwardedHost || url.host

  // 1. Handle local environment to avoid SSL/host issues
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    // Use http for localhost, and prioritize the forwarded host if it exists
    return forwardedHost ? `http://${currentHost}` : origin
  }

  // 2. Check if the current host is a registered custom domain in the database
  // This requires the RLS policy to allow anonymous/public SELECT on the organizations table.
  const { data: orgData } = await supabase
    .from('organizations')
    .select('custom_domain')
    .eq('custom_domain', currentHost)
    .single()
    
  // If a matching custom domain is found, use that host for the redirect
  if (orgData) {
    // Force HTTPS for production domains
    return `https://${currentHost}`
  }

  // 3. Fallback to the main Vercel app domain (using the forwardedHost, which should be the correct default host)
  if (forwardedHost) {
      return `https://${forwardedHost}`
  }

  // 4. Final fallback to the request origin
  return origin
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Capture Params
  const inviteOrg = searchParams.get('invite_org')
  const provider = searchParams.get('provider') 
  const next = searchParams.get('next') ?? '/dashboard'
  
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')
  
  // Determine the base URL for redirection for error states
  const errorRedirectBaseUrl = await getRedirectBaseUrl(request)

  if (errorCode) {
    return NextResponse.redirect(`${errorRedirectBaseUrl}/?error=${encodeURIComponent(errorDescription || 'Unknown Error')}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data?.session) {
      const user = data.session.user
      const userId = user.id

      // 2. Prepare Token Updates (Preserve existing logic)
      const token = data.session.provider_token
      const refreshToken = data.session.provider_refresh_token
      const tokenUpdates: any = {}

      if (token) {
        // --- FACEBOOK ---
        if (provider === 'facebook' && token.startsWith('EAA')) {
            tokenUpdates.facebook_token = token
        } 
        // --- LINKEDIN ---
        else if (provider === 'linkedin_oidc') {
            tokenUpdates.linkedin_token = token
        }
        // --- GOOGLE BUSINESS ---
        else if (provider === 'google_business') {
            tokenUpdates.google_business_token = token
            if (refreshToken) tokenUpdates.google_business_refresh_token = refreshToken
        }
        // --- YOUTUBE ---
        else if (provider === 'youtube') {
            tokenUpdates.youtube_token = token
            if (refreshToken) tokenUpdates.youtube_refresh_token = refreshToken
        }
      }

      // 3. Handle Profile & Organization Logic
      // Check if profile exists to determine if this is a signup or login
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (inviteOrg) {
          // === CASE A: User Invited to an Organization ===
          
          // 1. Add to Members Table (Upsert ensures no error if already exists)
          const { error: memberError } = await supabase.from('organization_members').upsert({
              user_id: userId,
              organization_id: inviteOrg,
              role: 'agent'
          }, { onConflict: 'organization_id, user_id' })

          if (memberError) console.error("Error adding member:", memberError)

          // 2. Switch Context: Update Profile to point to this Org
          if (existingProfile) {
               await supabase.from('profiles').update({
                   ...tokenUpdates,
                   organization_id: inviteOrg, // Switch active view
                   role: 'agent' // Ensure they view as agent
               }).eq('id', userId)
          } else {
               // First time user logic
               await supabase.from('profiles').insert({
                   id: userId,
                   email: user.email,
                   role: 'agent',
                   organization_id: inviteOrg,
                   business_name: user.user_metadata.full_name || 'New Agent',
                   logo_url: user.user_metadata.avatar_url || user.user_metadata.picture,
                   ...tokenUpdates
               })
          }

      } else {
          // === CASE B: Organic Sign Up (No Invite) ===
          
          if (!existingProfile) {
              // 1. Create New Organization (User becomes Admin)
              const { data: newOrg } = await supabase
                .from('organizations')
                .insert({ name: `${user.user_metadata.full_name || 'My'}'s Organization` })
                .select()
                .single()
              
              if (newOrg) {
                  // 2. Create Admin Profile
                  await supabase.from('profiles').insert({
                      id: userId,
                      email: user.email,
                      role: 'admin',
                      organization_id: newOrg.id,
                      business_name: user.user_metadata.full_name || 'Builder Admin',
                      logo_url: user.user_metadata.avatar_url || user.user_metadata.picture,
                      ...tokenUpdates
                  })
                  // 3. Add to Members as Admin
                  await supabase.from('organization_members').insert({
                      user_id: userId,
                      organization_id: newOrg.id,
                      role: 'admin'
                  })
              }
          } else {
              // User exists, just update tokens if we have new ones
              if (Object.keys(tokenUpdates).length > 0) {
                  await supabase.from('profiles').update(tokenUpdates).eq('id', userId)
              }
          }
      }
      
      // 4. Final Redirect Logic
      const redirectBaseUrl = await getRedirectBaseUrl(request)
      return NextResponse.redirect(`${redirectBaseUrl}${next}`)
    }
  }

  // Final error redirect
  const redirectBaseUrl = await getRedirectBaseUrl(request)
  return NextResponse.redirect(`${redirectBaseUrl}/?error=Authentication failed`)
}