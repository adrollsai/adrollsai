import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  
  // 1. CLEAN HOSTNAME (Strips port numbers for local testing compatibility)
  const rawHostname = request.headers.get('host') || '';
  const hostname = rawHostname.split(':')[0]; 

  // 2. CUSTOM DOMAIN ROUTING
  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'nobogent.com';
  
  // Safe list for platform-owned domains
  const isPlatformDomain = hostname.includes(mainDomain) || 
                           hostname.includes('localhost') || 
                           hostname.includes('vercel.app') || 
                           hostname.includes('ngrok-free.dev');

  // If it's a custom domain...
  if (!isPlatformDomain) {
    // Match common static assets (images, icons, fonts, stylesheets, documents, audio/video files) to let them fall through.
    // This prevents them from being rewritten to /shared/... and throwing 404s.
    const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js|webmanifest|json|txt|xml|mp4|webm)$/i.test(url.pathname);
    
    if (url.pathname.startsWith('/api/') || isStaticAsset) {
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

  // AI Operations Protection for Demo Account
  if (user && user.email === 'adrolls-realty-demo@adrolls.in') {
    const isAiOperation = 
      request.nextUrl.pathname.startsWith('/api/chat') ||
      request.nextUrl.pathname.startsWith('/api/background-worker') ||
      request.nextUrl.pathname.startsWith('/api/landing-page/generate') ||
      request.nextUrl.pathname.startsWith('/api/agent/strategy') ||
      request.nextUrl.pathname.startsWith('/api/video/concepts') ||
      request.nextUrl.pathname.startsWith('/api/video/script') ||
      request.nextUrl.pathname.startsWith('/api/video/generate') ||
      request.nextUrl.pathname.startsWith('/api/video/render') ||
      request.nextUrl.pathname.startsWith('/api/video/captions/generate') ||
      request.nextUrl.pathname.startsWith('/api/meta-ads/launch-campaign') ||
      request.nextUrl.pathname.startsWith('/api/meta-ads/launch-remarketing') ||
      request.nextUrl.pathname.startsWith('/api/meta-ads/optimize-campaign');

    if (isAiOperation) {
      return NextResponse.json(
        { error: 'This is a demo account. No AI operations should run on this account.' },
        { status: 400 }
      );
    }
  }

  // --- REDIRECT RULES ---

  // Rule A: If user is logged in and hits root (/), send to dashboard
  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Rule B: Redirect to login ONLY if it's the APP subdomain (starts with 'app.')
  // This prevents the main landing page from redirecting on localhost or primary domains
  const isAppSubdomain = hostname.startsWith('app.');
  
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
    '/((?!_next/static|_next/image|favicon.ico|auth|shared|sw.js|sw-v2.js|custom-sw.js|workbox-[a-f0-9]+.js).*)',
  ],
}