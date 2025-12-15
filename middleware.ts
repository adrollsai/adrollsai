import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 1. Configuration & Runtime Fix
// Force Node.js runtime to support Supabase libraries in middleware
export const runtime = 'nodejs'

// IMPORTANT: This MUST be set to your internal Vercel domain (e.g., adrollsai-builder.vercel.app)
// This is the host the middleware *rewrites* to internally.
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

  // LOG 1: Check the incoming host and expected target
  console.log(`[MIDDLEWARE] Incoming Host: ${currentHost}, Default Host: ${DEFAULT_APP_HOST}`);

  // 2. Create Supabase Client
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

  // 3. CUSTOM DOMAIN LOGIC (REWRITE)
  
  // Check if the current host is the custom domain or the default host/primary public domain
  const isKnownHost = currentHost === DEFAULT_APP_HOST || 
                      currentHost === 'adrolls.in' || 
                      currentHost === 'www.adrolls.in';

  // Only execute if it's not localhost and not one of the explicitly known default hosts
  if (!isLocalhost && !isKnownHost) {
    
    // Check if this domain exists in the 'organizations' table
    const { data: orgData, error: dbError } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .limit(1)
      .single()
      
    if (dbError && dbError.code !== 'PGRST116') {
        // LOG 2: Log any database errors other than "row not found"
        console.error(`[MIDDLEWARE] DB Lookup Error: ${dbError.message}, Code: ${dbError.code}`);
    }

    // If valid custom domain found, rewrite traffic to the internal host
    if (orgData) {
      const rewriteUrl = new URL(url.pathname, `https://${DEFAULT_APP_HOST}`)
      
      // Preserve search parameters
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      // LOG 3: Rewrite confirmed
      console.log(`[MIDDLEWARE] Rewriting ${currentHost} to internal target: ${rewriteUrl.toString()}`); 

      // Perform the rewrite
      response = NextResponse.rewrite(rewriteUrl, {
          request: {
              headers: request.headers,
          },
      })
      
      // Tag the response with the original host for downstream use (callback route)
      response.headers.set('x-forwarded-host', currentHost)
    } else {
        // LOG 4: Domain not found in DB
        console.log(`[MIDDLEWARE] Custom Domain ${currentHost} not found in DB. Proceeding without rewrite.`); 
    }
  }
  
  // 4. AUTHENTICATION LOGIC
  const { data: { user } } = await supabase.auth.getUser()

  // Determine the effective path (handling potentially rewritten URLs)
  const finalUrl = response.headers.get('x-middleware-rewrite') 
    ? new URL(response.headers.get('x-middleware-rewrite')!) 
    : url

  // A. Logged In User on Login Page -> Redirect to Dashboard
  if (user && finalUrl.pathname === '/') {
    // Note: request.url ensures the redirect preserves the current host (custom domain)
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // B. Guest User on Protected Route -> Redirect to Login
  if (!user && finalUrl.pathname.startsWith('/dashboard')) {
    // Note: request.url ensures the redirect preserves the current host (custom domain)
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Match all request paths except for the ones that shouldn't be processed by middleware
    '/((?!_next/static|_next/image|favicon.ico|auth|shared).*)',
  ],
}