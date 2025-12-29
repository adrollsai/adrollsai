import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; // 'icon' or 'favicon'

  // Reliable Host Detection
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0]; // Remove port if present

  // Fallback Assets
  const FALLBACK_ICON = new URL('/icon-512x512.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  // System Hosts (Skip DB lookup)
  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app',
    'localhost' // Treat localhost as system for icon purposes unless testing custom domain locally
  ];

  // If system host, return redirect immediately
  if (SYSTEM_HOSTS.includes(host)) {
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }

  try {
    const supabase = await createClient();

    // Fetch Organization Logo
    const { data: org } = await supabase
      .from('organizations')
      .select('master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (!org || !org.master_logo_url) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    // Fetch the image from the URL (Supabase Storage/R2)
    const imageResponse = await fetch(org.master_logo_url);

    if (!imageResponse.ok) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/png';

    // Return the image directly
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400', // Cache for 24h
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }
}