import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 1. Force Node.js runtime to support Supabase libraries in middleware
export const runtime = 'nodejs'

// 2. Configuration: Set this to your internal Vercel domain (e.g., adrollsai-builder.vercel.app)
// Do NOT use your public custom domain here.
const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app' 

export async function middleware(request: NextRequest) {
  // Initialize response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = request.nextUrl
  
  // Get the hostname (check x-forwarded-host first for custom domains)
  const currentHost = request.headers.get('x-forwarded-host') || url.host
  const isLocalhost = currentHost.includes('localhost') || currentHost.includes('127.0.0.1')

  // 3. Create Supabase Client
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

  // 4. CUSTOM DOMAIN LOGIC (REWRITE)
  // Only execute if it's not localhost and not the internal default host
  if (!isLocalhost && currentHost !== DEFAULT_APP_HOST) {
    
    // Check if this domain exists in the 'organizations' table
    const { data: orgData } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .limit(1)
      .single()

    // If valid custom domain found, rewrite traffic to the internal host
    if (orgData) {
      const rewriteUrl = new URL(url.pathname, `https://${DEFAULT_APP_HOST}`)
      
      // Preserve search parameters
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      // Perform the rewrite
      response = NextResponse.rewrite(rewriteUrl, {
          request: {
              headers: request.headers,
          },
      })
      
      // Tag the response with the original host for downstream use
      response.headers.set('x-forwarded-host', currentHost)
    }
  }
  
  // 5. AUTHENTICATION LOGIC
  const { data: { user } } = await supabase.auth.getUser()

  // Determine the effective path (handling potentially rewritten URLs)
  const finalUrl = response.headers.get('x-middleware-rewrite') 
    ? new URL(response.headers.get('x-middleware-rewrite')!) 
    : url

  // A. Logged In User on Login Page -> Redirect to Dashboard
  if (user && finalUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // B. Guest User on Protected Route -> Redirect to Login
  if (!user && finalUrl.pathname.startsWith('/dashboard')) {
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
  ],
}