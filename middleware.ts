import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Check for both standard and secure cookie names
  const sessionCookie = 
    request.cookies.get("better-auth.session_token") || 
    request.cookies.get("__Secure-better-auth.session_token");

  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard')
  const isLoginPage = request.nextUrl.pathname === '/'

  // 1. Protect Dashboard: If trying to access dashboard but no cookie, go to Login
  if (isDashboard && !sessionCookie) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // 2. Redirect Logged-in Users: If on Login page but have a cookie, go to Dashboard
  if (isLoginPage && sessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/',
  ],
}
