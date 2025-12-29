import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const runtime = 'nodejs'

const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app' 

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = request.nextUrl
  const currentHost = request.headers.get('x-forwarded-host') || url.host
  const isLocalhost = currentHost.includes('localhost') || currentHost.includes('127.0.0.1')

  // Create Supabase Client
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

  // Host Definitions
  const APP_HOST = 'app.adrolls.in';
  const MARKETING_HOSTS = ['adrolls.in', 'www.adrolls.in'];
  
  const isAppHost = currentHost === APP_HOST;
  const isMarketingHost = MARKETING_HOSTS.includes(currentHost);
  const isDefaultHost = currentHost === DEFAULT_APP_HOST;

  // --- 1. Custom Domain Logic ---
  if (!isLocalhost && !isDefaultHost && !isMarketingHost && !isAppHost) {
    // Check DB for Organization Custom Domain
    const { data: orgData } = await supabase
      .from('organizations')
      .select('custom_domain')
      .eq('custom_domain', currentHost)
      .single()

    if (orgData) {
      // Rewrite root to login for custom domains
      const targetPath = url.pathname === '/' ? '/login' : url.pathname;
      const rewriteUrl = new URL(targetPath, `https://${DEFAULT_APP_HOST}`)
      
      // Preserve params
      url.searchParams.forEach((value, key) => {
          rewriteUrl.searchParams.set(key, value)
      })
      
      response = NextResponse.rewrite(rewriteUrl, {
          request: { headers: request.headers },
      })
      response.headers.set('x-forwarded-host', currentHost)
    }
  }
  
  // --- 2. App Domain Logic ---
  if (isAppHost && url.pathname === '/') {
      const loginUrl = new URL('/login', request.url);
      url.searchParams.forEach((value, key) => loginUrl.searchParams.set(key, value))
      response = NextResponse.rewrite(loginUrl);
  }

  // --- 3. Auth Logic ---
  const { data: { user } } = await supabase.auth.getUser()
  const finalUrl = response.headers.get('x-middleware-rewrite') 
    ? new URL(response.headers.get('x-middleware-rewrite')!) 
    : url

  if (user) {
    if (finalUrl.pathname === '/login') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  if (!user) {
    if (finalUrl.pathname.startsWith('/dashboard')) {
        const redirectPath = isAppHost ? '/' : '/login'; 
        return NextResponse.redirect(new URL(redirectPath, request.url))
    }
  }

  return response
}

export const config = {
  // CRITICAL: Exclude manifest files and API routes from middleware to prevent rewrites/auth blocks
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|shared|api/org-icon|manifest.webmanifest|manifest.json).*)',
  ],
}