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

  // --- 1. Custom Domain Logic (OPTIMIZED) ---
  if (!isLocalhost && !isDefaultHost && !isMarketingHost && !isAppHost) {
    
    // CACHE CHECK: Do we already know this domain is valid?
    const domainVerifiedCookie = request.cookies.get('x-domain-verified')
    
    if (domainVerifiedCookie?.value === currentHost) {
       // It's valid, skip DB check!
       response = rewriteToCustomDomain(url, currentHost, request);
    } else {
       // DB CHECK: Check DB for Organization Custom Domain
       // Optimized: Select ONLY 'id', not the whole row
       const { data: orgData } = await supabase
         .from('organizations')
         .select('id') 
         .eq('custom_domain', currentHost)
         .single()

       if (orgData) {
         response = rewriteToCustomDomain(url, currentHost, request);
         // SET CACHE: Save cookie so next time is fast
         response.cookies.set('x-domain-verified', currentHost, { maxAge: 60 * 60 * 24 }); // 24 hours
       }
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

// Helper to keep code clean
function rewriteToCustomDomain(url: URL, currentHost: string, request: NextRequest) {
    const targetPath = url.pathname === '/' ? '/login' : url.pathname;
    const rewriteUrl = new URL(targetPath, `https://${process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'}`)
    
    url.searchParams.forEach((value, key) => {
        rewriteUrl.searchParams.set(key, value)
    })
    
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-forwarded-host', currentHost);

    const response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
    })
    
    response.headers.set('x-forwarded-host', currentHost)
    return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth|shared|api/org-icon|api/manifest|api/webhooks|manifest.webmanifest|manifest.json).*)',
  ],
}