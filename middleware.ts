import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Set runtime to nodejs for Supabase compatibility (Fixes Vercel warnings/errors)
export const runtime = 'nodejs';

// IMPORTANT: This must match your Vercel project's default host (e.g., adrollsai-builder-app.vercel.app)
// This environment variable must be set in your Vercel project settings.
const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'app.adrollsai.com' 

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })
  
  const url = request.nextUrl
  // Prefer 'x-forwarded-host' which Vercel provides as the original host requested by the client.
  const currentHost = request.headers.get('x-forwarded-host') || url.host
  const isLocalhost = currentHost.includes('localhost') || currentHost.includes('127.0.0.1')

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // 1. --- CUSTOM DOMAIN LOGIC (REWRITE) ---
  // Only check for a custom domain if it's not localhost and not the default host.
  if (!isLocalhost && currentHost !== DEFAULT_APP_HOST) {
    
    // Check organizations table for a matching custom_domain
    const { data: orgData } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .limit(1)
      .single()

    // If RLS fails and data is null, the request continues without rewrite, 
    // potentially leading to a 404 or the main app content if Vercel handles it.
    if (orgData) {
      // Perform the Rewrite to the DEFAULT_APP_HOST (Vercel's internal host)
      // This is the CRITICAL fix for the silent routing.
      const rewriteUrl = new URL(url.pathname, `https://${DEFAULT_APP_HOST}`)
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      response = NextResponse.rewrite(rewriteUrl, {
          request: {
              headers: request.headers,
          },
      })
      
      // Pass the original host header through for the callback route to use
      response.headers.set('x-forwarded-host', currentHost);
    }
  }
  
  // 2. --- AUTHENTICATION LOGIC ---

  // This refreshes the session if it's expired
  const { data: { user } } = await supabase.auth.getUser()
  
  // Determine the effective pathname after a rewrite, or use the original URL
  const finalUrl = response.headers.get('x-middleware-rewrite') ? new URL(response.headers.get('x-middleware-rewrite')!) : url

  // REDIRECT LOGIC:
  // 1. If user IS logged in and is on the Login Page (/), send them to Dashboard
  if (user && finalUrl.pathname === '/') {
    // Use request.url to construct the redirect, which maintains the custom domain host
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 2. If user is NOT logged in and tries to visit Dashboard, send them to Login
  if (!user && finalUrl.pathname.startsWith('/dashboard')) {
    // Use request.url to construct the redirect, which maintains the custom domain host
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  // Match all request paths except for files and auth routes
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|shared).*)',
  ],
}