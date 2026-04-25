import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  // 1. CUSTOM DOMAIN ROUTING
  // Define your main app domains here (including localhost for testing)
  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'adrolls.in'; 
  const isPlatformDomain = hostname.includes(mainDomain) || hostname.includes('localhost') || hostname.includes('vercel.app');

  // If it's a custom domain, rewrite the URL internally to the shared profile route
  if (!isPlatformDomain) {
    return NextResponse.rewrite(new URL(`/shared/${hostname}${url.pathname}`, request.url));
  }

  // 2. EXISTING AUTHENTICATION LOGIC
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth).*)',
  ],
}