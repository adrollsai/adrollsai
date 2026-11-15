import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { decideRouting, isPlatformHost, normaliseHost, parseExtraDomains } from '@/lib/routing/host'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  
  // 1. CLEAN HOSTNAME (Strips port numbers for local testing compatibility)
  const hostname = normaliseHost(request.headers.get('host'));

  // 2. CUSTOM DOMAIN ROUTING
  //
  // Whether this host is OURS is answered in code (lib/routing/host.ts), not from the
  // database. It used to be answered by reading profiles.whitelabel_domain with this
  // request's cookies — which row-level security correctly hides from a signed-in user, so
  // every logged-in visitor to app.pipixel.io was treated as a customer's custom domain and
  // every /dashboard page 404'd. Logged-out visitors were fine, which is why the login page
  // kept working and hid the fault.
  const extraDomains = parseExtraDomains(process.env.NEXT_PUBLIC_PLATFORM_DOMAINS);
  const isPlatformDomain = isPlatformHost(hostname, extraDomains);

  if (url.pathname === '/favicon.ico' || url.pathname === '/icon.png') {
    if (!isPlatformDomain) {
      return NextResponse.rewrite(new URL(`/api/org-icon?type=${url.pathname === '/favicon.ico' ? 'favicon' : 'icon'}`, request.url));
    }
  }

  const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js|webmanifest|json|txt|xml|mp4|webm)$/i.test(url.pathname);

  let isWhitelabelPlatform = false;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-forwarded-host-custom', hostname);

  // If it's a custom domain...
  if (!isPlatformDomain) {
    if (url.pathname.startsWith('/api/') || isStaticAsset || url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
        // Do nothing, let it fall through
    } else {
        // Check if this domain is registered as an Agency White-Label Platform Domain
        try {
          const supabaseAnon = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } }
          );
          const { data: wlProfile } = await supabaseAnon
            .from('profiles')
            .select('id, business_name, logo_url')
            .eq('whitelabel_domain', hostname)
            .maybeSingle();

          if (wlProfile) {
            isWhitelabelPlatform = true;
            requestHeaders.set('x-whitelabel-domain', hostname);
            requestHeaders.set('x-whitelabel-id', wlProfile.id);
            requestHeaders.set('x-whitelabel-name', wlProfile.business_name || '');
          }
        } catch (wlErr: any) {
          console.error('[Middleware Whitelabel Check]:', wlErr?.message);
        }

        // A tenant domain we do not already know about: serve their storefront, but NEVER
        // let the rewrite capture an app path. /dashboard and /login stay the app even on a
        // domain this check has never heard of.
        const decision = decideRouting({
          host: hostname,
          pathname: url.pathname,
          isWhitelabelPlatform,
          extraDomains,
        });
        if (decision.kind === 'storefront') {
          return NextResponse.rewrite(new URL(decision.rewriteTo, request.url));
        }
    }
  }

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // 3. FAST PATH FOR STATIC ASSETS & PUBLIC APIS (Bypasses remote auth network calls)
  const isPublicApi = url.pathname.startsWith('/api/fetch-image') || 
                      url.pathname.startsWith('/api/webhooks') || 
                      url.pathname.startsWith('/api/manifest') ||
                      url.pathname.startsWith('/api/landing-page/read') ||
                      url.pathname.startsWith('/api/force-sync');

  if (isStaticAsset || isPublicApi) {
    return response;
  }

  // Determine if authentication check in middleware is necessary (API routes authenticate internally)
  const isDashboardRoute = url.pathname.startsWith('/dashboard');
  const isRootRoute = url.pathname === '/';

  // Normalize /dashboard/whatsapp automation (with spaces or %20) to /dashboard/whatsapp-automation
  if (url.pathname === '/dashboard/whatsapp automation' || url.pathname === '/dashboard/whatsapp%20automation') {
    const redirectUrl = new URL('/dashboard/whatsapp-automation', request.url);
    url.searchParams.forEach((val, key) => redirectUrl.searchParams.set(key, val));
    return NextResponse.redirect(redirectUrl);
  }

  if (!isDashboardRoute && !isRootRoute) {
    return response;
  }

  // 4. AUTHENTICATION & REDIRECT LOGIC
  try {
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
    if (user && user.email === 'adrolls-realty-demo@adrolls.in' && url.pathname.startsWith('/api/')) {
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
    if (user && isRootRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // Rule B: Redirect to login if it's the APP subdomain (starts with 'app.') or an agency whitelabel domain
    const isAppSubdomain = hostname.startsWith('app.') || isWhitelabelPlatform;
    
    if (!user && isRootRoute && isAppSubdomain) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Rule C: Standard protection for dashboard routes
    if (!user && isDashboardRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  } catch (err: any) {
    console.error('[Middleware Error]:', err.message);
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api (All API routes authenticate internally, bypassing edge middleware saves invocations)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth (auth callback routes)
     * - shared (custom domain internal routes)
     * - service workers & offline assets
     */
    '/((?!api|_next/static|_next/image|auth|shared|sw.js|sw-v2.js|custom-sw.js|workbox-[a-f0-9]+.js).*)',
  ],
}