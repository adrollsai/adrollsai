import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  // 1. CUSTOM DOMAIN ROUTING
  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'adrolls.in';
  
  // Safe list for platform-owned domains
  const isPlatformDomain = hostname.includes(mainDomain) || 
                           hostname.includes('localhost') || 
                           hostname.includes('vercel.app') || 
                           hostname.includes('ngrok-free.dev');

  // If it's a custom domain, rewrite the URL internally to the shared profile route
  if (!isPlatformDomain) {
    return NextResponse.rewrite(new URL(`/shared/${hostname}${url.pathname}`, request.url));
  }

  // 2. AUTHENTICATION & REDIRECT LOGIC
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

  // Rule A: If user is logged in and hits the landing page (/), send to dashboard
  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Rule B: If user is NOT logged in and hits the root (/), send to login
  if (!user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Rule C: If user is NOT logged in and tries to access dashboard, send to login
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
    '/((?!_next/static|_next/image|favicon.ico|auth|shared).*)',
  ],
}