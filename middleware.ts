import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// IMPORTANT: Set this environment variable (e.g., 'app.adrollsai.com')
// to ensure the rewrite target is correct.
const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'app.adrollsai.com' 

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

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

  const url = request.nextUrl
  // Prefer 'x-forwarded-host' as it reflects the original host in environments like Vercel
  const currentHost = request.headers.get('x-forwarded-host') || url.host
  const isLocalhost = currentHost.includes('localhost') || currentHost.includes('127.0.0.1')
  
  
  // --- CUSTOM DOMAIN LOGIC (REWRITE) ---
  // Only check for a custom domain if it's not localhost and not the default host.
  if (!isLocalhost && currentHost !== DEFAULT_APP_HOST) {
    
    // Check organizations table for a matching custom_domain
    const { data: orgData } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .limit(1)
      .single()

    if (orgData) {
      // 1. Construct the internal rewrite URL (main app host, same path)
      const rewriteUrl = new URL(url.pathname, `https://${DEFAULT_APP_HOST}`)
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      // 2. Perform the Rewrite
      response = NextResponse.rewrite(rewriteUrl, {
          request: {
              headers: request.headers,
          },
      })
      
      // 3. Pass the original host header through for the callback route to use
      // This is crucial for correct post-login redirection back to the custom domain.
      response.headers.set('x-forwarded-host', currentHost);
    }
  }
  
  // --- AUTHENTICATION LOGIC ---

  // This refreshes the session if it's expired
  const { data: { user } } = await supabase.auth.getUser()

  // REDIRECT LOGIC:
  // This logic uses `request.nextUrl.pathname` (which uses the rewritten path if a rewrite occurred)
  // for the check, and `new URL(path, request.url)` for the redirect (which respects the custom host).

  // 1. If user IS logged in and is on the Login Page (/), send them to Dashboard
  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // 2. If user is NOT logged in and tries to visit Dashboard, send them to Login
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth (auth routes)
     * - shared (publicly shareable content)
     */
    '/((?!_next/static|_next/image|favicon.ico|auth|shared).*)',
    '/((?!_next/static|_next/image|favicon.ico|auth|shared).*)',
  ],
}