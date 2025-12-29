import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 1. Configuration & Runtime Fix
export const runtime = 'nodejs'

// IMPORTANT: This MUST be set to your internal Vercel domain
const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app' 

export async function middleware(request: NextRequest) {
  // Initialize response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = request.nextUrl
  
  // Get the hostname
  const currentHost = request.headers.get('x-forwarded-host') || url.host
  const isLocalhost = currentHost.includes('localhost') || currentHost.includes('127.0.0.1')

  // LOG 1: Check the incoming host
  console.log(`[MIDDLEWARE] Incoming Host: ${currentHost}`);

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

  // 3. DOMAIN ROUTING LOGIC
  
  // Define your distinct domains
  const APP_HOST = 'app.adrolls.in';
  const MARKETING_HOSTS = ['adrolls.in', 'www.adrolls.in'];
  
  const isAppHost = currentHost === APP_HOST;
  const isMarketingHost = MARKETING_HOSTS.includes(currentHost);
  const isDefaultHost = currentHost === DEFAULT_APP_HOST;

  // A. CUSTOM DOMAIN LOGIC (Database Lookup)
  // Check DB only if it's NOT a known system host (localhost, default, marketing, or app)
  if (!isLocalhost && !isDefaultHost && !isMarketingHost && !isAppHost) {
    
    // Check if this domain exists in the 'organizations' table
    const { data: orgData, error: dbError } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .limit(1)
      .single()
      
    if (dbError && dbError.code !== 'PGRST116') {
        console.error(`[MIDDLEWARE] DB Lookup Error: ${dbError.message}`);
    }

    if (orgData) {
      // If Custom Domain: Treat it like the APP. 
      // Rewrite root '/' to '/login' so they see the App Entry, not the Landing Page.
      const targetPath = url.pathname === '/' ? '/login' : url.pathname;
      
      const rewriteUrl = new URL(targetPath, `https://${DEFAULT_APP_HOST}`)
      
      // Preserve search parameters
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      console.log(`[MIDDLEWARE] Rewriting Custom Domain ${currentHost} to: ${rewriteUrl.toString()}`); 

      response = NextResponse.rewrite(rewriteUrl, {
          request: {
              headers: request.headers,
          },
      })
      
      response.headers.set('x-forwarded-host', currentHost)
    }
  }
  
  // B. APP SUBDOMAIN LOGIC (app.adrolls.in)
  // If user visits root of app subdomain, show Login Page instead of Landing Page
  if (isAppHost && url.pathname === '/') {
      console.log(`[MIDDLEWARE] Rewriting App Domain Root to Login`);
      const loginUrl = new URL('/login', request.url);
      
      // Preserve params (e.g. invite codes)
      url.searchParams.forEach((value, key) => {
        loginUrl.searchParams.set(key, value)
      })

      response = NextResponse.rewrite(loginUrl);
  }

  // 4. AUTHENTICATION LOGIC
  const { data: { user } } = await supabase.auth.getUser()

  // Determine the final effective path (after any rewrites above)
  const finalUrl = response.headers.get('x-middleware-rewrite') 
    ? new URL(response.headers.get('x-middleware-rewrite')!) 
    : url

  // A. Logged In User handling
  if (user) {
    // If user is on the Login Page (or root of App/Custom Domain which rewrites to login)
    // Redirect them to Dashboard.
    // NOTE: We do NOT redirect for '/' if it wasn't rewritten (i.e., the Marketing Landing Page)
    if (finalUrl.pathname === '/login') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // B. Guest User handling
  if (!user) {
    // If guest tries to access Dashboard, send them to Login
    if (finalUrl.pathname.startsWith('/dashboard')) {
        // If on App Domain, redirect to root (which we mapped to login) to keep URL clean, or just /login
        const redirectPath = isAppHost ? '/' : '/login'; 
        return NextResponse.redirect(new URL(redirectPath, request.url))
    }
  }

  return response
}

export const config = {
  // CRITICAL UPDATE: Added 'manifest.webmanifest' and 'api/org-icon' to the ignore list.
  // This ensures the browser can fetch these files without middleware interference.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|shared|api/org-icon|manifest.webmanifest).*)',
  ],
}