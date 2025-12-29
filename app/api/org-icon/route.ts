import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; // 'icon' or 'favicon'

  // 1. Get the Hostname reliably (check forwarded headers for Vercel)
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  
  // 2. CLEAN THE HOST: Remove port numbers (e.g., "localhost:3000" -> "localhost")
  // - This fixes the localhost issue and ensures cleaner DB lookups
  const host = rawHost.split(':')[0];

  // Default Fallbacks
  const FALLBACK_ICON = new URL('/icon-512x512.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  // Define System Hosts (Where we ALWAYS show AdRolls)
  // NOTE: 'localhost' is REMOVED from this list so you can see it working locally.
  const SYSTEM_HOSTS = [
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];

  if (SYSTEM_HOSTS.includes(host)) {
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }

  try {
    const supabase = await createClient();

    // 3. Query DB for this host
    const { data: org, error } = await supabase
      .from('organizations')
      .select('master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (error || !org || !org.master_logo_url) {
      console.warn(`[ORG ICON] No organization found for host: ${host}`);
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    // 4. Fetch the actual image from Supabase Storage
    const imageResponse = await fetch(org.master_logo_url);

    if (!imageResponse.ok) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    // 5. Serve the image with correct headers
    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/png';

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600', 
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Critical Error:', err);
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }
}