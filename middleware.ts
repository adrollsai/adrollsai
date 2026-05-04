import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  
  // 1. CLEAN HOSTNAME (Strips port numbers for local testing compatibility)
  const rawHostname = request.headers.get('host') || '';
  const hostname = rawHostname.split(':')[0]; 

  // 2. CUSTOM DOMAIN ROUTING
  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'adrolls.in';
  
  // Safe list for platform-owned domains
  const isPlatformDomain = hostname.includes(mainDomain) || 
                           hostname.includes('localhost') || 
                           hostname.includes('vercel.app') || 
                           hostname.includes('ngrok-free.dev');

  // If it's a custom domain...
  if (!isPlatformDomain) {
    // CRITICAL PWA FIX: Let API routes and service worker files pass through normally!
    // Without this, PWA installation and notifications on custom domains will 404.
    const isStaticPwaFile = url.pathname.endsWith('.js') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.json');
    
    if (url.pathname.startsWith('/api/') || isStaticPwaFile) {
        // Do nothing, let it fall through
    } else {
        // Rewrite all other frontend paths to the shared profile route
        return NextResponse.rewrite(new URL(`/shared/${hostname}${url.pathname}`, request.url));
    }
  }

  // 3. AUTHENTICATION & REDIRECT LOGIC
  let response = NextResponse.next({
    request: { headers: request.headers },
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
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // --- REDIRECT RULES ---

  // Rule A: If user is logged in and hits root (/), send to dashboard
  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Rule B: Redirect to login ONLY if it's the APP subdomain or NGROK
  // This prevents the main landing page (adrolls.in) from redirecting
  const isAppSubdomain = hostname.startsWith('app.adrolls.in') || hostname.includes('ngrok-free.dev') || hostname.includes('localhost');
  
  if (!user && request.nextUrl.pathname === '/' && isAppSubdomain) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Rule C: Standard protection for dashboard routes
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
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
     * - auth (auth callback routes)
     * - shared (custom domain internal routes)
     */
    '/((?!_next/static|_next/image|favicon.ico|auth|shared|sw.js|sw-v2.js).*)',
  ],
}